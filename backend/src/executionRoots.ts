// One identity per REQUEST, so building, floor, sector and agent can be reconciled.
//
// Without a root, the building's number is the sum of the floors', which is the sum
// of the sectors', which is the sum of the agents' — and a single task that crossed
// two floors and three agents is counted six times. A root represents the complete
// request; agents and sectors are participations in it.
//
// Additive by construction: a record written before this model has no root, and is
// reported as partial telemetry rather than being guessed into one.
import { ObjectId } from 'mongodb'
import { db } from './db.js'

export type ExecutionSource = 'schedule' | 'webhook' | 'channel' | 'manual' | 'delegation'
export type ExecutionRootStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
export type ExecutionEnvironment = 'production' | 'test'

export interface ExecutionRoot {
  _id: ObjectId
  // Deterministic per request: a retry or a redelivery reuses it.
  executionKey: string
  ownerId: string
  buildingId: ObjectId | null
  originFloorId: ObjectId | null
  source: ExecutionSource
  sourceRefId: ObjectId | null
  environment: ExecutionEnvironment
  status: ExecutionRootStatus
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  errorKind: string | null
}

const roots = db.collection<ExecutionRoot>('execution_roots')

export async function ensureExecutionRootIndexes(): Promise<void> {
  await roots.createIndex({ executionKey: 1 }, { unique: true })
  await roots.createIndex({ ownerId: 1, createdAt: -1 })
  await roots.createIndex({ ownerId: 1, originFloorId: 1, createdAt: -1 })
}

export const runExecutionKey = (runId: string): string => `run:${runId}`
// A channel turn is one request: the same conversation message must not open two
// roots if the webhook is redelivered.
export const channelExecutionKey = (widgetId: string, conversationId: string, messageId: string): string =>
  `channel:${widgetId}:${conversationId}:${messageId}`
export const manualExecutionKey = (eventKey: string): string => `manual:${eventKey}`

// Open a root and hand back its id in one step, for the paths that have no separate
// "queued" moment — a channel turn and a manual test start running immediately.
export async function openRunningRoot(input: StartRootInput): Promise<ObjectId> {
  const id = await startExecutionRoot(input)
  await markRootRunning(input.executionKey, input.createdAt)
  return id
}

export interface StartRootInput {
  executionKey: string
  ownerId: string
  buildingId?: ObjectId | null
  originFloorId?: ObjectId | null
  source: ExecutionSource
  sourceRefId?: ObjectId | null
  environment?: ExecutionEnvironment
  createdAt?: Date
}

// Idempotent: the same request always lands on the same root.
export async function startExecutionRoot(input: StartRootInput): Promise<ObjectId> {
  const now = input.createdAt ?? new Date()
  const doc: ExecutionRoot = {
    _id: new ObjectId(),
    executionKey: input.executionKey,
    ownerId: input.ownerId,
    buildingId: input.buildingId ?? null,
    originFloorId: input.originFloorId ?? null,
    source: input.source,
    sourceRefId: input.sourceRefId ?? null,
    environment: input.environment ?? 'production',
    status: 'queued',
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    errorKind: null,
  }
  const r = await roots.findOneAndUpdate({ executionKey: input.executionKey }, { $setOnInsert: doc }, { upsert: true, returnDocument: 'after' })
  return r?._id ?? doc._id
}

export async function markRootRunning(executionKey: string, at: Date = new Date()): Promise<void> {
  await roots.updateOne({ executionKey, startedAt: null }, { $set: { status: 'running', startedAt: at } })
}

// The first terminal status wins: a late failure from an abandoned attempt never
// overwrites a success.
export async function finishExecutionRoot(
  executionKey: string,
  outcome: { status: Exclude<ExecutionRootStatus, 'queued' | 'running'>; errorKind?: string | null; finishedAt?: Date },
): Promise<void> {
  await roots.updateOne(
    { executionKey, status: { $in: ['queued', 'running'] } },
    { $set: { status: outcome.status, finishedAt: outcome.finishedAt ?? new Date(), errorKind: outcome.errorKind ?? null } },
  )
}

export const findRootByKey = (ownerId: string, executionKey: string) => roots.findOne({ ownerId, executionKey })

export type AnalyticsScope = 'building' | 'floor' | 'sector' | 'agent'
export type AnalyticsPeriod = '7d' | '30d' | 'all'

