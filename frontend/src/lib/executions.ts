import { API_URL } from './api'
import type { AgentStatus } from '../ui'

// Client + presentation rules for the Central de execuções. The backend answers with
// one aggregated, owner-scoped page per tab; nothing here computes a metric of its
// own, so the screen can never disagree with the database.

export type ExecutionTab = 'scheduled' | 'triggers' | 'active' | 'history'
export const EXECUTION_TABS: ExecutionTab[] = ['scheduled', 'triggers', 'active', 'history']
// 'analysis' is a VIEW over the same executions, not a fifth list from the backend —
// it reads the analytics service, so it never re-implements a formula.
export const EXECUTION_VIEWS = [...EXECUTION_TABS, 'analysis'] as const

export type AutomationStatus = 'draft' | 'active' | 'paused' | 'archived'
export type RunStatus = 'queued' | 'running' | 'cancel_requested' | 'succeeded' | 'failed' | 'canceled'

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

export interface TriggerItem {
  id: string
  kind: 'webhook'
  name: string
  objective: string
  status: AutomationStatus
  agent: AgentRef | null
  place: PlaceRef
  endpoint: string | null
  requireSignature: boolean
  lastActivationAt: string | null
  lastResult: { id: string; status: RunStatus; errorKind: string | null } | null
  recentRuns: number
  recentTokens: number
  averageTokens: number | null
}

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
  errorKind: string | null
}

export interface ExecutionSummary {
  next24h: number
  activeTriggers: number
  inFlight: number
  tokensWindow: number
  runsWindow: number
  windowDays: number
}

export interface ExecutionFilters {
  floorId?: string
  sectorId?: string
  agentId?: string
  status?: string
}

export interface ExecutionPage<T> {
  tab: ExecutionTab
  items: T[]
  total: number
  limit: number
  skip: number
}

const get = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export function executionsQuery(tab: ExecutionTab, filters: ExecutionFilters, page: { limit: number; skip: number }): string {
  const params = new URLSearchParams({ tab, limit: String(page.limit), skip: String(page.skip) })
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  return `/api/executions?${params.toString()}`
}

export const listExecutions = <T>(tab: ExecutionTab, filters: ExecutionFilters, page: { limit: number; skip: number }) =>
  get<ExecutionPage<T>>(executionsQuery(tab, filters, page))

// The counters answer for the CURRENT filters, so the header and the list can never
// describe two different sets.
export function summaryQuery(filters: ExecutionFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return `/api/executions/summary${query ? `?${query}` : ''}`
}

export const getExecutionSummary = (filters: ExecutionFilters = {}) => get<ExecutionSummary>(summaryQuery(filters))

// --- presentation ---------------------------------------------------------------

// Absolute is the truth; relative is the convenience. Both are shown together, so a
// "em 3 h" is never the only thing a person has to trust.
export function absoluteWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

const UNITS: [limitMs: number, divisorMs: number, one: string, many: string][] = [
  [60_000, 1_000, 'segundo', 'segundos'],
  [3_600_000, 60_000, 'minuto', 'minutos'],
  [86_400_000, 3_600_000, 'hora', 'horas'],
  [Number.POSITIVE_INFINITY, 86_400_000, 'dia', 'dias'],
]

export function relativeWhen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const diff = date.getTime() - now.getTime()
  const abs = Math.abs(diff)
  if (abs < 45_000) return 'agora'
  const [, divisor, one, many] = UNITS.find(([limit]) => abs < limit)!
  const value = Math.round(abs / divisor)
  const unit = value === 1 ? one : many
  return diff > 0 ? `em ${value} ${unit}` : `há ${value} ${unit}`
}

// Compact, honest token formatting: never rounded into a claim it cannot back.
export function tokensLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace('.', ',')} mil`
  return `${(value / 1_000_000).toFixed(1).replace('.', ',')} mi`
}

// An average is an average: it says so, it names the sample, and it never pretends
// to be the cost of the next run.
export function averageTokensLabel(average: number | null, sampleRuns: number): string {
  if (average === null || sampleRuns === 0) return 'Sem histórico'
  return `~${tokensLabel(average)} tokens/execução (média de ${sampleRuns})`
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Na fila',
  running: 'Executando',
  cancel_requested: 'Cancelando',
  succeeded: 'Concluída',
  failed: 'Falhou',
  canceled: 'Cancelada',
}

export const RUN_STATUS_PILL: Record<RunStatus, AgentStatus> = {
  queued: 'idle',
  running: 'thinking',
  cancel_requested: 'break',
  succeeded: 'working',
  failed: 'blocked',
  canceled: 'break',
}

export const AUTOMATION_STATUS_LABEL: Record<AutomationStatus, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  paused: 'Pausada',
  archived: 'Arquivada',
}

export const AUTOMATION_STATUS_PILL: Record<AutomationStatus, AgentStatus> = {
  draft: 'idle',
  active: 'working',
  paused: 'break',
  archived: 'idle',
}

// The status options a tab may filter by — a run status makes no sense on the
// scheduled tab, and vice versa.
export function statusOptionsFor(tab: ExecutionTab): { value: string; label: string }[] {
  if (tab === 'scheduled' || tab === 'triggers') {
    return [
      { value: '', label: 'Todos os estados' },
      { value: 'active', label: AUTOMATION_STATUS_LABEL.active },
      { value: 'paused', label: AUTOMATION_STATUS_LABEL.paused },
    ]
  }
  const statuses: RunStatus[] = tab === 'active' ? ['queued', 'running', 'cancel_requested'] : ['succeeded', 'failed', 'canceled']
  return [{ value: '', label: 'Todos os estados' }, ...statuses.map((s) => ({ value: s, label: RUN_STATUS_LABEL[s] }))]
}

// Where an item's agent lives, so every row can open the agent on its Fluxos tab —
// the place where routines and triggers are actually edited.
export const agentFlowPath = (place: PlaceRef, agentId: string): string =>
  place.floorId ? `/floors/${place.floorId}/agents/${agentId}/fluxos` : `/agents/${agentId}/fluxos`
