// Per-agent operational telemetry — the real activity of each agent, additive and
// idempotent. One row per execution across every real path (channel, manual test,
// routine/worker, delegation, sector). This is the ONLY source the agent metrics
// read from; it never estimates missing history — an agent with no rows simply has
// no telemetry for the period.
//
// PRIVACY: this collection stores only safe operational facts (ids, counts,
// durations, token totals, status). It NEVER stores a prompt, a secret, or a full
// response. `metadata` is for small safe scalars only (e.g. a run id, a stage id).
import { ObjectId } from 'mongodb'
import { db } from './db.js'

export type AgentEventSource = 'channel' | 'manual' | 'routine' | 'delegation' | 'sector'
export const AGENT_EVENT_SOURCES: AgentEventSource[] = ['channel', 'manual', 'routine', 'delegation', 'sector']
// Every terminal outcome is recorded, so a timeout or a cancellation is never
// silently missing from an agent's history.
export type AgentEventStatus = 'succeeded' | 'failed' | 'timeout' | 'canceled'
export const AGENT_EVENT_STATUSES: AgentEventStatus[] = ['succeeded', 'failed', 'timeout', 'canceled']

export interface AgentExecutionEvent {
  _id: ObjectId
  eventKey: string // unique — the idempotency guard against double counting
  ownerId: string
  buildingId: ObjectId | null
  floorId: ObjectId | null
  agentId: ObjectId
  source: AgentEventSource
  preset: string
  status: AgentEventStatus
  startedAt: Date
  finishedAt: Date
  durationMs: number
  inputTokens: number
  outputTokens: number
  /**
   * O modelo que REALMENTE rodou.
   *
   * Sem ele, "economia" não é verificável: trocar um agente do modelo caro para o barato
   * não muda um único token — muda o PREÇO de cada token. O contador de tokens mostra o
   * mesmo número antes e depois, e a diferença só aparece na fatura do provedor.
   *
   * Ausente nos eventos gravados antes deste campo. Quem soma trata como 'desconhecido',
   * em vez de atribuir a um modelo que ninguém registrou.
   */
  model?: string | null
  toolCalls: number
  // How many attempts this logical execution took (a retried routine step stays ONE
  // event: the final status wins, usage/duration accumulate across attempts).
  attemptCount: number
  // Attempt numbers already accounted for — the idempotency guard that keeps a
  // redelivered write from inflating attemptCount/duration/tokens.
  seenAttempts?: number[]
  // Highest attempt whose terminal state was applied; a lower (late) attempt can
  // never overwrite it.
  latestAttempt?: number
  // Delegation shape: the event that triggered this one, and the top of the chain.
  // A root event (parentEventKey null) is what "delegações concluídas" counts, so a
  // chain is never summed twice.
  parentEventKey: string | null
  rootEventKey: string | null
  // The sector run this participation belongs to. Present only when the execution
  // really was part of one — it is the link that lets a sector count a three-stage
  // flow as ONE execution while still reading each agent's numbers.
  sectorExecutionId?: ObjectId | null
  // The complete REQUEST this participation belongs to (see executionRoots.ts).
  // Absent on records written before correlation existed — those are reported as
  // partial telemetry rather than guessed into a root.
  rootExecutionId?: ObjectId | null
  metadata: Record<string, string | number | boolean> // safe scalars only
}

// Deterministic idempotency key for a routine/worker execution: the same run + step
// + agent always yields the same key, so a retried run is deduped by the unique
// index instead of double-counted.
export function runEventKey(runId: string, stepId: string, agentId: string): string {
  return `run:${runId}:${stepId}:${agentId}`
}

const events = db.collection<AgentExecutionEvent>('agent_execution_events')

export async function ensureAgentEventIndexes(): Promise<void> {
  await events.createIndex({ eventKey: 1 }, { unique: true })
  await events.createIndex({ ownerId: 1, agentId: 1, startedAt: -1 })
  await events.createIndex({ ownerId: 1, floorId: 1, startedAt: -1 })
}

