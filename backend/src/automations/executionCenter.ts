// The Central de execuções: ONE owner-scoped read model over the work the agents do
// on their own. It adds no engine and no new storage — it reads the automations the
// scheduler already fires, the runs the queue already executes, and joins them to
// the agent, the floor and the sector so a person can see what is scheduled, what is
// waiting for an event, what is happening now and what already happened.
//
// Two rules shape every query here:
//   1. Schedules and triggers are read from `publishedTrigger` and `nextRunAt` —
//      never from the draft. What the page shows is what would actually fire.
//   2. Nothing sensitive leaves: no definition snapshot, no trigger payload, no run
//      output, no webhook secret. Only what the screen needs.
//
// Everything is batched: a page costs a fixed handful of queries, never one per row.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import type { AutomationStatus, AutomationTrigger } from './types.js'
import type { RunStatus } from './runTypes.js'
import { cronToRecurrence, describeRecurrence } from './schedule.js'
import { clarificationsSince, tokensByModelSince } from '../agentEvents.js'

export type ExecutionTab = 'scheduled' | 'triggers' | 'active' | 'history'
export const EXECUTION_TABS: ExecutionTab[] = ['scheduled', 'triggers', 'active', 'history']

// The run statuses each tab covers. 'active' is work in flight; 'history' is work
// that reached an end.
export const ACTIVE_RUN_STATUSES: RunStatus[] = ['queued', 'running', 'cancel_requested']
export const HISTORY_RUN_STATUSES: RunStatus[] = ['succeeded', 'failed', 'canceled']

export interface ExecutionFilters {
  floorId?: ObjectId
  sectorId?: ObjectId
  agentId?: ObjectId
  status?: string
}

export interface ExecutionPage<T> {
  items: T[]
  total: number
  limit: number
  skip: number
}

// How far back "recent consumption" looks. The same window everywhere on the page,
// so the header total and each row's average describe the same period.
export const USAGE_WINDOW_DAYS = 30

interface AutomationDoc {
  _id: ObjectId
  ownerId: string
  agentId?: ObjectId
  floorId: ObjectId
  name: string
  description: string
  status: AutomationStatus
  publishedTrigger?: AutomationTrigger | null
  nextRunAt?: Date | null
  webhookPublicKey?: string
  lastPublishedVersion: number | null
  updatedAt: Date
}

interface RunDoc {
  _id: ObjectId
  ownerId: string
  automationId: ObjectId
  floorId: ObjectId
  status: RunStatus
  triggerType: string
  queuedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  usage?: { inputTokens?: number; outputTokens?: number }
  error?: { kind: string; message: string } | null
}

const automations = db.collection<AutomationDoc>('automations')
const runs = db.collection<RunDoc>('automation_runs')
const agents = db.collection<{ _id: ObjectId; ownerId: string; name: string; objective: string; officeId: ObjectId }>('agents')
const floors = db.collection<{ _id: ObjectId; ownerId: string; name: string }>('offices')
const sectors = db.collection<{ _id: ObjectId; ownerId: string; name: string; members?: { agentId: ObjectId }[] }>('sectors')

export async function ensureExecutionIndexes(): Promise<void> {
  // The two listings the Central opens with.
  await automations.createIndex({ ownerId: 1, 'publishedTrigger.type': 1, status: 1, nextRunAt: 1 })
  await runs.createIndex({ ownerId: 1, status: 1, queuedAt: -1 })
}

const tokensOf = (usage?: { inputTokens?: number; outputTokens?: number }): number => (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)

const windowStart = (now: Date): Date => new Date(now.getTime() - USAGE_WINDOW_DAYS * 24 * 60 * 60_000)

// --- shared joins --------------------------------------------------------------

export interface AgentRef {
  id: string
  name: string
  objective: string
}
export interface PlaceRef {
  floorId: string | null
  floorName: string | null
  sectorId: string | null
  sectorName: string | null
}

interface Joins {
  agentById: Map<string, AgentRef>
  floorNameById: Map<string, string>
  sectorByAgentId: Map<string, { id: string; name: string }>
}

