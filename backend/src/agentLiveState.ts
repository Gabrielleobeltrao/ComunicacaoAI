// What each agent is REALLY doing right now, projected from the runtime.
//
// Two rules define this file. First, the runtime is the only source: a state exists
// because a run was created, a model was called, a tool ran, a delegation left, a
// delivery was sent — never because a document says "working" or because a schedule
// exists. An agent with an armed trigger and no execution has no state at all.
// Second, nothing here can leak: `safeDetail` is built from an allowlist in the
// backend, so a tool name, a provider label or an error message can never become a
// caption on the map.
//
// The projection is ephemeral by construction: every row carries `expiresAt` and a
// TTL index removes it. A crashed worker therefore cannot leave an agent "thinking"
// forever — the state disappears on its own.
import { ObjectId } from 'mongodb'
import { db } from './db.js'

export type AgentBubbleState =
  | 'queued'
  | 'thinking'
  | 'researching'
  | 'reading_knowledge'
  | 'using_tool'
  | 'delegating_agent'
  | 'delegating_sector'
  | 'waiting_external'
  | 'waiting_input'
  | 'responding'
  | 'generating_output'
  | 'validating_output'
  | 'delivering'
  | 'retrying'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'canceled'

export const AGENT_BUBBLE_STATES: AgentBubbleState[] = [
  'queued',
  'thinking',
  'researching',
  'reading_knowledge',
  'using_tool',
  'delegating_agent',
  'delegating_sector',
  'waiting_external',
  'waiting_input',
  'responding',
  'generating_output',
  'validating_output',
  'delivering',
  'retrying',
  'completed',
  'blocked',
  'failed',
  'canceled',
]

// An execution that ended: the row stays only long enough to be seen, then goes.
export const TERMINAL_STATES: AgentBubbleState[] = ['completed', 'failed', 'canceled']

// How long a row survives without another update. An active state is refreshed by
// the next transition; if the worker dies, the row expires instead of lying.
export const ACTIVE_TTL_MS = 120_000
// Terminal states stay only for their display time (plan §5.9 catalogue).
export const TERMINAL_TTL_MS: Record<string, number> = { completed: 3_000, canceled: 3_000, failed: 6_000 }
// `blocked` waits for a person, so it lives longer than an active step.
export const BLOCKED_TTL_MS = 600_000

export function ttlFor(state: AgentBubbleState): number {
  if (TERMINAL_TTL_MS[state]) return TERMINAL_TTL_MS[state]
  if (state === 'blocked' || state === 'waiting_input') return BLOCKED_TTL_MS
  return ACTIVE_TTL_MS
}

// What a caption may say. Nothing here is free text from a tool, a provider or a
// model: `appKey` is checked against the catalog by the caller, `actionLabel` is a
// short public label, and `targetType` is an enum.
export interface AgentSafeDetail {
  appKey?: string
  actionLabel?: string
  targetType?: 'agent' | 'sector' | 'channel'
}

const MAX_LABEL_CHARS = 40
const TARGET_TYPES = ['agent', 'sector', 'channel']

// Built by allowlist, not by scrubbing: an unknown key is dropped, a long value is
// dropped (a long string is a payload, not a label), and anything that looks like a
// URL, a path or an argument never had a field to travel in.
export function safeDetail(input: unknown): AgentSafeDetail | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const raw = input as Record<string, unknown>
  const out: AgentSafeDetail = {}
  const label = typeof raw.actionLabel === 'string' ? raw.actionLabel.trim() : ''
  const appKey = typeof raw.appKey === 'string' ? raw.appKey.trim() : ''
  if (appKey && /^[a-z][a-z0-9_]{0,48}$/.test(appKey)) out.appKey = appKey
  if (label && label.length <= MAX_LABEL_CHARS && !/[\n\r]/.test(label) && !/https?:|\/\//.test(label)) out.actionLabel = label
  if (typeof raw.targetType === 'string' && TARGET_TYPES.includes(raw.targetType)) out.targetType = raw.targetType as AgentSafeDetail['targetType']
  return Object.keys(out).length > 0 ? out : undefined
}