export const analyticsPeriodStart = (period: AnalyticsPeriod, now: Date = new Date()): Date | null =>
  period === 'all' ? null : new Date(now.getTime() - (period === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000)

export interface AnalyticsResult {
  scope: AnalyticsScope
  period: AnalyticsPeriod
  telemetrySince: string | null
  // A ROOT is one complete request. Never the sum of participations.
  executions: number
  succeeded: number
  failed: number
  canceled: number
  running: number
  successRate: number | null
  // finishedAt - startedAt of the ROOT.
  avgDurationMs: number | null
  p95DurationMs: number | null
  // startedAt - createdAt: how long it waited for a worker.
  avgQueueMs: number | null
  // Summed leaf inference time. With parallelism it CAN exceed the end-to-end
  // duration, and it is labelled as a different thing for exactly that reason.
  activeTimeMs: number
  totalTokens: number
  avgTokensPerExecution: number | null
  participations: number
  // Distinct requests this scope TOOK PART IN. For a floor this is a different
  // question from `executions` (requests that STARTED here), and the two must never
  // share a denominator: a floor can participate in work another floor originated.
  participatedExecutions: number
  // Records with no root: reported, never estimated into the numbers above.
  partialTelemetry: number
}

interface LeafEvent {
  ownerId: string
  agentId?: ObjectId
  floorId?: ObjectId | null
  sectorExecutionId?: ObjectId | null
  rootExecutionId?: ObjectId | null
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  status?: string
  startedAt?: Date
  finishedAt?: Date
  metadata?: Record<string, unknown>
}

const percentile = (values: number[], p: number): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

export interface AnalyticsQuery {
  ownerId: string
  scope: AnalyticsScope
  period: AnalyticsPeriod
  floorId?: ObjectId
  sectorId?: ObjectId
  agentId?: ObjectId
  includeTest?: boolean
  now?: Date
}

// ONE service, one set of definitions. Building, floor, sector and agent may not
// implement different formulas — that is how four pages end up disagreeing.
export async function executionAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult> {
  const now = query.now ?? new Date()
  const since = analyticsPeriodStart(query.period, now)

  const rootFilter: Record<string, unknown> = { ownerId: query.ownerId }
  if (!query.includeTest) rootFilter.environment = { $ne: 'test' }
  if (since) rootFilter.createdAt = { $gte: since }
  if (query.scope === 'floor' && query.floorId) rootFilter.originFloorId = query.floorId

  const eventFilter: Record<string, unknown> = { ownerId: query.ownerId }
  if (since) eventFilter.startedAt = { $gte: since }
  if (query.scope === 'agent' && query.agentId) eventFilter.agentId = query.agentId
  if (query.scope === 'floor' && query.floorId) eventFilter.floorId = query.floorId

  const events = db.collection<LeafEvent>('agent_execution_events')

  // For sector scope the roots are the sector executions themselves: that is the
  // request from the sector's point of view.
  if (query.scope === 'sector' && query.sectorId) {
    const sectorFilter: Record<string, unknown> = { ownerId: query.ownerId, sectorId: query.sectorId }
    if (!query.includeTest) sectorFilter.environment = { $ne: 'test' }
    if (since) sectorFilter.startedAt = { $gte: since }
    const [sectorRoots, oldest] = await Promise.all([
      db.collection('sector_executions').find(sectorFilter).toArray(),
      db.collection('sector_executions').find({ ownerId: query.ownerId, sectorId: query.sectorId }).sort({ startedAt: 1 }).limit(1).toArray(),
    ])
    const ids = sectorRoots.map((r) => r._id as ObjectId)
    const leaves = ids.length ? await events.find({ ownerId: query.ownerId, sectorExecutionId: { $in: ids } }).toArray() : []
    return summarize(query, sectorRoots as unknown as ExecutionRoot[], leaves, oldest[0]?.startedAt ?? null, 0)
  }

  const [rootDocs, oldest, leaves] = await Promise.all([
    roots.find(rootFilter).toArray(),
    roots.find({ ownerId: query.ownerId }).sort({ createdAt: 1 }).limit(1).toArray(),
    events.find(eventFilter).toArray(),
  ])

  // Agent scope: the agent's own participations decide which roots it took part in,
  // so a request it did not touch never lands in its numbers.
  if (query.scope === 'agent') {
    const rootIds = new Set(leaves.map((l) => l.rootExecutionId?.toString()).filter(Boolean) as string[])
    const own = rootDocs.filter((r) => rootIds.has(r._id.toString()))
    const orphan = leaves.filter((l) => !l.rootExecutionId).length
    return summarize(query, own, leaves, oldest[0]?.createdAt ?? null, orphan)
  }

  const orphanLeaves = leaves.filter((l) => !l.rootExecutionId && !l.sectorExecutionId).length
  return summarize(query, rootDocs, leaves, oldest[0]?.createdAt ?? null, orphanLeaves)
}

function summarize(query: AnalyticsQuery, rootDocs: ExecutionRoot[], leaves: LeafEvent[], since: Date | null, partial: number): AnalyticsResult {
  const finished = rootDocs.filter((r) => r.status === 'succeeded' || r.status === 'failed' || r.status === 'canceled')
  const succeeded = rootDocs.filter((r) => r.status === 'succeeded').length

  const durations = rootDocs
    .filter((r) => r.startedAt && r.finishedAt)
    .map((r) => (r.finishedAt as Date).getTime() - (r.startedAt as Date).getTime())
    .filter((d) => d >= 0)
  const queues = rootDocs
    .filter((r) => r.startedAt && r.createdAt)
    .map((r) => (r.startedAt as Date).getTime() - r.createdAt.getTime())
    .filter((d) => d >= 0)

  const activeTimeMs = leaves.reduce((sum, l) => {
    const declared = Number(l.metadata?.durationMs ?? l.durationMs)
    if (Number.isFinite(declared) && declared >= 0) return sum + declared
    if (l.startedAt && l.finishedAt) return sum + Math.max(0, l.finishedAt.getTime() - l.startedAt.getTime())
    return sum
  }, 0)
  const totalTokens = leaves.reduce((sum, l) => sum + (l.inputTokens ?? 0) + (l.outputTokens ?? 0), 0)
  // Distinct requests behind those participations — not the count of participations,
  // and not the count of roots that started here.
  const participatedExecutions = new Set(
    leaves.map((l) => l.rootExecutionId?.toString() ?? l.sectorExecutionId?.toString()).filter(Boolean) as string[],
  ).size

  return {
    scope: query.scope,
    period: query.period,
    telemetrySince: since ? since.toISOString() : null,
    executions: rootDocs.length,
    succeeded,
    failed: rootDocs.filter((r) => r.status === 'failed').length,
    canceled: rootDocs.filter((r) => r.status === 'canceled').length,
    running: rootDocs.filter((r) => r.status === 'running' || r.status === 'queued').length,
    successRate: finished.length ? succeeded / finished.length : null,
    avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    p95DurationMs: percentile(durations, 95),
    avgQueueMs: queues.length ? Math.round(queues.reduce((a, b) => a + b, 0) / queues.length) : null,
    activeTimeMs,
    totalTokens,
    // The denominator has to match the numerator. For a floor, the tokens counted are
    // the ones ITS agents spent — participations — so dividing them by the requests
    // that merely STARTED on this floor would mix two different populations.
    avgTokensPerExecution: (() => {
      const denominator = query.scope === 'floor' ? participatedExecutions : rootDocs.length
      return denominator ? Math.round(totalTokens / denominator) : null
    })(),
    participations: leaves.length,
    participatedExecutions,
    partialTelemetry: partial,
  }
}

export interface BreakdownRow {
  id: string
  label: string
  executions: number
  successRate: number | null
  avgDurationMs: number | null
  totalTokens: number
  participations: number
}

// Group by floor, sector or agent WITHOUT double counting: a root that touched two
// agents appears once per agent in an agent breakdown, and exactly once in the
// building total. The two are different questions and are labelled as such.
export async function executionBreakdown(
  ownerId: string,
  groupBy: 'floor' | 'sector' | 'agent',
  opts: { period: AnalyticsPeriod; floorId?: ObjectId; includeTest?: boolean; now?: Date } = { period: '30d' },
): Promise<BreakdownRow[]> {
  const now = opts.now ?? new Date()
  const since = analyticsPeriodStart(opts.period, now)
  const events = db.collection<LeafEvent>('agent_execution_events')

  const filter: Record<string, unknown> = { ownerId }
  if (since) filter.startedAt = { $gte: since }
  if (opts.floorId) filter.floorId = opts.floorId
  const leaves = await events.find(filter).toArray()

  const groups = new Map<string, { roots: Set<string>; tokens: number; participations: number; succeeded: number }>()
  for (const leaf of leaves) {
    const key =
      groupBy === 'agent'
        ? leaf.agentId?.toString()
        : groupBy === 'floor'
          ? (leaf.floorId?.toString() ?? 'sem-andar')
          : (leaf.sectorExecutionId?.toString() ?? null)
    if (!key) continue
    const entry = groups.get(key) ?? { roots: new Set<string>(), tokens: 0, participations: 0, succeeded: 0 }
    const rootKey = leaf.rootExecutionId?.toString() ?? leaf.sectorExecutionId?.toString() ?? `orphan:${entry.participations}`
    entry.roots.add(rootKey)
    entry.tokens += (leaf.inputTokens ?? 0) + (leaf.outputTokens ?? 0)
    entry.participations += 1
    if (leaf.status === 'succeeded') entry.succeeded += 1
    groups.set(key, entry)
  }

  return [...groups.entries()]
    .map(([id, entry]) => ({
      id,
      label: id,
      // Distinct roots, never the count of participations.
      executions: entry.roots.size,
      successRate: entry.participations ? entry.succeeded / entry.participations : null,
      avgDurationMs: null,
      totalTokens: entry.tokens,
      participations: entry.participations,
    }))
    .sort((a, b) => b.executions - a.executions)
}