// One batch per collection for a whole page — never a query per row.
async function loadJoins(ownerId: string, agentIds: ObjectId[], floorIds: ObjectId[]): Promise<Joins> {
  const [agentDocs, floorDocs, sectorDocs] = await Promise.all([
    agentIds.length ? agents.find({ ownerId, _id: { $in: agentIds } }).project({ name: 1, objective: 1, officeId: 1 }).toArray() : Promise.resolve([]),
    floorIds.length ? floors.find({ ownerId, _id: { $in: floorIds } }).project({ name: 1 }).toArray() : Promise.resolve([]),
    agentIds.length ? sectors.find({ ownerId, 'members.agentId': { $in: agentIds } }).project({ name: 1, members: 1 }).toArray() : Promise.resolve([]),
  ])
  const agentById = new Map<string, AgentRef>()
  for (const a of agentDocs as { _id: ObjectId; name?: string; objective?: string }[]) {
    agentById.set(a._id.toString(), { id: a._id.toString(), name: a.name ?? 'Agente', objective: a.objective ?? '' })
  }
  const floorNameById = new Map<string, string>()
  for (const f of floorDocs as { _id: ObjectId; name?: string }[]) floorNameById.set(f._id.toString(), f.name ?? 'Andar')
  const sectorByAgentId = new Map<string, { id: string; name: string }>()
  for (const s of sectorDocs as { _id: ObjectId; name?: string; members?: { agentId: ObjectId }[] }[]) {
    for (const m of s.members ?? []) {
      const key = m.agentId?.toString()
      // First sector wins: an agent belongs to one team in practice, and the label
      // is context, not a permission.
      if (key && !sectorByAgentId.has(key)) sectorByAgentId.set(key, { id: s._id.toString(), name: s.name ?? 'Setor' })
    }
  }
  return { agentById, floorNameById, sectorByAgentId }
}

const placeOf = (joins: Joins, floorId: ObjectId | null | undefined, agentId: ObjectId | null | undefined): PlaceRef => {
  const sector = agentId ? joins.sectorByAgentId.get(agentId.toString()) : undefined
  return {
    floorId: floorId ? floorId.toString() : null,
    floorName: floorId ? (joins.floorNameById.get(floorId.toString()) ?? null) : null,
    sectorId: sector?.id ?? null,
    sectorName: sector?.name ?? null,
  }
}

// Last run + recent consumption for a page of automations, in ONE aggregation.
interface RunStats {
  last: { id: string; status: RunStatus; triggerType: string; queuedAt: Date; finishedAt: Date | null; errorKind: string | null } | null
  recentRuns: number
  recentTokens: number
}

async function loadRunStats(ownerId: string, automationIds: ObjectId[], now: Date): Promise<Map<string, RunStats>> {
  const out = new Map<string, RunStats>()
  if (!automationIds.length) return out
  const since = windowStart(now)
  const rows = await runs
    .aggregate<{
      _id: ObjectId
      last: RunDoc
      recentRuns: number
      recentTokens: number
    }>([
      { $match: { ownerId, automationId: { $in: automationIds } } },
      { $sort: { queuedAt: -1 } },
      {
        $group: {
          _id: '$automationId',
          last: { $first: '$$ROOT' },
          // The window is applied inside the accumulators so the "last run" above
          // is still the real last one, however old it is.
          recentRuns: { $sum: { $cond: [{ $gte: ['$queuedAt', since] }, 1, 0] } },
          recentTokens: {
            $sum: {
              $cond: [
                { $gte: ['$queuedAt', since] },
                { $add: [{ $ifNull: ['$usage.inputTokens', 0] }, { $ifNull: ['$usage.outputTokens', 0] }] },
                0,
              ],
            },
          },
        },
      },
    ])
    .toArray()
  for (const row of rows) {
    out.set(row._id.toString(), {
      last: {
        id: row.last._id.toString(),
        status: row.last.status,
        triggerType: row.last.triggerType,
        queuedAt: row.last.queuedAt,
        finishedAt: row.last.finishedAt ?? null,
        // The message may quote user data; only the kind is safe in a listing.
        errorKind: row.last.error?.kind ?? null,
      },
      recentRuns: row.recentRuns,
      recentTokens: row.recentTokens,
    })
  }
  return out
}

