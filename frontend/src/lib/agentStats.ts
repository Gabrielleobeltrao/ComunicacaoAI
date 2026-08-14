import { API_URL } from './api'
import type { AgentStatsResponse, MetricKey } from './types'

export type StatsPeriod = '7d' | '30d' | 'all'

// Per-agent operational stats for the roster (cards) and the agent page.
export function getAgentStats(period: StatsPeriod = '30d', floorId?: string): Promise<AgentStatsResponse> {
  const qs = new URLSearchParams({ period })
  if (floorId) qs.set('floorId', floorId)
  return fetch(`${API_URL}/api/agent-stats?${qs.toString()}`, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.json() as Promise<AgentStatsResponse>
  })
}

export const PERIOD_LABEL: Record<StatsPeriod, string> = { '7d': '7 dias', '30d': '30 dias', all: 'Tudo' }

// Human label for a manually-picked KPI in the "Métrica do card" selector.
export const METRIC_KEY_LABEL: Record<MetricKey, string> = {
  executions: 'Execuções concluídas',
  delegations: 'Delegações concluídas',
  tool_actions: 'Ações com ferramenta',
  conversations: 'Conversas',
  leads: 'Leads',
}
