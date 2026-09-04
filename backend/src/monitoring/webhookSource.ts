import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { encrypt, decrypt } from '../crypto.js'
import { generatePublicKey, generateSecret, verifySignature, signBody } from '../automations/webhook.js'
import { ingestFact } from '../dataHistory/engine.js'
import { applyMapping } from './mapping.js'
import { MonitoringError, sourceKeyOf, sourcesCollection } from './service.js'
import type { MonitoringSource } from './types.js'
import { registrarEvento } from './history.js'

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

/**
 * A MEMÓRIA DE ENTREGA — de qualquer fonte que recebe, não só do webhook.
 *
 * A dedupe do motor de histórico compõe a identidade do fato com o INSTANTE em que ele
 * ocorreu, e está certa: o mesmo preço às 10h e às 11h são dois fatos. Mas uma entrega
 * repetida — o mesmo `x-event-id`, ou o mesmo evento SSE reenviado depois de uma
 * reconexão — não é um fato novo, e o instante da segunda chegada é diferente do da
 * primeira. Sem esta memória, cada reconexão duplicaria a série inteira.
 *
 * Devolve `false` quando a entrega já tinha chegado. O índice único é quem decide: uma
 * leitura antes seria uma opinião velha no instante em que chegasse.
 */
export async function lembrarEntrega(ownerId: string, sourceId: ObjectId, idempotencyKey: string, agora = new Date()): Promise<boolean> {
  try {
    await deliveries.insertOne({ _id: new ObjectId(), sourceId, ownerId, idempotencyKey, receivedAt: agora })
    return true
  } catch (erro) {
    if ((erro as { code?: number }).code === 11000) return false
    throw erro
  }
}

/** Desfaz a lembrança — para uma recusa corrigível não queimar o id do evento. */
export const esquecerEntregaDe = (sourceId: ObjectId, idempotencyKey: string): Promise<unknown> =>
  deliveries.deleteOne({ sourceId, idempotencyKey }).catch(() => undefined)

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
  /**
   * SEM instante, a decisão é da POLÍTICA — e não do silêncio.
   *
   * Antes, entrega sem `x-timestamp` pulava a conferência inteira: bastava não mandar o
   * cabeçalho para o replay voltar a valer para sempre. Uma fonte que nasce hoje exige o
   * instante; uma que já existia continua como estava, porque mudar a regra de um webhook
   * em produção quebraria a integração do outro lado por uma decisão que é nossa.
   */
  const politica = (fonte.config as { timestampPolicy?: string }).timestampPolicy ?? 'optional'
  if (!timestamp && politica === 'required') return { ok: false, reason: 'unauthorized' }

  if (fonte.status !== 'active') return { ok: false, reason: 'paused' }

  /** Uma linha no histórico operacional desta fonte. Entrega é outro tipo de evento. */
  const anotar = (outcome: 'ok' | 'failed' | 'refused', extra: Record<string, unknown> = {}) =>
    registrarEvento({ ownerId: fonte.ownerId, sourceId: fonte._id, sourceName: fonte.name, kind: 'delivery', outcome, at: agora, ...extra })

  const eventId = typeof headers['x-event-id'] === 'string' ? (headers['x-event-id'] as string) : null
  const idempotencyKey = eventId
    ? `evt:${eventId}`
    : `hash:${createHash('sha256').update(body).digest('hex').slice(0, 32)}`

  if (!(await lembrarEntrega(fonte.ownerId, fonte._id, idempotencyKey, agora))) {
    await anotar('refused', { errorCode: 'duplicate', errorMessage: 'esta entrega já tinha chegado' })
    return { ok: false, reason: 'duplicate' }
  }

  /**
   * A memória da entrega é DESFEITA quando a recusa é corrigível.
   *
   * O registro de idempotência é gravado antes de olhar o corpo, e tem que ser: é ele que
   * faz duas entregas simultâneas do mesmo evento virarem uma. Mas se o corpo vem
   * malformado ou falta um campo obrigatório, nada foi gravado — e manter a lembrança
   * transformava o mesmo `x-event-id` corrigido em "duplicado" para sempre. Do outro lado,
   * alguém reenviava o evento certo e recebia silêncio.
   */
  const esquecerEntrega = () => esquecerEntregaDe(fonte._id, idempotencyKey)

  let corpo: unknown
  try {
    corpo = JSON.parse(body)
  } catch {
    await esquecerEntrega()
    await anotar('failed', { errorCode: 'mapping', errorMessage: 'o corpo entregue não é JSON' })
    return { ok: false, reason: 'mapping' }
  }

  const mapeado = applyMapping(corpo, fonte.mapping)
  if (mapeado.missing.length) {
    await esquecerEntrega()
    await anotar('failed', { errorCode: 'schema', errorMessage: `faltou: ${mapeado.missing.join(', ')}` })
    return { ok: false, reason: 'schema' }
  }

  let recorded = 0
  const linhas = mapeado.rows.slice(0, 200)
  for (const [i, linha] of linhas.entries()) {
    const entityKey = fonte.entityKeyPath ? String(linha[fonte.entityKeyPath] ?? '') || null : null
    await ingestFact({
      ownerId: fonte.ownerId,
      sourceKey: sourceKeyOf(fonte._id),
      entityKey,
      occurredAt: agora,
      value: linha,
      /**
       * UMA identidade por LINHA — não uma por entrega.
       *
       * O mesmo `factId` para todas as linhas fazia uma entrega de cinco itens gravar um:
       * o motor de histórico via a segunda como repetição da primeira e a descartava. As
       * outras quatro sumiam sem erro nenhum, que é o pior jeito de perder dado.
       *
       * A chave da entidade entra antes do índice quando existe: ela é estável entre
       * reenvios, e o índice muda se o provedor reordenar a lista.
       */
      factId: `${fonte._id.toString()}:${idempotencyKey}:${entityKey ?? i}`,
    }).then((r) => {
      recorded += r.gravado ?? 0
    })
  }

  await sourcesCollection.updateOne(
    { _id: fonte._id },
    {
      $set: { 'telemetry.lastReadAt': agora, 'telemetry.lastOkAt': agora, 'telemetry.consecutiveFailures': 0, 'telemetry.lastErrorCode': null },
      $inc: { 'telemetry.readsOk': 1 },
    },
  )
  await anotar('ok', { rows: linhas.length, recorded })
  return { ok: true, recorded }
}

/** O exemplo que a tela mostra: como assinar. Nunca com o segredo real dentro. */
export const exampleSignature = (segredo: string, corpo: string) => signBody(segredo, corpo)