export interface RecordAgentEventInput {
  eventKey: string
  ownerId: string
  agentId: ObjectId
  buildingId?: ObjectId | null
  floorId?: ObjectId | null
  source: AgentEventSource
  preset?: string
  status: AgentEventStatus
  startedAt: Date
  finishedAt: Date
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  /** O modelo que rodou. Ver `AgentExecutionEvent.model`. */
  model?: string | null
  toolCalls?: number
  attemptCount?: number
  parentEventKey?: string | null
  rootEventKey?: string | null
  sectorExecutionId?: ObjectId | null
  rootExecutionId?: ObjectId | null
  metadata?: Record<string, string | number | boolean>
}

// Insert one event, idempotently: a duplicate eventKey (a retried run, a re-fired
// schedule) is silently ignored so nothing is counted twice. Returns whether a new
// row was created.
export async function recordAgentEvent(input: RecordAgentEventInput): Promise<boolean> {
  const doc: AgentExecutionEvent = {
    _id: new ObjectId(),
    eventKey: input.eventKey,
    ownerId: input.ownerId,
    buildingId: input.buildingId ?? null,
    floorId: input.floorId ?? null,
    agentId: input.agentId,
    source: input.source,
    preset: input.preset ?? 'custom',
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs ?? Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime()),
    inputTokens: input.inputTokens ?? 0,
    ...(input.model ? { model: input.model } : {}),
    outputTokens: input.outputTokens ?? 0,
    toolCalls: input.toolCalls ?? 0,
    attemptCount: input.attemptCount ?? 1,
    parentEventKey: input.parentEventKey ?? null,
    rootEventKey: input.rootEventKey ?? input.eventKey,
    ...(input.sectorExecutionId ? { sectorExecutionId: input.sectorExecutionId } : {}),
    ...(input.rootExecutionId ? { rootExecutionId: input.rootExecutionId } : {}),
    metadata: input.metadata ?? {},
  }
  try {
    await events.insertOne(doc)
    return true
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false // duplicate — already counted
    throw error
  }
}

// Finalize ONE logical execution that may span several attempts (a retried routine
// step). The first attempt creates the row; later attempts accumulate the real
// consumption (they DID run) and overwrite the status with the latest outcome — so a
// failure followed by a success ends as 'succeeded' with attemptCount=2, instead of
// the first failure occupying the key and the success being dropped.
export async function finalizeAgentEvent(input: RecordAgentEventInput): Promise<void> {
  const durationMs = input.durationMs ?? Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime())
  const attempt = input.attemptCount ?? 1

  // (1) ACCUMULATE — exactly once per attempt. Atomic: the filter itself carries the
  // guard (`seenAttempts` must not already contain this attempt), so matching and
  // applying happen in one document-level operation. No read-then-write, therefore no
  // race window: a redelivery of the SAME attempt simply matches nothing.
  const accumulate = () =>
    events.updateOne(
      { eventKey: input.eventKey, seenAttempts: { $ne: attempt } },
      {
        $setOnInsert: {
          ownerId: input.ownerId,
          buildingId: input.buildingId ?? null,
          floorId: input.floorId ?? null,
          agentId: input.agentId,
          source: input.source,
          preset: input.preset ?? 'custom',
          startedAt: input.startedAt,
          parentEventKey: input.parentEventKey ?? null,
          rootEventKey: input.rootEventKey ?? input.eventKey,
          // Correlation is set once, with the row: a later attempt of the same
          // execution belongs to the same request.
          ...(input.sectorExecutionId ? { sectorExecutionId: input.sectorExecutionId } : {}),
          ...(input.rootExecutionId ? { rootExecutionId: input.rootExecutionId } : {}),
          // O modelo não é somável: ele descreve a execução, e uma nova tentativa da
          // MESMA execução roda no mesmo modelo. Fica no `$set` junto do resto.
          ...(input.model ? { model: input.model } : {}),
        },
        $addToSet: { seenAttempts: attempt },
        $inc: {
          durationMs,
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          toolCalls: input.toolCalls ?? 0,
          attemptCount: 1,
        },
      },
      { upsert: true },
    )
  // An upsert whose filter carries a NEGATIVE guard cannot match an existing row that
  // already has this attempt, so Mongo attempts an insert and the unique eventKey
  // raises 11000. That duplicate is precisely the signal "this attempt is already
  // accounted" — either by an earlier call or by a concurrent one. Retry once (the
  // racing creator may have recorded a DIFFERENT attempt, which this call must still
  // accumulate); a second duplicate means it is definitively accounted.
  try {
    await accumulate()
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error
    try {
      await accumulate()
    } catch (retryError) {
      if ((retryError as { code?: number }).code !== 11000) throw retryError
    }
  }

  // (2) TERMINAL STATE — only an attempt >= the latest one already applied may move
  // status/finishedAt/metadata. A late write from attempt 1 can never overwrite the
  // success of attempt 2. Legacy rows (no latestAttempt) accept the first write.
  await events.updateOne(
    { eventKey: input.eventKey, $or: [{ latestAttempt: { $exists: false } }, { latestAttempt: { $lte: attempt } }] },
    { $set: { status: input.status, finishedAt: input.finishedAt, metadata: input.metadata ?? {}, latestAttempt: attempt } },
  )
}

