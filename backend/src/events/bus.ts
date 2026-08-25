import { randomUUID } from 'node:crypto'
import type { ObjectId } from 'mongodb'
import { db } from '../db.js'
import type { EventType, PlatformEvent, PublishInput } from './types.js'

// O barramento interno sobre a coleção `platform_events`. Mesma mecânica da fila de
// runs — reivindicação atômica com lease — porque duplicar a semântica de retry seria
// duplicar o lugar onde ela pode estar errada.
const events = db.collection<PlatformEvent>('platform_events')

/** Quantas vezes tentar antes de parar e deixar visível. */
export const MAX_EVENT_ATTEMPTS = Number(process.env.EVENT_MAX_ATTEMPTS ?? 5)
/** Quanto tempo um consumidor segura o evento antes que outro possa retomá-lo. */
export const EVENT_LEASE_MS = Number(process.env.EVENT_LEASE_MS ?? 60_000)
/** Quanto tempo um evento concluído fica guardado. Dead-letter não expira. */
export const EVENT_TTL_MS = Number(process.env.EVENT_TTL_MS ?? 7 * 24 * 60 * 60_000)

export async function ensureEventIndexes(): Promise<void> {
  // A entrega única. É o índice que faz a idempotência ser do banco e não de um `if`.
  await events.createIndex({ ownerId: 1, dedupeKey: 1 }, { unique: true })
  // A consulta do consumidor: o que está pendente e já pode ser tentado, mais o que
  // ficou preso com lease vencido.
  await events.createIndex({ status: 1, nextAttemptAt: 1, leaseUntil: 1 })
  await events.createIndex({ ownerId: 1, type: 1, occurredAt: -1 })
  // Só apaga quem tem `expiresAt`, e só o sucesso ganha esse campo.
  await events.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

/**
 * Backoff exponencial com jitter.
 *
 * O jitter não é enfeite: sem ele, mil eventos que falharam juntos porque o provider
 * caiu voltam juntos no mesmo milissegundo e derrubam de novo o que acabou de subir.
 */
export function backoffMs(attempts: number, aleatorio = Math.random): number {
  const base = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1))
  return Math.round(base * (0.5 + aleatorio() * 0.5))
}

/**
 * Publicar. Duas vezes a mesma `dedupeKey` do mesmo dono devolve o MESMO evento.
 *
 * `created: false` é informação útil, não detalhe: é como o produtor sabe que a
 * reconexão trouxe um eco em vez de um fato novo.
 */
export async function publishEvent(input: PublishInput, now = new Date()): Promise<{ event: PlatformEvent; created: boolean }> {
  const doc: Omit<PlatformEvent, '_id'> = {
    eventId: randomUUID(),
    ownerId: input.ownerId,
    type: input.type,
    source: input.source,
    schemaVersion: input.schemaVersion ?? 1,
    payload: input.payload,
    occurredAt: input.occurredAt ?? now,
    dedupeKey: input.dedupeKey,
    status: 'pending',
    attempts: 0,
    leaseUntil: null,
    claimedBy: null,
    nextAttemptAt: now,
    error: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  }
  try {
    const r = await events.insertOne(doc as PlatformEvent)
    return { event: { ...doc, _id: r.insertedId }, created: true }
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const existente = await events.findOne({ ownerId: input.ownerId, dedupeKey: input.dedupeKey })
      if (existente) return { event: existente, created: false }
    }
    throw error
  }
}

/**
 * Tirar UM evento da fila, atomicamente. Dois workers nunca pegam o mesmo.
 *
 * Pega dois tipos de trabalho: o que nunca foi tentado e já passou da hora, e o que
 * ficou `processing` porque o processo que o segurava morreu — reconhecido pelo lease
 * vencido, não por um palpite sobre quem está vivo.
 */
