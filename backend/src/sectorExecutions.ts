// One identity for a whole sector run.
//
// A sector execution is ONE request that several agents participate in. Without a
// root, "execuções do setor" would be the sum of its members' events — which counts
// a three-stage pipeline as three executions and makes the sector page disagree with
// the agent page. The root is created before the first agent and closed in success,
// failure or cancellation; the numbers on top of it come from the CHILD events, so
// tokens and durations are never counted twice.
//
// Nothing here stores content: a snapshot of the sector's name/mode, ids, statuses,
// counts and durations. A sector renamed or deleted later still reads correctly,
// because the snapshot was taken at execution time.
import { ObjectId } from 'mongodb'
import { db } from './db.js'

export type SectorExecutionStatus = 'running' | 'succeeded' | 'failed' | 'canceled'
export type SectorExecutionSource = 'delegation' | 'routine' | 'channel' | 'manual' | 'webhook'
// A playground run is real work, but it is not production: it is recorded and then
// excluded from the metrics by default (plan §8.1.6).
export type ExecutionEnvironment = 'production' | 'test'

export type ParticipationRole = 'coordinator' | 'specialist' | 'pipeline_stage'

export interface SectorExecution {
  _id: ObjectId
  // Deterministic: the same logical call always produces the same key, so a retry or
  // a redelivery reuses the root instead of creating a second one.
  executionKey: string
  ownerId: string
  sectorId: ObjectId
  // Snapshot: what the sector WAS when it ran.
  sectorName: string
  sectorMode: string
  floorId: ObjectId | null
  buildingId: ObjectId | null
  source: SectorExecutionSource
  // The run/conversation this belongs to, when there is one.
  correlationId: string | null
  callerAgentId: ObjectId | null
  environment: ExecutionEnvironment
  status: SectorExecutionStatus
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
  // Categorised, never the message.
  errorKind: string | null
  createdAt: Date
}

const executions = db.collection<SectorExecution>('sector_executions')
const agentEvents = db.collection('agent_execution_events')

export async function ensureSectorExecutionIndexes(): Promise<void> {
  await executions.createIndex({ executionKey: 1 }, { unique: true })
  await executions.createIndex({ ownerId: 1, sectorId: 1, startedAt: -1 })
  await executions.createIndex({ ownerId: 1, startedAt: -1 })
  // Participations are found by root; the index lives on the events collection.
  await agentEvents.createIndex({ ownerId: 1, sectorExecutionId: 1 })
}

// The key is built from what identifies the CALL, not from the attempt: a retried
// stage or a redelivered webhook lands on the same root.
export const sectorExecutionKey = (input: { correlationId: string | null; sectorId: string; callerAgentId?: string | null; depth?: number }): string =>
  `sector:${input.correlationId ?? 'none'}:${input.sectorId}:${input.callerAgentId ?? 'root'}:${input.depth ?? 0}`

export interface StartSectorExecutionInput {
  executionKey: string
  ownerId: string
  sectorId: ObjectId
  sectorName: string
  sectorMode: string
  floorId?: ObjectId | null
  buildingId?: ObjectId | null
  source: SectorExecutionSource
  correlationId?: string | null
  callerAgentId?: ObjectId | null
  environment?: ExecutionEnvironment
  startedAt?: Date
}

// Idempotent: a second start for the same key returns the existing root untouched,
// so a retry never restarts the clock or duplicates the execution.
export async function startSectorExecution(input: StartSectorExecutionInput): Promise<ObjectId> {
  const now = input.startedAt ?? new Date()
  const doc: SectorExecution = {
    _id: new ObjectId(),
    executionKey: input.executionKey,
    ownerId: input.ownerId,
    sectorId: input.sectorId,
    sectorName: input.sectorName,
    sectorMode: input.sectorMode,
    floorId: input.floorId ?? null,
    buildingId: input.buildingId ?? null,
    source: input.source,
    correlationId: input.correlationId ?? null,
    callerAgentId: input.callerAgentId ?? null,
    environment: input.environment ?? 'production',
    status: 'running',
    startedAt: now,
    finishedAt: null,
    durationMs: null,
    errorKind: null,
    createdAt: now,
  }
  const r = await executions.findOneAndUpdate(
    { executionKey: input.executionKey },
    { $setOnInsert: doc },
    { upsert: true, returnDocument: 'after' },
  )
  return r?._id ?? doc._id
}