export interface AgentLiveState {
  _id: ObjectId
  ownerId: string
  agentId: ObjectId
  floorId: ObjectId | null
  // The whole request this participation belongs to. Until ExecutionRoot exists,
  // the run/conversation id plays that part — the field is already the right shape.
  rootExecutionId: string
  state: AgentBubbleState
  detail: AgentSafeDetail | null
  // Monotonic guard: a late write from a slower path can never overwrite a newer
  // transition. Same sequence + same state = the same fact, written twice.
  sequence: number
  startedAt: Date
  updatedAt: Date
  expiresAt: Date
}

const liveStates = db.collection<AgentLiveState>('agent_live_states')

export async function ensureAgentLiveStateIndexes(): Promise<void> {
  await liveStates.createIndex({ ownerId: 1, agentId: 1, rootExecutionId: 1 }, { unique: true })
  await liveStates.createIndex({ ownerId: 1, floorId: 1, updatedAt: -1 })
  // Mongo removes the row itself: no cleanup job, no agent stuck after a crash.
  await liveStates.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

export interface ReportStateInput {
  ownerId: string
  agentId: ObjectId | string
  floorId?: ObjectId | string | null
  rootExecutionId: string
  state: AgentBubbleState
  detail?: unknown
  // Defaults to now; passed in by tests and by paths that replay an event.
  at?: Date
  sequence?: number
}

const toId = (value: ObjectId | string): ObjectId => (value instanceof ObjectId ? value : new ObjectId(value))
const toOptionalId = (value?: ObjectId | string | null): ObjectId | null =>
  value === undefined || value === null ? null : value instanceof ObjectId ? value : ObjectId.isValid(value) ? new ObjectId(value) : null

// Record a transition. Idempotent and monotonic: replaying the same transition
// changes nothing, and an older one is ignored.
export async function reportAgentState(input: ReportStateInput): Promise<void> {
  const now = input.at ?? new Date()
  const sequence = input.sequence ?? now.getTime()
  const agentId = toId(input.agentId)
  const detail = safeDetail(input.detail) ?? null

  try {
    await liveStates.updateOne(
      { ownerId: input.ownerId, agentId, rootExecutionId: input.rootExecutionId, sequence: { $lte: sequence } },
      {
        $set: {
          state: input.state,
          detail,
          sequence,
          updatedAt: now,
          expiresAt: new Date(now.getTime() + ttlFor(input.state)),
          floorId: toOptionalId(input.floorId),
        },
        $setOnInsert: { ownerId: input.ownerId, agentId, rootExecutionId: input.rootExecutionId, startedAt: now },
      },
      { upsert: true },
    )
  } catch (error) {
    // A duplicate key means a NEWER row already exists for this execution (the
    // filter's `sequence <= n` excluded it). That is exactly the case a monotonic
    // projection must ignore, not retry.
    if ((error as { code?: number }).code !== 11000) throw error
  }
}

// Called in `finally`: an execution that ends — successfully, in failure, cancelled,
// timed out or crashed and recovered — always lands on a terminal state with a short
// display TTL. Never leaves the row on an active state.
export async function finishAgentState(input: Omit<ReportStateInput, 'state'> & { state: 'completed' | 'failed' | 'canceled' }): Promise<void> {
  await reportAgentState(input)
}

// Remove a participation outright (used when an execution is discarded before it
// produced anything worth showing).
export async function clearAgentState(ownerId: string, agentId: ObjectId | string, rootExecutionId: string): Promise<void> {
  await liveStates.deleteOne({ ownerId, agentId: toId(agentId), rootExecutionId })
}

// Priority when one agent participates in several executions at once (plan §8.6).
// Lower index wins; ties break on the most recent update. Phases from different
// roots are never merged or summed.
const PRIORITY: AgentBubbleState[] = [
  'failed',
  'blocked',
  'waiting_input',
  'retrying',
  'delivering',
  'validating_output',
  'generating_output',
  'delegating_agent',
  'delegating_sector',
  'using_tool',
  'researching',
  'reading_knowledge',
  'responding',
  'thinking',
  'waiting_external',
  'queued',
  'canceled',
  'completed',
]
const rank = (state: AgentBubbleState): number => {
  const i = PRIORITY.indexOf(state)
  return i === -1 ? PRIORITY.length : i
}

export interface AgentLiveVisualState {
  agentId: string
  floorId: string | null
  rootExecutionId: string
  state: AgentBubbleState
  safeDetail?: AgentSafeDetail
  startedAt: string
  updatedAt: string
  expiresAt: string
  // How many other executions this agent is in right now. The map shows one state
  // and, optionally, "+N" — it never flickers between them.
  concurrent: number
}

// Pure: the selection rule, so it can be tested without a database.
export function selectVisualStates(rows: AgentLiveState[], now: Date = new Date()): AgentLiveVisualState[] {
  const byAgent = new Map<string, AgentLiveState[]>()
  for (const row of rows) {
    // A row past its TTL is already gone as far as the map is concerned, whether or
    // not Mongo's background task has removed it yet.
    if (row.expiresAt.getTime() <= now.getTime()) continue
    const key = row.agentId.toString()
    byAgent.set(key, [...(byAgent.get(key) ?? []), row])
  }

  const out: AgentLiveVisualState[] = []
  for (const [agentId, agentRows] of byAgent) {
    const chosen = agentRows.slice().sort((a, b) => rank(a.state) - rank(b.state) || b.updatedAt.getTime() - a.updatedAt.getTime())[0]
    out.push({
      agentId,
      floorId: chosen.floorId ? chosen.floorId.toString() : null,
      rootExecutionId: chosen.rootExecutionId,
      state: chosen.state,
      ...(chosen.detail ? { safeDetail: chosen.detail } : {}),
      startedAt: chosen.startedAt.toISOString(),
      updatedAt: chosen.updatedAt.toISOString(),
      expiresAt: chosen.expiresAt.toISOString(),
      concurrent: agentRows.length,
    })
  }
  return out.sort((a, b) => a.agentId.localeCompare(b.agentId))
}

export const LIVE_STATE_DTO_VERSION = 1

export interface AgentLiveStatesResponse {
  version: number
  generatedAt: string
  states: AgentLiveVisualState[]
}

// The read model for one floor. Owner AND floor are in the query, so a floor from
// another account simply has no rows.
export async function agentLiveStatesForFloor(ownerId: string, floorId: ObjectId, now: Date = new Date()): Promise<AgentLiveStatesResponse> {
  const rows = await liveStates.find({ ownerId, floorId, expiresAt: { $gt: now } }).toArray()
  return { version: LIVE_STATE_DTO_VERSION, generatedAt: now.toISOString(), states: selectVisualStates(rows, now) }
}

// A weak validator over what the client already has, so an unchanged map costs a
// 304 instead of a payload.
export const liveStatesEtag = (response: AgentLiveStatesResponse): string => {
  const fingerprint = response.states.map((s) => `${s.agentId}:${s.state}:${s.updatedAt}`).join('|')
  return `W/"ls-${response.states.length}-${fingerprint.length}-${fingerprint.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36)}"`
}

// The legacy shape the office map still consumes (`Record<agentId, 'working'>`).
// Kept so the current UI is untouched until the bubble layer ships.
export const legacyWorkingMap = (response: AgentLiveStatesResponse): Record<string, 'working'> => {
  const out: Record<string, 'working'> = {}
  for (const s of response.states) {
    if (!TERMINAL_STATES.includes(s.state)) out[s.agentId] = 'working'
  }
  return out
}