// An AVERAGE over the window, never a promise about the next run. null when there
// is nothing to average, so the UI shows "—" instead of a fabricated zero.
const averageTokens = (stats: RunStats | undefined): number | null =>
  stats && stats.recentRuns > 0 ? Math.round(stats.recentTokens / stats.recentRuns) : null

// Which automations a sector filter selects: the ones owned by its member agents.
async function agentIdsInSector(ownerId: string, sectorId: ObjectId): Promise<ObjectId[]> {
  const sector = await sectors.findOne({ _id: sectorId, ownerId }, { projection: { members: 1 } })
  return (sector?.members ?? []).map((m) => m.agentId).filter(Boolean)
}

// The agents a filter selects, as a CONJUNCTION: an agent filter narrows, a sector
// filter narrows, and both together mean "this agent, in that sector". Returns:
//   undefined — no agent constraint at all;
//   []        — the constraint can match nobody (empty sector, or an agent that is
//               not in the chosen sector), so the caller must answer an empty page
//               instead of silently dropping the filter.
async function agentConstraint(ownerId: string, f: ExecutionFilters): Promise<ObjectId[] | undefined> {
  if (!f.agentId && !f.sectorId) return undefined
  if (!f.sectorId) return [f.agentId!]
  const inSector = await agentIdsInSector(ownerId, f.sectorId)
  if (!f.agentId) return inSector
  // Both: the agent must really belong to that sector. Ignoring one of the two
  // would answer a question nobody asked.
  return inSector.some((id) => id.equals(f.agentId!)) ? [f.agentId] : []
}

// The automation-side filter, owner-scoped. Returns null when the filter can match
// nothing at all, so the caller answers an empty page.
async function automationFilter(ownerId: string, triggerType: 'schedule' | 'webhook', f: ExecutionFilters): Promise<Record<string, unknown> | null> {
  const filter: Record<string, unknown> = { ownerId, 'publishedTrigger.type': triggerType, status: { $ne: 'archived' } }
  if (f.floorId) filter.floorId = f.floorId
  if (f.status) filter.status = f.status
  const agentIds = await agentConstraint(ownerId, f)
  if (agentIds) {
    if (!agentIds.length) return null
    filter.agentId = agentIds.length === 1 ? agentIds[0] : { $in: agentIds }
  }
  return filter
}

// --- Agendadas -----------------------------------------------------------------

export interface ScheduledItem {
  id: string
  kind: 'schedule'
  name: string
  objective: string
  status: AutomationStatus
  agent: AgentRef | null
  place: PlaceRef
  cron: string
  timezone: string
  scheduleLabel: string
  nextRunAt: string | null
  lastRun: { id: string; status: RunStatus; finishedAt: string | null; errorKind: string | null } | null
  recentRuns: number
  recentTokens: number
  averageTokens: number | null
}

export async function listScheduled(
  ownerId: string,
  f: ExecutionFilters,
  page: { limit: number; skip: number },
  now = new Date(),
): Promise<ExecutionPage<ScheduledItem>> {
  const filter = await automationFilter(ownerId, 'schedule', f)
  if (!filter) return { items: [], total: 0, ...page }

  const [docs, total] = await Promise.all([
    automations
      .find(filter)
      // Soonest first; the ones with no plan (paused) sink to the bottom.
      .sort({ nextRunAt: 1, updatedAt: -1 })
      .skip(page.skip)
      .limit(page.limit)
      .toArray(),
    automations.countDocuments(filter),
  ])

  const joins = await loadJoins(ownerId, docs.map((d) => d.agentId).filter((x): x is ObjectId => Boolean(x)), docs.map((d) => d.floorId))
  const stats = await loadRunStats(ownerId, docs.map((d) => d._id), now)

  const items = docs.map((d) => {
    const trigger = d.publishedTrigger as { cron?: string; timezone?: string } | null | undefined
    const cron = trigger?.cron ?? ''
    const recurrence = cron ? cronToRecurrence(cron) : null
    const s = stats.get(d._id.toString())
    return {
      id: d._id.toString(),
      kind: 'schedule' as const,
      name: d.name,
      objective: d.description,
      status: d.status,
      agent: d.agentId ? (joins.agentById.get(d.agentId.toString()) ?? null) : null,
      place: placeOf(joins, d.floorId, d.agentId),
      cron,
      timezone: trigger?.timezone ?? '',
      scheduleLabel: recurrence ? describeRecurrence(recurrence) : cron,
      // Only a published, active schedule carries a plan — the paused ones show "—".
      nextRunAt: d.nextRunAt ? d.nextRunAt.toISOString() : null,
      lastRun: s?.last ? { id: s.last.id, status: s.last.status, finishedAt: s.last.finishedAt?.toISOString() ?? null, errorKind: s.last.errorKind } : null,
      recentRuns: s?.recentRuns ?? 0,
      recentTokens: s?.recentTokens ?? 0,
      averageTokens: averageTokens(s),
    }
  })
  return { items, total, ...page }
}