// Closing is idempotent too, and it never reopens: the first terminal status wins,
// so a late failure from an abandoned attempt cannot overwrite a success.
export async function finishSectorExecution(
  executionKey: string,
  outcome: { status: Exclude<SectorExecutionStatus, 'running'>; errorKind?: string | null; finishedAt?: Date },
): Promise<void> {
  const finishedAt = outcome.finishedAt ?? new Date()
  const current = await executions.findOne({ executionKey })
  if (!current || current.status !== 'running') return
  await executions.updateOne(
    { executionKey, status: 'running' },
    {
      $set: {
        status: outcome.status,
        finishedAt,
        durationMs: finishedAt.getTime() - current.startedAt.getTime(),
        errorKind: outcome.errorKind ?? null,
      },
    },
  )
}

// A failure BEFORE the first agent still has to exist: "the sector was called and
// nothing ran" is an outcome, not an absence.
export async function recordFailedSectorExecution(input: StartSectorExecutionInput & { errorKind: string }): Promise<void> {
  await startSectorExecution(input)
  await finishSectorExecution(input.executionKey, { status: 'failed', errorKind: input.errorKind })
}

// --- reading ---------------------------------------------------------------------

export type ExecutionPeriod = '7d' | '30d' | 'all'

export const periodStart = (period: ExecutionPeriod, now: Date = new Date()): Date | null => {
  if (period === 'all') return null
  const days = period === '7d' ? 7 : 30
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

export interface SectorExecutionSummary {
  period: ExecutionPeriod
  // Null when this sector has no telemetry at all — never a fabricated zero.
  telemetrySince: string | null
  executions: number
  running: number
  succeeded: number
  failed: number
  canceled: number
  successRate: number | null
  totalTokens: number
  avgTokensPerExecution: number | null
  // End to end, from the root: the real duration of the request.
  avgDurationMs: number | null
  // Summed leaf inference time. With parallel agents it can EXCEED the end-to-end
  // duration, which is why it is a separate, differently-labelled number.
  activeTimeMs: number
  avgParticipants: number | null
  byParticipant: {
    agentId: string
    role: ParticipationRole | null
    stageId: string | null
    stageName: string | null
    participations: number
    succeeded: number
    tokens: number
    activeTimeMs: number
    avgDurationMs: number | null
  }[]
}

interface ParticipationRow {
  agentId?: ObjectId
  sectorExecutionId?: ObjectId
  status?: string
  inputTokens?: number
  outputTokens?: number
  metadata?: Record<string, unknown>
  startedAt?: Date
  finishedAt?: Date
}

const durationOf = (row: ParticipationRow): number => {
  const declared = Number(row.metadata?.durationMs)
  if (Number.isFinite(declared) && declared >= 0) return declared
  if (row.startedAt && row.finishedAt) return Math.max(0, row.finishedAt.getTime() - row.startedAt.getTime())
  return 0
}

export async function sectorExecutionSummary(
  ownerId: string,
  sectorId: ObjectId,
  period: ExecutionPeriod,
  opts: { includeTest?: boolean; now?: Date } = {},
): Promise<SectorExecutionSummary> {
  const now = opts.now ?? new Date()
  const since = periodStart(period, now)
  const filter: Record<string, unknown> = { ownerId, sectorId }
  if (!opts.includeTest) filter.environment = { $ne: 'test' }
  if (since) filter.startedAt = { $gte: since }

  const [roots, oldest] = await Promise.all([
    executions.find(filter).toArray(),
    executions.find({ ownerId, sectorId }).sort({ startedAt: 1 }).limit(1).toArray(),
  ])

  const rootIds = roots.map((r) => r._id)
  const participations = rootIds.length
    ? ((await agentEvents.find({ ownerId, sectorExecutionId: { $in: rootIds } }).toArray()) as ParticipationRow[])
    : []

  const finished = roots.filter((r) => r.status !== 'running')
  const succeeded = roots.filter((r) => r.status === 'succeeded').length
  const withDuration = roots.filter((r) => typeof r.durationMs === 'number') as (SectorExecution & { durationMs: number })[]

  const tokens = participations.reduce((sum, p) => sum + (p.inputTokens ?? 0) + (p.outputTokens ?? 0), 0)
  const activeTimeMs = participations.reduce((sum, p) => sum + durationOf(p), 0)

  // Per participant: an agent called twice in the same execution has two
  // participations, and the execution still counts once.
  const byKey = new Map<string, SectorExecutionSummary['byParticipant'][number] & { durations: number[] }>()
  for (const p of participations) {
    const agentId = p.agentId?.toString() ?? 'desconhecido'
    const stageId = typeof p.metadata?.stageId === 'string' ? (p.metadata.stageId as string) : null
    const key = `${agentId}:${stageId ?? ''}`
    const entry = byKey.get(key) ?? {
      agentId,
      role: (typeof p.metadata?.role === 'string' ? (p.metadata.role as ParticipationRole) : null),
      stageId,
      stageName: typeof p.metadata?.stageName === 'string' ? (p.metadata.stageName as string) : null,
      participations: 0,
      succeeded: 0,
      tokens: 0,
      activeTimeMs: 0,
      avgDurationMs: null,
      durations: [] as number[],
    }
    entry.participations += 1
    if (p.status === 'succeeded') entry.succeeded += 1
    entry.tokens += (p.inputTokens ?? 0) + (p.outputTokens ?? 0)
    const d = durationOf(p)
    entry.activeTimeMs += d
    entry.durations.push(d)
    byKey.set(key, entry)
  }

  const byParticipant = [...byKey.values()]
    .map(({ durations, ...rest }) => ({
      ...rest,
      avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    }))
    .sort((a, b) => b.participations - a.participations || a.agentId.localeCompare(b.agentId))

  const participantsPerRoot = new Map<string, number>()
  for (const p of participations) {
    const key = p.sectorExecutionId?.toString() ?? ''
    participantsPerRoot.set(key, (participantsPerRoot.get(key) ?? 0) + 1)
  }

  return {
    period,
    telemetrySince: oldest[0]?.startedAt ? oldest[0].startedAt.toISOString() : null,
    executions: roots.length,
    running: roots.filter((r) => r.status === 'running').length,
    succeeded,
    failed: roots.filter((r) => r.status === 'failed').length,
    canceled: roots.filter((r) => r.status === 'canceled').length,
    successRate: finished.length ? succeeded / finished.length : null,
    totalTokens: tokens,
    avgTokensPerExecution: roots.length ? Math.round(tokens / roots.length) : null,
    avgDurationMs: withDuration.length ? Math.round(withDuration.reduce((sum, r) => sum + r.durationMs, 0) / withDuration.length) : null,
    activeTimeMs,
    avgParticipants: rootIds.length ? Number((participations.length / rootIds.length).toFixed(2)) : null,
    byParticipant,
  }
}

export interface SectorExecutionListItem {
  id: string
  status: SectorExecutionStatus
  source: SectorExecutionSource
  environment: ExecutionEnvironment
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  errorKind: string | null
  tokens: number
  participants: number
}

export interface SectorExecutionFilters {
  period?: ExecutionPeriod
  status?: SectorExecutionStatus
  agentId?: string
  stageId?: string
  source?: SectorExecutionSource
  includeTest?: boolean
  cursor?: string | null
  limit?: number
}

export async function listSectorExecutions(
  ownerId: string,
  sectorId: ObjectId,
  filters: SectorExecutionFilters = {},
  now: Date = new Date(),
): Promise<{ items: SectorExecutionListItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100)
  const filter: Record<string, unknown> = { ownerId, sectorId }
  if (!filters.includeTest) filter.environment = { $ne: 'test' }
  if (filters.status) filter.status = filters.status
  if (filters.source) filter.source = filters.source
  const since = periodStart(filters.period ?? 'all', now)
  if (since) filter.startedAt = { $gte: since }
  // Cursor over (startedAt, _id): stable while new executions arrive.
  if (filters.cursor) {
    const [at, id] = filters.cursor.split('|')
    const date = new Date(at)
    if (!Number.isNaN(date.getTime()) && ObjectId.isValid(id)) {
      filter.$or = [{ startedAt: { $lt: date } }, { startedAt: date, _id: { $lt: new ObjectId(id) } }]
    }
  }

  // Filtering by participant means "executions this agent/stage took part in".
  if (filters.agentId || filters.stageId) {
    const participationFilter: Record<string, unknown> = { ownerId, sectorExecutionId: { $exists: true } }
    if (filters.agentId && ObjectId.isValid(filters.agentId)) participationFilter.agentId = new ObjectId(filters.agentId)
    if (filters.stageId) participationFilter['metadata.stageId'] = filters.stageId
    const ids = (await agentEvents.distinct('sectorExecutionId', participationFilter)) as ObjectId[]
    filter._id = { $in: ids }
  }

  const rows = await executions.find(filter).sort({ startedAt: -1, _id: -1 }).limit(limit + 1).toArray()
  const page = rows.slice(0, limit)
  const ids = page.map((r) => r._id)
  const participations = ids.length ? ((await agentEvents.find({ ownerId, sectorExecutionId: { $in: ids } }).toArray()) as ParticipationRow[]) : []

  const tokensByRoot = new Map<string, number>()
  const countByRoot = new Map<string, number>()
  for (const p of participations) {
    const key = p.sectorExecutionId?.toString() ?? ''
    tokensByRoot.set(key, (tokensByRoot.get(key) ?? 0) + (p.inputTokens ?? 0) + (p.outputTokens ?? 0))
    countByRoot.set(key, (countByRoot.get(key) ?? 0) + 1)
  }

  return {
    items: page.map((r) => ({
      id: r._id.toString(),
      status: r.status,
      source: r.source,
      environment: r.environment,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      durationMs: r.durationMs,
      errorKind: r.errorKind,
      tokens: tokensByRoot.get(r._id.toString()) ?? 0,
      participants: countByRoot.get(r._id.toString()) ?? 0,
    })),
    nextCursor: rows.length > limit ? `${page[page.length - 1].startedAt.toISOString()}|${page[page.length - 1]._id.toString()}` : null,
  }
}

