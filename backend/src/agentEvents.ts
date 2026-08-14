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
export type AgentEventStatus = 'succeeded' | 'failed'

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
  toolCalls: number
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
  toolCalls?: number
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
    outputTokens: input.outputTokens ?? 0,
    toolCalls: input.toolCalls ?? 0,
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

export { events as agentEventsCollection }
