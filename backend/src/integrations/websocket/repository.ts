import { ObjectId } from 'mongodb'
import { db } from '../../db.js'
import type { WsLog, WsLogKind, WsMessage, WsMessageStatus, WsSubscription } from './types.js'

// As três coleções do App. Todas escopadas por dono NA CONSULTA — nunca numa
// conferência depois de ler.
const subscriptions = db.collection<WsSubscription>('websocket_subscriptions')
const messages = db.collection<WsMessage>('websocket_messages')
const logs = db.collection<WsLog>('websocket_logs')

/** Por quanto tempo o histórico fica. Um fluxo contínuo enche qualquer banco. */
export const MESSAGE_RETENTION_DAYS = Number(process.env.WS_MESSAGE_RETENTION_DAYS ?? 7)
export const LOG_RETENTION_DAYS = Number(process.env.WS_LOG_RETENTION_DAYS ?? 14)

export async function ensureWebSocketIndexes(): Promise<void> {
  await subscriptions.createIndex({ ownerId: 1, installationId: 1, createdAt: -1 })
  await messages.createIndex({ ownerId: 1, installationId: 1, receivedAt: -1 })
  await messages.createIndex({ ownerId: 1, subscriptionId: 1, receivedAt: -1 })
  await messages.createIndex({ ownerId: 1, subscriptionIds: 1, receivedAt: -1 })
  await messages.createIndex({ ownerId: 1, status: 1, receivedAt: -1 })
  // A dedupe por identificador. Único de propósito: é o índice que faz a garantia ser
  // do banco, e não de uma leitura seguida de escrita que duas mensagens simultâneas
  // atravessam.
  await messages.createIndex(
    { ownerId: 1, installationId: 1, messageId: 1 },
    { unique: true, partialFilterExpression: { messageId: { $type: 'string' } } },
  )
  await messages.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await logs.createIndex({ ownerId: 1, installationId: 1, createdAt: -1 })
  await logs.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

// --- assinaturas ------------------------------------------------------------------

export const listSubscriptions = (ownerId: string, installationId?: string): Promise<WsSubscription[]> =>
  subscriptions.find({ ownerId, ...(installationId ? { installationId } : {}) }).sort({ createdAt: -1 }).toArray()

export const findSubscription = (ownerId: string, id: ObjectId): Promise<WsSubscription | null> => subscriptions.findOne({ _id: id, ownerId })

/** As que estão VALENDO agora numa conexão. É por elas que uma mensagem é encaminhada. */
export const activeSubscriptions = (ownerId: string, installationId: string): Promise<WsSubscription[]> =>
  subscriptions.find({ ownerId, installationId, active: true }).toArray()

export const insertSubscription = async (doc: WsSubscription): Promise<WsSubscription> => {
  await subscriptions.insertOne(doc)
  return doc
}

export async function patchSubscription(ownerId: string, id: ObjectId, set: Partial<WsSubscription>): Promise<WsSubscription | null> {
  const r = await subscriptions.findOneAndUpdate({ _id: id, ownerId }, { $set: { ...set, updatedAt: new Date() } }, { returnDocument: 'after' })
  return r ?? null
}

export async function deleteSubscription(ownerId: string, id: ObjectId): Promise<boolean> {
  const r = await subscriptions.deleteOne({ _id: id, ownerId })
  return r.deletedCount === 1
}

export async function countSubscriptionMessage(id: ObjectId, now: Date): Promise<void> {
  await subscriptions.updateOne({ _id: id }, { $inc: { messageCount: 1 }, $set: { lastMessageAt: now } })
}

/** A conexão saiu do ar: as assinaturas dela param junto, sem sumir. */
export async function deactivateForInstallation(ownerId: string, installationId: string): Promise<number> {
  const r = await subscriptions.updateMany({ ownerId, installationId, active: true }, { $set: { active: false, updatedAt: new Date() } })
  return r.modifiedCount
}

export async function deleteForInstallation(ownerId: string, installationId: string): Promise<void> {
  await subscriptions.deleteMany({ ownerId, installationId })
  await messages.deleteMany({ ownerId, installationId })
  await logs.deleteMany({ ownerId, installationId })
}

// --- mensagens --------------------------------------------------------------------

/**
 * Guarda a mensagem. `null` quando ela já existia — é a dedupe por identificador, e ela
 * é do índice único, não de um `if`.
 */
export async function insertMessage(doc: WsMessage): Promise<WsMessage | null> {
  try {
    await messages.insertOne(doc)
    return doc
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return null
    throw error
  }
}

export interface MessageQuery {
  installationId?: string
  subscriptionId?: string
  channel?: string
  status?: WsMessageStatus
  limit: number
  skip: number
}

export async function listMessages(ownerId: string, q: MessageQuery): Promise<{ items: WsMessage[]; total: number }> {
  const filtro: Record<string, unknown> = { ownerId }
  if (q.installationId) filtro.installationId = q.installationId
  // Uma mensagem pode ter servido a mais de uma assinatura: filtrar pelo campo antigo
  // esconderia todas menos a primeira.
  if (q.subscriptionId) filtro.$or = [{ subscriptionId: q.subscriptionId }, { subscriptionIds: q.subscriptionId }]
  if (q.channel) filtro.channel = q.channel
  if (q.status) filtro.status = q.status
  const [items, total] = await Promise.all([
    messages.find(filtro).sort({ receivedAt: -1 }).skip(q.skip).limit(q.limit).toArray(),
    messages.countDocuments(filtro),
  ])
  return { items, total }
}

/** Quantas chegaram na última janela. É o contador do limite por minuto. */
export const countRecentMessages = (ownerId: string, installationId: string, desde: Date): Promise<number> =>
  messages.countDocuments({ ownerId, installationId, receivedAt: { $gte: desde } })

export async function messageStats(ownerId: string, installationId: string): Promise<{ total: number; accepted: number; lastAt: Date | null }> {
  const [total, accepted, ultima] = await Promise.all([
    messages.countDocuments({ ownerId, installationId }),
    messages.countDocuments({ ownerId, installationId, status: 'accepted' }),
    messages.find({ ownerId, installationId }).sort({ receivedAt: -1 }).limit(1).toArray(),
  ])
  return { total, accepted, lastAt: ultima[0]?.receivedAt ?? null }
}

// --- logs -------------------------------------------------------------------------

export async function writeLog(
  ownerId: string,
  installationId: string,
  kind: WsLogKind,
  message: string,
  subscriptionId: string | null = null,
  now = new Date(),
): Promise<void> {
  await logs
    .insertOne({
      _id: new ObjectId(),
      ownerId,
      installationId,
      kind,
      // Cortada: a frase é nossa, mas o motivo pode citar um erro de fora.
      message: message.slice(0, 300),
      subscriptionId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + LOG_RETENTION_DAYS * 86_400_000),
    })
    .catch(() => undefined)
}

export const listLogs = (ownerId: string, installationId?: string, limit = 100): Promise<WsLog[]> =>
  logs
    .find({ ownerId, ...(installationId ? { installationId } : {}) })
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 300))
    .toArray()

export const subscriptionsCollection = subscriptions
export const messagesCollection = messages
export const logsCollection = logs
