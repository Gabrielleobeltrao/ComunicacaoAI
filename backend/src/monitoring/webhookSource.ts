import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { encrypt, decrypt } from '../crypto.js'
import { generatePublicKey, generateSecret, verifySignature, signBody } from '../automations/webhook.js'
import { ingestFact } from '../dataHistory/engine.js'
import { applyMapping } from './mapping.js'
import { MonitoringError, sourceKeyOf, sourcesCollection } from './service.js'
import type { MonitoringSource } from './types.js'

// A FONTE de WEBHOOK — e nenhuma criptografia nova.
//
// Assinar, conferir em tempo constante e derivar a chave de idempotência já existe nos
// Flows, testado. O que muda aqui é o destino: em vez de enfileirar uma execução, a
// entrega vira um FATO, e o resto do caminho é o mesmo de qualquer outra fonte.
//
// O segredo nunca volta depois de criado. Ele é mostrado uma vez, na criação e na rotação,
// e a partir daí só existe cifrado — porque um segredo que a tela consegue reexibir é um
// segredo que vaza no primeiro print de tela.

/** As entregas já vistas. É o que faz um reenvio não virar um segundo fato. */
interface WebhookDelivery {
  _id: ObjectId
  sourceId: ObjectId
  ownerId: string
  idempotencyKey: string
  receivedAt: Date
}

const deliveries = db.collection<WebhookDelivery>('monitoring_webhook_deliveries')

export async function ensureWebhookIndexes(): Promise<void> {
  await deliveries.createIndex({ sourceId: 1, idempotencyKey: 1 }, { unique: true })
  // A memória de entregas tem prazo: guardar para sempre é pagar por um índice que só
  // cresce, e um reenvio de três meses depois não é o replay que interessa impedir.
  await deliveries.createIndex({ receivedAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600, name: 'entregas_expiram' })
}

/** A janela em que uma entrega é considerada "de agora". Fora dela, é replay. */
export const MAX_SKEW_MS = 5 * 60_000

export interface WebhookCredentials {
  publicKey: string
  /** Mostrado UMA vez. Depois disso, só existe cifrado. */
  secret: string
}

/**
 * Gera (ou gira) as credenciais de uma fonte de webhook.
 *
 * Girar não apaga o histórico nem a fonte: ela continua no mesmo endereço, e o que muda é
 * o que assina. Trocar a URL junto obrigaria a reconfigurar o outro lado por um motivo que
 * é nosso, e não dele.
 */
export async function rotateWebhookSecret(ownerId: string, sourceId: ObjectId): Promise<WebhookCredentials | null> {
  const fonte = await sourcesCollection.findOne({ _id: sourceId, ownerId })
  if (!fonte) return null
  if (fonte.kind !== 'webhook') throw new MonitoringError('esta fonte não é um webhook', 'wrong_kind')

  const publicKey = fonte.config.webhookPublicKey ?? generatePublicKey()
  const secret = generateSecret()
  await sourcesCollection.updateOne(
    { _id: sourceId, ownerId },
    { $set: { 'config.webhookPublicKey': publicKey, webhookSecretEncrypted: encrypt(secret), updatedAt: new Date() } },
  )
  return { publicKey, secret }
}

export interface WebhookOutcome {
  ok: boolean
  reason?: 'not_found' | 'unauthorized' | 'duplicate' | 'paused' | 'schema' | 'mapping'
  recorded?: number
}

/**
 * Uma entrega recebida.
 *
 * A ordem das recusas importa: fonte inexistente e assinatura errada respondem a MESMA
 * coisa para quem chama — dizer "existe, mas a assinatura está errada" já entrega meia
 * informação a quem está tentando adivinhar o endereço.
 */
export async function receiveWebhook(
  publicKey: string,
  body: string,
  headers: Record<string, string | string[] | undefined>,
  agora: Date = new Date(),
): Promise<WebhookOutcome> {
  const fonte = (await sourcesCollection.findOne({ 'config.webhookPublicKey': publicKey })) as (MonitoringSource & { webhookSecretEncrypted?: string }) | null
  if (!fonte) return { ok: false, reason: 'not_found' }

  const assinatura = String(headers['x-signature'] ?? headers['x-hub-signature-256'] ?? '')
  const segredo = fonte.webhookSecretEncrypted ? decrypt(fonte.webhookSecretEncrypted) : null
  if (!segredo || !verifySignature(segredo, body, assinatura.replace(/^sha256=/, ''))) {
    return { ok: false, reason: 'not_found' }
  }

  /**
   * O INSTANTE da entrega, quando o provedor manda.
   *
   * Sem ele, uma requisição capturada hoje continua válida para sempre — a assinatura não
   * envelhece sozinha. Com ele, a janela fecha.
   */
  const timestamp = Number(headers['x-timestamp'] ?? 0)
  if (timestamp && Math.abs(agora.getTime() - timestamp) > MAX_SKEW_MS) return { ok: false, reason: 'unauthorized' }

  if (fonte.status !== 'active') return { ok: false, reason: 'paused' }

  const eventId = typeof headers['x-event-id'] === 'string' ? (headers['x-event-id'] as string) : null
  const idempotencyKey = eventId
    ? `evt:${eventId}`
    : `hash:${createHash('sha256').update(body).digest('hex').slice(0, 32)}`

  try {
    // O índice único é quem decide: duas entregas simultâneas do mesmo evento, só uma
    // passa. Uma leitura antes seria uma opinião velha no instante em que chegasse.
    await deliveries.insertOne({ _id: new ObjectId(), sourceId: fonte._id, ownerId: fonte.ownerId, idempotencyKey, receivedAt: agora })
  } catch (erro) {
    if ((erro as { code?: number }).code === 11000) return { ok: false, reason: 'duplicate' }
    throw erro
  }

  let corpo: unknown
  try {
    corpo = JSON.parse(body)
  } catch {
    return { ok: false, reason: 'mapping' }
  }

  const mapeado = applyMapping(corpo, fonte.mapping)
  if (mapeado.missing.length) return { ok: false, reason: 'schema' }

  let recorded = 0
  for (const linha of mapeado.rows.slice(0, 200)) {
    const r = await ingestFact({
      ownerId: fonte.ownerId,
      sourceKey: sourceKeyOf(fonte._id),
      entityKey: fonte.entityKeyPath ? String(linha[fonte.entityKeyPath] ?? '') || null : null,
      occurredAt: agora,
      value: linha,
      factId: `${fonte._id.toString()}:${idempotencyKey}`,
    })
    recorded += r.gravado ?? 0
  }

  await sourcesCollection.updateOne(
    { _id: fonte._id },
    {
      $set: { 'telemetry.lastReadAt': agora, 'telemetry.lastOkAt': agora, 'telemetry.consecutiveFailures': 0, 'telemetry.lastErrorCode': null },
      $inc: { 'telemetry.readsOk': 1 },
    },
  )
  return { ok: true, recorded }
}

/** O exemplo que a tela mostra: como assinar. Nunca com o segredo real dentro. */
export const exampleSignature = (segredo: string, corpo: string) => signBody(segredo, corpo)
