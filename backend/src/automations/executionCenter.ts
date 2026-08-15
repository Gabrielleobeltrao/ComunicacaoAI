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

// The automation-side filter, owner-scoped. Returns null when the filter can match
// nothing at all (a sector with no members), so the caller answers an empty page
// instead of a query that would ignore it.
async function automationFilter(ownerId: string, triggerType: 'schedule' | 'webhook', f: ExecutionFilters): Promise<Record<string, unknown> | null> {
  const filter: Record<string, unknown> = { ownerId, 'publishedTrigger.type': triggerType, status: { $ne: 'archived' } }
  if (f.floorId) filter.floorId = f.floorId
  if (f.status) filter.status = f.status
  if (f.agentId) {
    filter.agentId = f.agentId
  } else if (f.sectorId) {
    const ids = await agentIdsInSector(ownerId, f.sectorId)
    if (!ids.length) return null
    filter.agentId = { $in: ids }
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

export async function listRunsForCenter(
  ownerId: string,
  phase: 'active' | 'history',
  f: ExecutionFilters,
  page: { limit: number; skip: number },
): Promise<ExecutionPage<RunItem>> {
  const allowed = phase === 'active' ? ACTIVE_RUN_STATUSES : HISTORY_RUN_STATUSES
  const status = f.status && (allowed as string[]).includes(f.status) ? [f.status as RunStatus] : allowed

  const filter: Record<string, unknown> = { ownerId, status: { $in: status } }
  if (f.floorId) filter.floorId = f.floorId
  // A run does not carry the agent, so an agent/sector filter is resolved to the
  // automations that belong to them — one extra query, still not per row.
  if (f.agentId || f.sectorId) {
    const agentIds = f.agentId ? [f.agentId] : await agentIdsInSector(ownerId, f.sectorId!)
    if (!agentIds.length) return { items: [], total: 0, ...page }
    const owned = await automations.find({ ownerId, agentId: { $in: agentIds } }).project({ _id: 1 }).toArray()
    if (!owned.length) return { items: [], total: 0, ...page }
    filter.automationId = { $in: owned.map((a) => a._id) }
  }

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

// --- Contadores ------------------------------------------------------------------

export interface ExecutionSummary {
  // Real counts, all of them. Nothing here is an estimate or a projection.
  next24h: number
  activeTriggers: number
  inFlight: number
  tokensWindow: number
  runsWindow: number
  windowDays: number
}

export async function executionSummary(ownerId: string, now = new Date()): Promise<ExecutionSummary> {
  const since = windowStart(now)
  const in24h = new Date(now.getTime() + 24 * 60 * 60_000)
  const [next24h, activeTriggers, inFlight, usage] = await Promise.all([
    automations.countDocuments({ ownerId, status: 'active', 'publishedTrigger.type': 'schedule', nextRunAt: { $gt: now, $lte: in24h } }),
    automations.countDocuments({ ownerId, status: 'active', 'publishedTrigger.type': 'webhook' }),
    runs.countDocuments({ ownerId, status: { $in: ACTIVE_RUN_STATUSES } }),
    runs
      .aggregate<{ tokens: number; count: number }>([
        { $match: { ownerId, queuedAt: { $gte: since } } },
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
  return {
    next24h,
    activeTriggers,
    inFlight,
    tokensWindow: usage[0]?.tokens ?? 0,
    runsWindow: usage[0]?.count ?? 0,
    windowDays: USAGE_WINDOW_DAYS,
  }
}
