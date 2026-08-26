import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import type { Automation, AutomationDefinition, AutomationVersion } from './types.js'

// Data access for the automation domain. Versions are insert-only (immutable);
// the service never updates a version document.
const automations = db.collection<Automation>('automations')
const versions = db.collection<AutomationVersion>('automation_versions')

export async function ensureAutomationIndexes(): Promise<void> {
  await automations.createIndex({ ownerId: 1, floorId: 1, status: 1 })
  await automations.createIndex({ ownerId: 1, updatedAt: -1 })
  await automations.createIndex({ webhookPublicKey: 1 }, { unique: true, sparse: true })
  await versions.createIndex({ automationId: 1, version: 1 }, { unique: true })
}

// Public lookup for the webhook receiver (no session — the request is signed).
export function findByWebhookKey(publicKey: string): Promise<Automation | null> {
  return automations.findOne({ webhookPublicKey: publicKey })
}

export function insertAutomation(doc: Automation): Promise<unknown> {
  return automations.insertOne(doc)
}

export function findAutomation(ownerId: string, id: ObjectId): Promise<Automation | null> {
  return automations.findOne({ _id: id, ownerId })
}

export interface ListAutomationsQuery {
  floorId?: ObjectId
  status?: string
  limit: number
  skip: number
  agentId?: ObjectId // list only this agent's routines
  standaloneOnly?: boolean // exclude agent-owned routines (legacy standalone automations)
}

export async function listAutomations(ownerId: string, q: ListAutomationsQuery): Promise<{ items: Automation[]; total: number }> {
  const filter: Record<string, unknown> = { ownerId }
  if (q.floorId) filter.floorId = q.floorId
  if (q.status) filter.status = q.status
  if (q.agentId) filter.agentId = q.agentId
  else if (q.standaloneOnly) filter.agentId = { $exists: false }
  const [items, total] = await Promise.all([
    automations.find(filter).sort({ updatedAt: -1 }).skip(q.skip).limit(q.limit).toArray(),
    automations.countDocuments(filter),
  ])
  return { items, total }
}

// Every ACTIVE automation of this owner, whatever floor or agent it belongs to.
// Used to answer "which agents does a live webhook fire?" — a question that spans
// standalone automations and agent routines alike.
export function listActiveAutomations(ownerId: string): Promise<Automation[]> {
  return automations.find({ ownerId, status: 'active' }).toArray()
}

// Each ACTIVE automation paired with the definition it actually RUNS — the one of
// its lastPublishedVersion, not the draft. Two queries, whatever the count.
export async function listActivePublished(ownerId: string): Promise<{ automation: Automation; published: AutomationDefinition | null }[]> {
  const items = await listActiveAutomations(ownerId)
  const wanted = items.filter((a) => a.lastPublishedVersion != null)
  if (wanted.length === 0) return items.map((automation) => ({ automation, published: null }))
  const rows = await versions
    .find({ ownerId, $or: wanted.map((a) => ({ automationId: a._id, version: a.lastPublishedVersion as number })) })
    .toArray()
  const byAutomation = new Map(rows.map((v) => [`${v.automationId.toString()}:${v.version}`, v.definition]))
  return items.map((automation) => ({
    automation,
    published: automation.lastPublishedVersion == null ? null : (byAutomation.get(`${automation._id.toString()}:${automation.lastPublishedVersion}`) ?? null),
  }))
}

export async function updateAutomation(ownerId: string, id: ObjectId, set: Partial<Automation>): Promise<Automation | null> {
  const result = await automations.findOneAndUpdate(
    { _id: id, ownerId },
    { $set: { ...set, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  return result ?? null
}

export function insertVersion(doc: AutomationVersion): Promise<unknown> {
  return versions.insertOne(doc)
}

export function findVersion(ownerId: string, automationId: ObjectId, version: number): Promise<AutomationVersion | null> {
  return versions.findOne({ ownerId, automationId, version })
}

export function listVersions(ownerId: string, automationId: ObjectId): Promise<AutomationVersion[]> {
  return versions.find({ ownerId, automationId }).sort({ version: -1 }).toArray()
}

/**
 * Remove a automação E o que depende dela.
 *
 * Existe porque o produto até agora só ARQUIVAVA: arquivar é o certo para uma rotina
 * que já rodou — o histórico dela continua fazendo sentido. Remover de verdade só faz
 * sentido para uma que nunca deveria ter existido (o desfazer de uma aplicação), e aí
 * o histórico precisa ir junto: versão, execução, etapa, artefato e marca de fonte
 * apontam para um `automationId` que deixaria de existir, e cada um deles é um
 * registro órfão que continua sendo listado e contado.
 */
export async function deleteAutomationCascade(ownerId: string, id: ObjectId): Promise<boolean> {
  const alvo = await automations.findOne({ _id: id, ownerId }, { projection: { _id: 1 } })
  if (!alvo) return false
  await versions.deleteMany({ ownerId, automationId: id })
  for (const nome of ['automation_runs', 'step_runs', 'artifacts', 'source_checkpoints', 'source_leases']) {
    await db.collection(nome).deleteMany({ automationId: id }).catch(() => undefined)
  }
  const r = await automations.deleteOne({ _id: id, ownerId })
  return r.deletedCount > 0
}