// --- Gatilhos ------------------------------------------------------------------

export interface TriggerItem {
  id: string
  kind: 'webhook'
  name: string
  objective: string
  status: AutomationStatus
  agent: AgentRef | null
  place: PlaceRef
  // The public endpoint. The signing secret is NEVER part of this shape.
  endpoint: string | null
  requireSignature: boolean
  // Derived from the last run this trigger produced — a webhook that never fired is
  // an armed trigger, not a pending execution.
  lastActivationAt: string | null
  lastResult: { id: string; status: RunStatus; errorKind: string | null } | null
  recentRuns: number
  recentTokens: number
  averageTokens: number | null
}

export async function listTriggers(
  ownerId: string,
  f: ExecutionFilters,
  page: { limit: number; skip: number },
  publicUrl: string,
  now = new Date(),
): Promise<ExecutionPage<TriggerItem>> {
  const filter = await automationFilter(ownerId, 'webhook', f)
  if (!filter) return { items: [], total: 0, ...page }

  const [docs, total] = await Promise.all([
    automations.find(filter).sort({ status: 1, updatedAt: -1 }).skip(page.skip).limit(page.limit).toArray(),
    automations.countDocuments(filter),
  ])

  const joins = await loadJoins(ownerId, docs.map((d) => d.agentId).filter((x): x is ObjectId => Boolean(x)), docs.map((d) => d.floorId))
  const stats = await loadRunStats(ownerId, docs.map((d) => d._id), now)

  const items = docs.map((d) => {
    const s = stats.get(d._id.toString())
    const trigger = d.publishedTrigger as { requireSignature?: boolean } | null | undefined
    return {
      id: d._id.toString(),
      kind: 'webhook' as const,
      name: d.name,
      objective: d.description,
      status: d.status,
      agent: d.agentId ? (joins.agentById.get(d.agentId.toString()) ?? null) : null,
      place: placeOf(joins, d.floorId, d.agentId),
      endpoint: d.webhookPublicKey ? webhookEndpoint(publicUrl, d.webhookPublicKey) : null,
      requireSignature: trigger?.requireSignature !== false,
      lastActivationAt: s?.last?.queuedAt ? s.last.queuedAt.toISOString() : null,
      lastResult: s?.last ? { id: s.last.id, status: s.last.status, errorKind: s.last.errorKind } : null,
      recentRuns: s?.recentRuns ?? 0,
      recentTokens: s?.recentTokens ?? 0,
      averageTokens: averageTokens(s),
    }
  })
  return { items, total, ...page }
}

// The one place the public webhook URL is built, so the path can never drift from
// where the router is mounted (index.ts: app.use('/api/hooks', webhookRouter)).
export const webhookEndpoint = (publicUrl: string, publicKey: string): string => `${publicUrl}/api/hooks/automations/${publicKey}`

// --- Em andamento / Histórico ---------------------------------------------------

export interface RunItem {
  id: string
  automationId: string
  name: string
  status: RunStatus
  triggerType: string
  agent: AgentRef | null
  place: PlaceRef
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  tokens: number
  // Only the kind: an error message can quote the payload that caused it.
  errorKind: string | null
}