export async function claimNextEvent(workerId: string, now = new Date(), tipos?: readonly EventType[]): Promise<PlatformEvent | null> {
  const claimed = await events.findOneAndUpdate(
    {
      ...(tipos && tipos.length ? { type: { $in: tipos as EventType[] } } : {}),
      $or: [
        { status: 'pending', nextAttemptAt: { $lte: now } },
        { status: 'processing', leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: { status: 'processing', claimedBy: workerId, leaseUntil: new Date(now.getTime() + EVENT_LEASE_MS), updatedAt: now },
      $inc: { attempts: 1 },
    },
    { sort: { occurredAt: 1 }, returnDocument: 'after' },
  )
  if (!claimed) return null

  // Já queimou as tentativas: para aqui, em vez de girar para sempre. Um evento
  // envenenado não pode bloquear a fila nem consumir a máquina em silêncio.
  if (claimed.attempts > MAX_EVENT_ATTEMPTS) {
    await deadLetter(claimed._id, `sem sucesso após ${MAX_EVENT_ATTEMPTS} tentativas`, now)
    return null
  }
  return claimed
}

export async function completeEvent(id: ObjectId, now = new Date()): Promise<void> {
  await events.updateOne(
    { _id: id },
    { $set: { status: 'done', leaseUntil: null, claimedBy: null, error: null, expiresAt: new Date(now.getTime() + EVENT_TTL_MS), updatedAt: now } },
  )
}

/**
 * Falhou. Volta para a fila com espera crescente enquanto houver tentativa; vira
 * dead-letter quando não houver mais.
 */
export async function failEvent(id: ObjectId, message: string, now = new Date()): Promise<'pending' | 'dead_letter'> {
  const atual = await events.findOne({ _id: id })
  if (!atual) return 'dead_letter'
  if (atual.attempts >= MAX_EVENT_ATTEMPTS) {
    await deadLetter(id, message, now)
    return 'dead_letter'
  }
  await events.updateOne(
    { _id: id },
    {
      $set: {
        status: 'pending',
        leaseUntil: null,
        claimedBy: null,
        nextAttemptAt: new Date(now.getTime() + backoffMs(atual.attempts)),
        error: { message: message.slice(0, 500) },
        updatedAt: now,
      },
    },
  )
  return 'pending'
}

export async function deadLetter(id: ObjectId, message: string, now = new Date()): Promise<void> {
  await events.updateOne(
    { _id: id },
    // Sem `expiresAt`: o que morreu fica para ser olhado. Um dead-letter que some
    // sozinho é um problema que ninguém soube que existiu.
    { $set: { status: 'dead_letter', leaseUntil: null, claimedBy: null, error: { message: message.slice(0, 500) }, updatedAt: now } },
  )
}

export async function renewEventLease(id: ObjectId, workerId: string, now = new Date()): Promise<boolean> {
  const r = await events.updateOne(
    { _id: id, claimedBy: workerId, status: 'processing' },
    { $set: { leaseUntil: new Date(now.getTime() + EVENT_LEASE_MS), updatedAt: now } },
  )
  return r.matchedCount === 1
}

// --- consumo ---------------------------------------------------------------------

export type EventHandler = (event: PlatformEvent) => Promise<void>

const handlers = new Map<EventType, EventHandler[]>()

/**
 * Quem reage a quê. O registro é aditivo e vive no processo: as Fases seguintes
 * penduram o gatilho interno e o analisador de candles aqui, sem tocar no laço.
 */
export function onEvent(type: EventType, handler: EventHandler): void {
  handlers.set(type, [...(handlers.get(type) ?? []), handler])
}

export const handlersFor = (type: EventType): EventHandler[] => handlers.get(type) ?? []

/** Só para os testes: o registro é global por processo. */
export function resetHandlers(): void {
  handlers.clear()
}

/**
 * Processar um evento reivindicado.
 *
 * Sem handler o evento é CONCLUÍDO, não recusado: publicar um preço antes de existir
 * quem reaja a ele é normal, e transformar isso em dead-letter encheria a caixa de
 * problemas com coisa nenhuma.
 *
 * Um handler que estoura leva o evento inteiro ao retry — os outros do mesmo tipo já
 * rodaram e vão rodar de novo, então um handler precisa ser idempotente. É o mesmo
 * contrato do resto da fila.
 */
export async function processEvent(event: PlatformEvent, now = new Date()): Promise<'done' | 'pending' | 'dead_letter'> {
  const lista = handlersFor(event.type)
  try {
    for (const h of lista) await h(event)
    await completeEvent(event._id, now)
    return 'done'
  } catch (error) {
    return failEvent(event._id, error instanceof Error ? error.message : 'erro inesperado', now)
  }
}

// Leitura para a tela e para os testes. Escopada por dono, sempre.
export function listEvents(ownerId: string, q: { type?: EventType; status?: string; limit?: number } = {}): Promise<PlatformEvent[]> {
  const filter: Record<string, unknown> = { ownerId }
  if (q.type) filter.type = q.type
  if (q.status) filter.status = q.status
  return events.find(filter).sort({ occurredAt: -1 }).limit(Math.min(q.limit ?? 50, 200)).toArray()
}

export const eventsCollection = events