export interface SectorExecutionTimelineStep {
  agentId: string
  role: ParticipationRole | null
  stageId: string | null
  stageName: string | null
  stageOrder: number | null
  status: string
  startedAt: string
  finishedAt: string | null
  durationMs: number
  attempts: number
  tokens: number
  toolCalls: number
  // Categorised only: the stored message is never returned.
  errorKind: string | null
}

// The sanitized timeline of one execution. Owner is in the query, so an id from
// another account simply is not found.
export async function sectorExecutionTimeline(
  ownerId: string,
  executionId: ObjectId,
): Promise<{ execution: SectorExecutionListItem & { sectorId: string; sectorName: string; sectorMode: string }; steps: SectorExecutionTimelineStep[] } | null> {
  const root = await executions.findOne({ _id: executionId, ownerId })
  if (!root) return null
  const rows = (await agentEvents.find({ ownerId, sectorExecutionId: root._id }).sort({ startedAt: 1 }).toArray()) as ParticipationRow[]

  const steps: SectorExecutionTimelineStep[] = rows.map((p) => ({
    agentId: p.agentId?.toString() ?? '',
    role: typeof p.metadata?.role === 'string' ? (p.metadata.role as ParticipationRole) : null,
    stageId: typeof p.metadata?.stageId === 'string' ? (p.metadata.stageId as string) : null,
    stageName: typeof p.metadata?.stageName === 'string' ? (p.metadata.stageName as string) : null,
    stageOrder: typeof p.metadata?.stageOrder === 'number' ? (p.metadata.stageOrder as number) : null,
    status: String(p.status ?? 'unknown'),
    startedAt: (p.startedAt ?? root.startedAt).toISOString(),
    finishedAt: p.finishedAt ? p.finishedAt.toISOString() : null,
    durationMs: durationOf(p),
    attempts: Number((p as { attemptCount?: number }).attemptCount ?? 1),
    tokens: (p.inputTokens ?? 0) + (p.outputTokens ?? 0),
    toolCalls: Number((p as { toolCalls?: number }).toolCalls ?? 0),
    errorKind: typeof p.metadata?.errorKind === 'string' ? (p.metadata.errorKind as string) : null,
  }))

  return {
    execution: {
      id: root._id.toString(),
      sectorId: root.sectorId.toString(),
      sectorName: root.sectorName,
      sectorMode: root.sectorMode,
      status: root.status,
      source: root.source,
      environment: root.environment,
      startedAt: root.startedAt.toISOString(),
      finishedAt: root.finishedAt ? root.finishedAt.toISOString() : null,
      durationMs: root.durationMs,
      errorKind: root.errorKind,
      tokens: steps.reduce((sum, s) => sum + s.tokens, 0),
      participants: steps.length,
    },
    steps,
  }
}