// The run-side filter, owner-scoped and conjunctive. A run does not carry the agent,
// so an agent/sector constraint is resolved to the automations that belong to them —
// one extra query, still not one per row. null = matches nothing.
async function runFilter(
  ownerId: string,
  f: ExecutionFilters,
  extra: { status?: RunStatus[]; triggerType?: string; from?: Date; to?: Date } = {},
): Promise<Record<string, unknown> | null> {
  const filter: Record<string, unknown> = { ownerId }
  if (extra.status) filter.status = { $in: extra.status }
  if (extra.triggerType) filter.triggerType = extra.triggerType
  if (extra.from || extra.to) {
    filter.queuedAt = { ...(extra.from ? { $gte: extra.from } : {}), ...(extra.to ? { $lte: extra.to } : {}) }
  }
  if (f.floorId) filter.floorId = f.floorId

  const agentIds = await agentConstraint(ownerId, f)
  if (agentIds) {
    if (!agentIds.length) return null
    const owned = await automations.find({ ownerId, agentId: { $in: agentIds } }).project({ _id: 1 }).toArray()
    if (!owned.length) return null
    filter.automationId = { $in: owned.map((a) => a._id) }
  }
  return filter
}

export async function listRunsForCenter(
  ownerId: string,
  phase: 'active' | 'history',
  f: ExecutionFilters,
  page: { limit: number; skip: number },
): Promise<ExecutionPage<RunItem>> {
  const allowed = phase === 'active' ? ACTIVE_RUN_STATUSES : HISTORY_RUN_STATUSES
  const status = f.status && (allowed as string[]).includes(f.status) ? [f.status as RunStatus] : allowed

  const filter = await runFilter(ownerId, f, { status })
  if (!filter) return { items: [], total: 0, ...page }

  const [docs, total] = await Promise.all([
    runs.find(filter).sort({ queuedAt: -1 }).skip(page.skip).limit(page.limit).toArray(),
    runs.countDocuments(filter),
  ])

  const automationDocs = docs.length
    ? await automations
        .find({ ownerId, _id: { $in: [...new Set(docs.map((r) => r.automationId.toString()))].map((id) => new ObjectId(id)) } })
        .project({ name: 1, agentId: 1, floorId: 1 })
        .toArray()
    : []
  const automationById = new Map(automationDocs.map((a) => [a._id.toString(), a as { _id: ObjectId; name?: string; agentId?: ObjectId; floorId?: ObjectId }]))
  const joins = await loadJoins(
    ownerId,
    automationDocs.map((a) => (a as { agentId?: ObjectId }).agentId).filter((x): x is ObjectId => Boolean(x)),
    docs.map((r) => r.floorId),
  )

  const items = docs.map((r) => {
    const automation = automationById.get(r.automationId.toString())
    return {
      id: r._id.toString(),
      automationId: r.automationId.toString(),
      name: automation?.name ?? 'Trabalho automático',
      status: r.status,
      triggerType: r.triggerType,
      agent: automation?.agentId ? (joins.agentById.get(automation.agentId.toString()) ?? null) : null,
      place: placeOf(joins, r.floorId, automation?.agentId),
      queuedAt: r.queuedAt.toISOString(),
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      tokens: tokensOf(r.usage),
      errorKind: r.error?.kind ?? null,
    }
  })
  return { items, total, ...page }
}

// --- Linha do tempo de execuções (Logs) --------------------------------------------
// The same read model as the Central, over EVERY status and with a stable cursor, so
// an audit trail can be paged without rows shifting under the reader. It carries
// what a person needs to judge an execution — timings, tokens, how many steps,
// deliveries and artifacts it produced — and never the content of any of them.

export interface RunTimelineItem extends RunItem {
  durationMs: number | null
  steps: number
  deliveries: number
  artifacts: number
}

export interface RunTimelineFilters extends ExecutionFilters {
  triggerType?: string
  from?: Date
  to?: Date
}

