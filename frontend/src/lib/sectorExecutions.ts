import { API_URL } from './api'

// Client for the sector's operational view. Everything here is telemetry: statuses,
// counts, durations and categories. There is no field that could carry a prompt, an
// output or an argument — the backend does not return one.

export type ExecutionPeriod = '7d' | '30d' | 'all'
export type SectorExecutionStatus = 'running' | 'succeeded' | 'failed' | 'canceled'
export type ParticipationRole = 'coordinator' | 'specialist' | 'pipeline_stage'

export interface SectorParticipantRow {
  agentId: string
  role: ParticipationRole | null
  stageId: string | null
  stageName: string | null
  participations: number
  succeeded: number
  tokens: number
  activeTimeMs: number
  avgDurationMs: number | null
}

export interface SectorExecutionSummary {
  period: ExecutionPeriod
  telemetrySince: string | null
  executions: number
  running: number
  succeeded: number
  failed: number
  canceled: number
  successRate: number | null
  totalTokens: number
  avgTokensPerExecution: number | null
  avgDurationMs: number | null
  activeTimeMs: number
  avgParticipants: number | null
  byParticipant: SectorParticipantRow[]
}

export interface SectorExecutionRow {
  id: string
  status: SectorExecutionStatus
  source: string
  environment: 'production' | 'test'
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  errorKind: string | null
  tokens: number
  participants: number
}

export interface SectorTimelineStep {
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
  errorKind: string | null
  /**
   * COMO a etapa foi executada. Ausente numa execução gravada antes da fase 6 — e ausente
   * quer dizer o de sempre: uma execução por modelo.
   */
  planId?: string | null
  stepId?: string | null
  executorKind?: 'llm' | 'function' | 'tool'
  ran?: string | null
  capability?: string | null
  dependsOn?: string[]
  inputOrigins?: string[]
  inputValid?: boolean | null
  outputValid?: boolean | null
  hasStructured?: boolean | null
  hasText?: boolean | null
  outputRepaired?: boolean
  latencyMs?: number | null
}

const get = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error('falhou')
  return (await res.json()) as T
}

export const getSectorSummary = (sectorId: string, period: ExecutionPeriod) =>
  get<SectorExecutionSummary>(`/api/sectors/${sectorId}/executions/summary?period=${period}`)

export const listSectorExecutions = (sectorId: string, params: { period: ExecutionPeriod; status?: string; agentId?: string; cursor?: string }) => {
  const q = new URLSearchParams({ period: params.period })
  if (params.status) q.set('status', params.status)
  if (params.agentId) q.set('agentId', params.agentId)
  if (params.cursor) q.set('cursor', params.cursor)
  return get<{ items: SectorExecutionRow[]; nextCursor: string | null }>(`/api/sectors/${sectorId}/executions?${q}`)
}

export const getSectorExecution = (sectorId: string, executionId: string) =>
  get<{ execution: SectorExecutionRow & { sectorName: string; sectorMode: string }; steps: SectorTimelineStep[] }>(
    `/api/sectors/${sectorId}/executions/${executionId}`,
  )

export const PERIOD_LABEL: Record<ExecutionPeriod, string> = { '7d': '7 dias', '30d': '30 dias', all: 'Todo o período' }

export const STATUS_LABEL: Record<string, string> = {
  running: 'Em andamento',
  succeeded: 'Concluída',
  failed: 'Falhou',
  canceled: 'Cancelada',
  timeout: 'Tempo esgotado',
}

export const ROLE_LABEL: Record<ParticipationRole, string> = {
  coordinator: 'Coordenador',
  specialist: 'Especialista',
  pipeline_stage: 'Etapa',
}

// A missing measurement is "—", never a zero: a fabricated zero reads as "it ran and
// produced nothing", which is a different (and false) statement.
export const num = (value: number | null | undefined): string => (value === null || value === undefined ? '—' : value.toLocaleString('pt-BR'))

export const duration = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}min ${seconds}s`
}

export const percent = (rate: number | null | undefined): string => (rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`)

export const tokens = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}
