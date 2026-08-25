import type { ObjectId } from 'mongodb'

/**
 * O EVENTO INTERNO — o que uma parte da plataforma conta às outras.
 *
 * Não é webhook: o webhook é a porta pública, com assinatura e chave, e continua
 * exatamente onde estava. Isto aqui é o barramento de dentro, e a diferença que
 * importa é a garantia: um evento publicado sobrevive a um restart, é entregue uma
 * vez só, e falha para um canto visível em vez de repetir para sempre.
 *
 * MongoDB é o transporte. Não porque seja o ideal, mas porque é o que já existe: a
 * coleção de runs já é a fila das automações, com lease e reivindicação atômica. Um
 * segundo mecanismo com outra semântica de retry seria uma segunda coisa para
 * entender às 3 da manhã.
 */
export const EVENT_TYPES = [
  'market.price.updated',
  /**
   * A melhor compra e a melhor venda. Não é negócio: ninguém pagou esse preço ainda.
   *
   * Fica separado de `price.updated` porque a diferença importa — uma cotação não entra
   * em vela, e somá-la ao volume seria inventar negócio que não houve.
   */
  'market.quote.updated',
  /** Uma vela pronta, vinda do próprio provider. Ver `market.candle.closed`, que é a nossa. */
  'market.bar.closed',
  'market.candle.closed',
  'market.signal.detected',
  'trade.order.created',
  'trade.order.filled',
  'trade.stop.triggered',
  'trade.position.closed',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export const isEventType = (v: unknown): v is EventType => EVENT_TYPES.includes(v as EventType)

/**
 * `pending` → `processing` → `done`, ou `dead_letter` quando as tentativas acabam.
 *
 * Não existe `retrying`: um evento esperando a próxima tentativa é `pending` com
 * `nextAttemptAt` no futuro. Um estado a menos é uma consulta a menos para errar.
 */
export type EventStatus = 'pending' | 'processing' | 'done' | 'dead_letter'

export interface PlatformEvent {
  _id: ObjectId
  /** Identidade pública do evento, estável entre tentativas. */
  eventId: string
  ownerId: string
  type: EventType
  /** Quem produziu: `market-data`, `alpaca:paper`, `candle-engine`. Nunca uma credencial. */
  source: string
  /** O contrato do `payload`. Um consumidor que não conhece a versão recusa em vez de adivinhar. */
  schemaVersion: number
  payload: Record<string, unknown>
  /** Quando aconteceu LÁ FORA — que não é quando chegou aqui. */
  occurredAt: Date
  /**
   * A chave da entrega única.
   *
   * Um provider reenvia o mesmo trade quando a conexão cai e volta; um candle fechado
   * é recalculado depois de um restart. Publicar de novo com a mesma chave não cria um
   * segundo evento — devolve o primeiro.
   */
  dedupeKey: string
  status: EventStatus
  attempts: number
  leaseUntil: Date | null
  claimedBy: string | null
  /** Antes disto, ninguém pega. É assim que o backoff existe sem um estado próprio. */
  nextAttemptAt: Date
  error: { message: string } | null
  /** Preenchido só quando termina bem: é o TTL. Dead-letter fica, porque alguém precisa olhar. */
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** O que quem publica precisa dizer. O resto é bookkeeping e é preenchido aqui. */
export interface PublishInput {
  ownerId: string
  type: EventType
  source: string
  payload: Record<string, unknown>
  occurredAt?: Date
  dedupeKey: string
  schemaVersion?: number
}