// (queuedAt, _id): the sort key and a tiebreak, so two runs queued in the same
// millisecond can never make a page repeat or skip a row.
export const encodeRunCursor = (item: { queuedAt: string; id: string }): string => `${new Date(item.queuedAt).getTime()}_${item.id}`

function decodeRunCursor(raw: string | undefined): { queuedAt: Date; id: ObjectId } | null {
  if (!raw) return null
  const [time, id] = raw.split('_')
  if (!time || !ObjectId.isValid(id ?? '')) return null
  const queuedAt = new Date(Number(time))
  return Number.isNaN(queuedAt.getTime()) ? null : { queuedAt, id: new ObjectId(id) }
}

export async function listRunTimeline(
  ownerId: string,
  f: RunTimelineFilters,
  page: { limit: number; cursor?: string },
): Promise<{ items: RunTimelineItem[]; nextCursor: string | null }> {
  const status = f.status ? [f.status as RunStatus] : undefined
  const base = await runFilter(ownerId, f, { status, triggerType: f.triggerType, from: f.from, to: f.to })
  if (!base) return { items: [], nextCursor: null }

  const after = decodeRunCursor(page.cursor)
  const filter = after
    ? { $and: [base, { $or: [{ queuedAt: { $lt: after.queuedAt } }, { queuedAt: after.queuedAt, _id: { $lt: after.id } }] }] }
    : base

  // One extra row tells us whether there is a next page, without a count.
  const docs = await runs.find(filter).sort({ queuedAt: -1, _id: -1 }).limit(page.limit + 1).toArray()
  const pageDocs = docs.slice(0, page.limit)

  const automationDocs = pageDocs.length
    ? await automations
        .find({ ownerId, _id: { $in: [...new Set(pageDocs.map((r) => r.automationId.toString()))].map((id) => new ObjectId(id)) } })
        .project({ name: 1, agentId: 1, floorId: 1, publishedTrigger: 1 })
        .toArray()
    : []
  const automationById = new Map(automationDocs.map((a) => [a._id.toString(), a as { _id: ObjectId; name?: string; agentId?: ObjectId }]))
  const joins = await loadJoins(
    ownerId,
    automationDocs.map((a) => (a as { agentId?: ObjectId }).agentId).filter((x): x is ObjectId => Boolean(x)),
    pageDocs.map((r) => r.floorId),
  )
  const counts = await loadRunCounts(ownerId, pageDocs.map((r) => r._id))

  const items = pageDocs.map((r) => {
    const automation = automationById.get(r.automationId.toString())
    const c = counts.get(r._id.toString())
    return {
      id: r._id.toString(),
      automationId: r.automationId.toString(),
      name: automation?.name ?? 'Trabalho automático',
      status: r.status,
      triggerType: r.triggerType,
      agent: automation?.agentId ? (joins.agentById.get(automation.agentId.toString()) ?? null) : null,
      place: placeOf(joins, r.floorId, automation?.agentId),
      queuedAt: r.queuedAt.toISOString(),
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      durationMs: r.startedAt && r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
      tokens: tokensOf(r.usage),
      errorKind: r.error?.kind ?? null,
      steps: c?.steps ?? 0,
      deliveries: c?.deliveries ?? 0,
      artifacts: c?.artifacts ?? 0,
    }
  })
  const nextCursor = docs.length > page.limit && items.length ? encodeRunCursor(items[items.length - 1]) : null
  return { items, nextCursor }
}

// How much each run produced — three grouped counts for the whole page, not three
// queries per row.
async function loadRunCounts(ownerId: string, runIds: ObjectId[]): Promise<Map<string, { steps: number; deliveries: number; artifacts: number }>> {
  const out = new Map<string, { steps: number; deliveries: number; artifacts: number }>()
  if (!runIds.length) return out
  const countBy = async (name: string) =>
    db
      .collection(name)
      .aggregate<{ _id: ObjectId; n: number }>([{ $match: { ownerId, runId: { $in: runIds } } }, { $group: { _id: '$runId', n: { $sum: 1 } } }])
      .toArray()
  const [steps, deliveries, artifacts] = await Promise.all([countBy('step_runs'), countBy('deliveries'), countBy('artifacts')])
  const put = (rows: { _id: ObjectId; n: number }[], key: 'steps' | 'deliveries' | 'artifacts') => {
    for (const row of rows) {
      const id = row._id.toString()
      const current = out.get(id) ?? { steps: 0, deliveries: 0, artifacts: 0 }
      current[key] = row.n
      out.set(id, current)
    }
  }
  put(steps, 'steps')
  put(deliveries, 'deliveries')
  put(artifacts, 'artifacts')
  return out
}