// Compatibility for events written before per-attempt accounting existed: stamp
// seenAttempts/latestAttempt from the attemptCount they already carry, so the atomic
// guards above work on them too. Idempotent — only touches rows missing the fields.
export async function backfillAgentEventAttempts(): Promise<number> {
  const result = await events.updateMany({ seenAttempts: { $exists: false } }, [
    {
      $set: {
        attemptCount: { $ifNull: ['$attemptCount', 1] },
        latestAttempt: { $ifNull: ['$attemptCount', 1] },
        // Historical attempts are unknown individually; record the range they cover
        // so a replay of any of them is treated as already accounted.
        seenAttempts: {
          $map: { input: { $range: [1, { $add: [{ $ifNull: ['$attemptCount', 1] }, 1] }] }, as: 'n', in: '$$n' },
        },
      },
    },
  ])
  return result.modifiedCount
}

export function finalizeAgentEventSafe(input: RecordAgentEventInput): void {
  finalizeAgentEvent(input).catch((error) => console.error('finalizeAgentEvent failed:', (error as Error).message))
}

// Fire-and-forget wrapper: telemetry must never break or slow the real work.
export function recordAgentEventSafe(input: RecordAgentEventInput): void {
  recordAgentEvent(input).catch((error) => console.error('recordAgentEvent failed:', (error as Error).message))
}

// The earliest event for an owner — lets the UI say "dados desde …" and tell real
// zero apart from "telemetry hadn't started yet". null when there are no events.
export async function telemetrySince(ownerId: string): Promise<Date | null> {
  const first = await events.find({ ownerId }).sort({ startedAt: 1 }).limit(1).next()
  return first?.startedAt ?? null
}

/**
 * Quantos tokens em cada MODELO, na janela.
 *
 * É a resposta para "a economia é real?". O contador de tokens não responde: trocar um
 * agente do modelo caro para o barato não muda um único token — muda o preço de cada um.
 * A diferença só aparece quando os tokens são separados por modelo.
 *
 * Soma dos EVENTOS por agente, e não das execuções de rotina: assim entram também chat,
 * canal, delegação e etapa de setor, que é onde a maior parte do gasto acontece.
 *
 * Execuções gravadas antes deste campo aparecem como `desconhecido` — atribuí-las a um
 * modelo que ninguém registrou seria inventar o dado que a função existe para mostrar.
 */
export interface ModelUsageRow {
  model: string
  inputTokens: number
  outputTokens: number
  runs: number
}

export async function tokensByModelSince(
  ownerId: string,
  since: Date,
  escopo: { agentId?: ObjectId; floorId?: ObjectId } = {},
): Promise<ModelUsageRow[]> {
  const filtro: Record<string, unknown> = { ownerId, startedAt: { $gte: since } }
  if (escopo.agentId) filtro.agentId = escopo.agentId
  if (escopo.floorId) filtro.floorId = escopo.floorId

  const linhas = await events
    .aggregate<{ _id: string | null; inputTokens: number; outputTokens: number; runs: number }>([
      { $match: filtro },
      {
        $group: {
          _id: { $ifNull: ['$model', null] },
          inputTokens: { $sum: { $ifNull: ['$inputTokens', 0] } },
          outputTokens: { $sum: { $ifNull: ['$outputTokens', 0] } },
          runs: { $sum: 1 },
        },
      },
    ])
    .toArray()

  return linhas
    .map((l) => ({
      model: l._id ?? 'desconhecido',
      inputTokens: l.inputTokens,
      outputTokens: l.outputTokens,
      runs: l.runs,
    }))
    // Do maior gasto para o menor: é a ordem em que a pergunta é feita.
    .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
}

export { events as agentEventsCollection }
