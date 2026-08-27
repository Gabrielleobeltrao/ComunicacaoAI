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
export type PersistPolicy = 'aggregate_only' | 'raw_only' | 'raw_and_aggregate'
export type RecordKind = 'raw' | 'aggregate' | 'snapshot'
export type FilterOperator = 'exists' | 'equals' | 'not_equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'

/** Onde o histórico é guardado. Hoje só o banco interno; a lista vem do servidor. */
export interface StorageTarget {
  kind: string
  connectionId?: string | null
}

export interface StorageOption {
  kind: string
  label: string
}

/**
 * Por quanto tempo. "Para sempre" quer dizer que o sistema não apaga sozinho — não que
 * o espaço seja ilimitado: os limites de registros e de tamanho continuam valendo.
 */
export type Retention = { mode: 'forever' } | { mode: 'ttl'; days: number }

/** Uma agenda: recorrência em cron e o fuso de quem configurou. */
export interface RecorderSchedule {
  cron: string
  timezone: string
}

/** O que a tela oferece para escolher, com o id guardado por baixo. */
export interface SourceOption {
  ref: string
  label: string
  hint?: string
}

export interface SourceCatalog {
  live_data: SourceOption[]
  event: SourceOption[]
}

export interface AggregationRule {
  from: string
  op: AggregationOp
  to: string
}

export interface RecorderFilter {
  path: string
  operator: FilterOperator
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
  schedule: RecorderSchedule | null
  persistPolicy: PersistPolicy
  filters: RecorderFilter[]
  selectedFields: string[] | null
  aggregations: AggregationRule[]
  changePath: string | null
  retentionDays: number | null
  retention: Retention
  storage: StorageTarget
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
  recordKind: RecordKind
  value: Record<string, unknown>
}

export interface PreviewDecision {
  index: number
  resultado: string
  /** A frase que explica a decisão — é ela que a tela mostra. */
  motivo: string
  entityKey: string | null
  occurredAt: string
  valor: Record<string, unknown> | null
}

export interface PreviewResult {
  decisions: PreviewDecision[]
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
export const listSources = () => request<SourceCatalog>('/sources')
export const listStorages = () => request<StorageOption[]>('/storages')
export const listRecords = (
  id: string,
  q: { entityKey?: string; from?: string; to?: string; recordKind?: RecordKind | ''; limit?: number; skip?: number; order?: 'asc' | 'desc' } = {},
) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v))
  return request<{ count: number; total: number; skip: number; items: HistoryRecord[] }>(`/recorders/${id}/records${p.toString() ? `?${p}` : ''}`)
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

export const OPERATOR_LABEL: Record<FilterOperator, string> = {
  exists: 'existe',
  equals: 'é igual a',
  not_equals: 'é diferente de',
  gt: 'maior que',
  gte: 'maior ou igual a',
  lt: 'menor que',
  lte: 'menor ou igual a',
  contains: 'contém',
}

export const POLICY_LABEL: Record<PersistPolicy, string> = {
  aggregate_only: 'Só o resumo do período',
  raw_only: 'Só os dados brutos',
  raw_and_aggregate: 'Os dois: bruto e resumo',
}

export const POLICY_HINT: Record<PersistPolicy, string> = {
  aggregate_only: 'Uma linha por período. É o que quase todo mundo quer — e o que cabe no banco.',
  raw_only: 'Uma linha por dado recebido. Cresce rápido: um dado por segundo são 86 mil linhas por dia.',
  raw_and_aggregate: 'Guarda o dado recebido E o resumo. Útil para auditar ou recalcular depois; ocupa muito mais.',
}

export const KIND_LABEL: Record<RecordKind, string> = {
  raw: 'Bruto',
  aggregate: 'Resumo',
  snapshot: 'Retrato',
}

/** As recorrências que a tela oferece. Tudo vira cron, que é o que o servidor entende. */
export const RECURRENCES = [
  { cron: '0 * * * *', label: 'A cada hora' },
  { cron: '0 8 * * *', label: 'Todo dia de manhã (8h)' },
  { cron: '0 18 * * *', label: 'Todo dia à tarde (18h)' },
  { cron: '0 8 * * 1-5', label: 'Dias úteis, de manhã (8h)' },
  { cron: '0 8 * * 1', label: 'Toda segunda-feira (8h)' },
  { cron: '0 8 1 * *', label: 'Todo dia 1º do mês (8h)' },
]

/** Fusos comuns por aqui. Qualquer IANA válido é aceito pelo servidor. */
export const TIMEZONES = ['America/Sao_Paulo', 'America/New_York', 'America/Chicago', 'Europe/Lisbon', 'Europe/London', 'UTC']

/** As opções de prazo que a tela oferece. `null` é "para sempre". */
export const RETENTIONS: { dias: number | null; label: string }[] = [
  { dias: null, label: 'Para sempre' },
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
  { dias: 365, label: '1 ano' },
]

export const retentionLabel = (r: Retention): string =>
  r.mode === 'forever' ? 'Para sempre' : (RETENTIONS.find((o) => o.dias === r.days)?.label ?? `${r.days} dias`)

export const emptyRecorder = () => ({
  name: '',
  source: { kind: 'live_data' as SourceKind, ref: '' },
  mode: 'every_event' as RecorderMode,
  entityKeyPath: '',
  occurredAtPath: '',
  intervalMs: 300_000,
  schedule: { cron: '0 8 * * *', timezone: 'America/Sao_Paulo' } as RecorderSchedule,
  persistPolicy: 'aggregate_only' as PersistPolicy,
  filters: [] as RecorderFilter[],
  selectedFields: [] as string[],
  aggregations: [] as AggregationRule[],
  changePath: '',
  retention: { mode: 'ttl', days: 90 } as Retention,
  storage: { kind: 'internal', connectionId: null } as StorageTarget,
  enabled: true,
})
