// Per-agent operational KPIs: the catalog that maps a preset/metricProfile to the
// card's third metric, plus the single Mongo aggregation over agent_execution_events.
// Pure catalog helpers + one grouped pipeline (no N+1).
import { ObjectId } from 'mongodb'
import type { Agent, AgentPreset, MetricKey } from './agents.js'
import { agentEventsCollection } from './agentEvents.js'

export type Period = '7d' | '30d' | 'all'
export const PERIODS: Period[] = ['7d', '30d', 'all']

export function periodSince(period: Period, now: Date = new Date()): Date | null {
  if (period === 'all') return null
  const days = period === '7d' ? 7 : 30
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

// The auto default KPI per preset, with the preset-flavoured label the card shows.
const PRESET_KPI: Record<AgentPreset, { key: MetricKey; label: string }> = {
  manager: { key: 'delegations', label: 'Delegações concluídas' },
  secretary: { key: 'delegations', label: 'Encaminhamentos' },
  researcher: { key: 'executions', label: 'Pesquisas concluídas' },
  analyst: { key: 'executions', label: 'Análises concluídas' },
  operator: { key: 'tool_actions', label: 'Ações executadas com ferramenta' },
  communicator: { key: 'executions', label: 'Entregas concluídas' },
  monitor: { key: 'executions', label: 'Verificações realizadas' },
  custom: { key: 'executions', label: 'Execuções concluídas' },
}

const GENERIC_LABEL: Record<MetricKey, string> = {
  executions: 'Execuções concluídas',
  delegations: 'Delegações concluídas',
  tool_actions: 'Ações com ferramenta',
  conversations: 'Conversas',
  leads: 'Leads',
}

// Does this agent have a real data source for a given KPI? Used to build the picker
// and to refuse a manual choice that would show nothing.
export function metricKeyAvailable(agent: Agent, key: MetricKey, channelLinked: boolean): boolean {
  switch (key) {
    case 'executions':
      return true // any agent that runs produces execution events
    case 'delegations':
      return agent.delegationPolicy !== 'none' // only a delegator initiates delegations
    case 'tool_actions':
      return (agent.tools?.length ?? 0) > 0 || (agent.builtinTools?.length ?? 0) > 0
    case 'conversations':
      return channelLinked
    case 'leads':
      return channelLinked && agent.structuredOutputEnabled === true // real structured capture only
  }
}

export function availableMetricKeys(agent: Agent, channelLinked: boolean): MetricKey[] {
  return (['executions', 'delegations', 'tool_actions', 'conversations', 'leads'] as MetricKey[]).filter((k) => metricKeyAvailable(agent, k, channelLinked))
}

// The KPI actually shown: a manual metricProfile wins; 'auto' derives from the preset
// (custom + channel prefers conversations). Falls back to 'executions' if a manual
// choice lost its data source (e.g. the widget was unlinked).
export function resolveMetricKey(agent: Agent, channelLinked: boolean): MetricKey {
  if (agent.metricProfile && agent.metricProfile !== 'auto') {
    return metricKeyAvailable(agent, agent.metricProfile, channelLinked) ? agent.metricProfile : 'executions'
  }
  if (agent.preset === 'custom' && channelLinked) return 'conversations'
  return PRESET_KPI[agent.preset]?.key ?? 'executions'
}

export function kpiLabel(agent: Agent, key: MetricKey): string {
  const presetKpi = PRESET_KPI[agent.preset]
  // Use the preset-flavoured label only when it matches the resolved key.
  if (presetKpi && presetKpi.key === key && (agent.metricProfile === 'auto' || !agent.metricProfile)) return presetKpi.label
  return GENERIC_LABEL[key]
}

export interface AgentEventMetrics {
  executions: number
  succeeded: number
  toolActions: number
  totalDurationMs: number
  totalInputTokens: number
  totalOutputTokens: number
}

// One grouped aggregation over agent_execution_events for the whole roster.
export async function getAgentEventMetricsBatch(ownerId: string, opts: { floorId?: ObjectId | null; since?: Date | null } = {}): Promise<Map<string, AgentEventMetrics>> {
  const match: Record<string, unknown> = { ownerId }
  if (opts.floorId) match.floorId = opts.floorId
  if (opts.since) match.startedAt = { $gte: opts.since }
  const rows = await agentEventsCollection
    .aggregate<{ _id: ObjectId } & AgentEventMetrics>([
      { $match: match },
      {
        $group: {
          _id: '$agentId',
          executions: { $sum: 1 },
          succeeded: { $sum: { $cond: [{ $eq: ['$status', 'succeeded'] }, 1, 0] } },
          // Tool ACTIONS = tool calls that actually completed (the runtime only
          // counts ok:true calls), summed — not "executions that used a tool".
          toolActions: { $sum: { $cond: [{ $eq: ['$status', 'succeeded'] }, { $ifNull: ['$toolCalls', 0] }, 0] } },
          totalDurationMs: { $sum: '$durationMs' },
          totalInputTokens: { $sum: '$inputTokens' },
          totalOutputTokens: { $sum: '$outputTokens' },
        },
      },
    ])
    .toArray()
  return new Map(
    rows.map((r) => [
      r._id.toString(),
      {
        executions: r.executions,
        succeeded: r.succeeded,
        toolActions: r.toolActions,
        totalDurationMs: r.totalDurationMs,
        totalInputTokens: r.totalInputTokens,
        totalOutputTokens: r.totalOutputTokens,
      },
    ]),
  )
}

// The public per-agent stats shape (mirrored on the frontend). Derived metrics are
// null when there are no executions in the period — the UI renders null as "—",
// telling absence of telemetry apart from a real zero count.
export interface AgentOperationalStats {
  executions: number
  avgDurationMs: number | null
  activeTimeMs: number
  totalTokens: number
  avgTokensPerExecution: number | null
  successRate: number | null // 0..1
  specific: { key: MetricKey; label: string; value: number | null }
}

// Compose the public stats for one agent from the event metrics + the specific-KPI
// value already resolved by the route (delegations/conversations/leads come from
// other sources; executions/tool_actions come from the events).
export function composeAgentStats(agent: Agent, ev: AgentEventMetrics | undefined, channelLinked: boolean, specificValue: (key: MetricKey) => number | null): AgentOperationalStats {
  const executions = ev?.executions ?? 0
  const totalTokens = (ev?.totalInputTokens ?? 0) + (ev?.totalOutputTokens ?? 0)
  const key = resolveMetricKey(agent, channelLinked)
  return {
    executions,
    avgDurationMs: executions ? Math.round((ev?.totalDurationMs ?? 0) / executions) : null,
    activeTimeMs: ev?.totalDurationMs ?? 0,
    totalTokens,
    avgTokensPerExecution: executions ? Math.round(totalTokens / executions) : null,
    successRate: executions ? (ev?.succeeded ?? 0) / executions : null,
    specific: { key, label: kpiLabel(agent, key), value: specificValue(key) },
  }
}
