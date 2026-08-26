import { API_URL } from './api'

/**
 * O histórico genérico, do lado da tela.
 *
 * Nada aqui carrega credencial: uma definição de histórico não tem nenhuma. O que
 * trafega é configuração — de onde vem o dado, quando gravar, o que guardar e por
 * quanto tempo — e o que já foi gravado.
 */

export type SourceKind = 'event' | 'live_data' | 'manual'
export type RecorderMode = 'every_event' | 'on_change' | 'snapshot_interval' | 'schedule_snapshot' | 'window_aggregate' | 'condition'
export type AggregationOp = 'first' | 'last' | 'min' | 'max' | 'avg' | 'sum' | 'count'

export interface AggregationRule {
  from: string
  op: AggregationOp
  to: string
}

export interface RecorderFilter {
  path: string
  operator: 'exists' | 'equals' | 'not_equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'
  value?: unknown
}

export interface DataRecorder {
  id: string
  name: string
  enabled: boolean
  source: { kind: SourceKind; ref: string }
  mode: RecorderMode
  entityKeyPath: string | null
  occurredAtPath: string | null
  intervalMs: number | null
  schedule: { hour: number; minute: number } | null
  filters: RecorderFilter[]
  selectedFields: string[] | null
  aggregations: AggregationRule[]
  changePath: string | null
  retentionDays: number | null
  recordCount: number
  lastRecordAt: string | null
  lastError: { message: string; at: string } | null
  createdAt: string
  updatedAt: string
  storedRecords?: number
}

export interface HistoryRecord {
  id: string
  recorderId: string
  sourceKey: string
  entityKey: string | null
  occurredAt: string
  recordedAt: string
  windowStart: string | null
  windowEnd: string | null
  value: Record<string, unknown>
}

export interface PreviewResult {
  decisions: { index: number; resultado: string }[]
  records: HistoryRecord[]
  windows: { entityKey: string | null; windowStart: string; windowEnd: string; count: number; value: Record<string, unknown> }[]
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_URL}/api/data-history${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.message ?? body?.error ?? 'Não foi possível concluir.')
  }
  return res.status === 204 ? (null as T) : ((await res.json()) as T)
}

export const listRecorders = () => request<DataRecorder[]>('/recorders')
export const getRecorder = (id: string) => request<DataRecorder>(`/recorders/${id}`)
export const createRecorder = (body: Record<string, unknown>) => request<DataRecorder>('/recorders', { method: 'POST', body: JSON.stringify(body) })
export const updateRecorder = (id: string, body: Record<string, unknown>) =>
  request<DataRecorder>(`/recorders/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteRecorder = (id: string) => request<null>(`/recorders/${id}`, { method: 'DELETE' })
/** Roda o motor de verdade contra amostras, sem gravar nada. */
export const previewRecorder = (recorder: Record<string, unknown>, samples: unknown[]) =>
  request<PreviewResult>('/preview', { method: 'POST', body: JSON.stringify({ recorder, samples }) })
export const listKeys = (id: string) => request<(string | null)[]>(`/recorders/${id}/keys`)
export const listRecords = (id: string, q: { entityKey?: string; from?: string; to?: string; limit?: number; order?: 'asc' | 'desc' } = {}) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v))
  return request<{ count: number; items: HistoryRecord[] }>(`/recorders/${id}/records${p.toString() ? `?${p}` : ''}`)
}
export const aggregateRecords = (id: string, q: { entityKey?: string; from?: string; to?: string } = {}) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v))
  return request<{ result: Record<string, unknown> }>(`/recorders/${id}/aggregate${p.toString() ? `?${p}` : ''}`)
}

export const MODE_LABEL: Record<RecorderMode, string> = {
  every_event: 'Toda ocorrência',
  on_change: 'Quando mudar',
  snapshot_interval: 'De tempos em tempos',
  schedule_snapshot: 'Uma vez por dia',
  window_aggregate: 'Resumo por período',
  condition: 'Só quando a condição bater',
}

export const MODE_HINT: Record<RecorderMode, string> = {
  every_event: 'Cada dado recebido vira uma linha. Simples, e o que mais cresce.',
  on_change: 'Grava só quando o valor observado muda — repetição não vira linha.',
  snapshot_interval: 'Guarda o último valor conhecido a cada intervalo.',
  schedule_snapshot: 'Guarda o último valor conhecido uma vez por dia, na hora marcada.',
  window_aggregate: 'Junta o que aconteceu no período em uma linha só: primeiro, último, maior, menor, média, soma e contagem.',
  condition: 'Grava só o que passar pelos filtros.',
}

export const OP_LABEL: Record<AggregationOp, string> = {
  first: 'primeiro',
  last: 'último',
  min: 'menor',
  max: 'maior',
  avg: 'média',
  sum: 'soma',
  count: 'contagem',
}

export const SOURCE_LABEL: Record<SourceKind, string> = {
  event: 'Evento do sistema',
  live_data: 'Dado ao vivo (WebSocket)',
  manual: 'Agente, rotina, tool ou webhook',
}

export const emptyRecorder = () => ({
  name: '',
  source: { kind: 'live_data' as SourceKind, ref: '' },
  mode: 'every_event' as RecorderMode,
  entityKeyPath: '',
  occurredAtPath: '',
  intervalMs: 300_000,
  schedule: { hour: 3, minute: 0 },
  filters: [] as RecorderFilter[],
  selectedFields: [] as string[],
  aggregations: [] as AggregationRule[],
  changePath: '',
  retentionDays: 90,
  enabled: true,
})