// --- Contadores ------------------------------------------------------------------

export interface ExecutionSummary {
  // Real counts, all of them. Nothing here is an estimate or a projection.
  next24h: number
  activeTriggers: number
  inFlight: number
  tokensWindow: number
  runsWindow: number
  windowDays: number
  /**
   * Os tokens separados por MODELO — a única forma de ver economia acontecer.
   *
   * Trocar um agente do modelo caro para o barato não muda um token; muda o preço de
   * cada um. Ausente quando um filtro de setor está ativo: os eventos por agente não
   * carregam o setor, e mostrar um total que ignora o filtro seria pior que não mostrar.
   */
  tokensByModel?: { model: string; inputTokens: number; outputTokens: number; runs: number }[]
  /**
   * Quantas execuções pediram esclarecimento em vez de responder.
   *
   * Cresce sem parar = virou questionário. Zero num assunto ambíguo = segue chutando.
   */
  clarificationsWindow?: number
}

// The counters answer the question the page is currently asking: the SAME filters
// the list uses narrow them too, so the header can never describe a different set
// from the rows underneath it. The `status` filter is deliberately not applied —
// each counter is about its own state.
export async function executionSummary(ownerId: string, now = new Date(), f: ExecutionFilters = {}): Promise<ExecutionSummary> {
  const since = windowStart(now)
  const in24h = new Date(now.getTime() + 24 * 60 * 60_000)

  const scope = await automationFilter(ownerId, 'schedule', { ...f, status: undefined })
  const triggerScope = await automationFilter(ownerId, 'webhook', { ...f, status: undefined })
  const runScope = await runFilter(ownerId, { ...f, status: undefined })
  // A filter that can match nobody yields zeros, never the unfiltered totals.
  if (!scope || !triggerScope || !runScope) {
    return { next24h: 0, activeTriggers: 0, inFlight: 0, tokensWindow: 0, runsWindow: 0, windowDays: USAGE_WINDOW_DAYS, tokensByModel: [] }
  }

  const [next24h, activeTriggers, inFlight, usage] = await Promise.all([
    automations.countDocuments({ ...scope, status: 'active', nextRunAt: { $gt: now, $lte: in24h } }),
    automations.countDocuments({ ...triggerScope, status: 'active' }),
    runs.countDocuments({ ...runScope, status: { $in: ACTIVE_RUN_STATUSES } }),
    runs
      .aggregate<{ tokens: number; count: number }>([
        { $match: { ...runScope, queuedAt: { $gte: since } } },
        {
          $group: {
            _id: null,
            tokens: { $sum: { $add: [{ $ifNull: ['$usage.inputTokens', 0] }, { $ifNull: ['$usage.outputTokens', 0] }] } },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray(),
  ])
  // Por modelo, só quando dá para respeitar o filtro: o evento por agente conhece agente
  // e andar, mas não setor.
  const porModelo = f.sectorId
    ? undefined
    : await tokensByModelSince(ownerId, since, {
        ...(f.agentId && ObjectId.isValid(f.agentId) ? { agentId: new ObjectId(f.agentId) } : {}),
        ...(f.floorId && ObjectId.isValid(f.floorId) ? { floorId: new ObjectId(f.floorId) } : {}),
      })

  return {
    next24h,
    activeTriggers,
    inFlight,
    tokensWindow: usage[0]?.tokens ?? 0,
    runsWindow: usage[0]?.count ?? 0,
    windowDays: USAGE_WINDOW_DAYS,
    ...(porModelo ? { tokensByModel: porModelo } : {}),
    clarificationsWindow: await clarificationsSince(ownerId, since),
  }
}
