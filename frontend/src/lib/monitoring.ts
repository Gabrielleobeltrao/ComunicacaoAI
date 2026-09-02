import { API_URL } from './api'

// O cliente da Central de Monitoramento.
//
// Testar e ativar são chamadas diferentes de propósito: o backend recusa ativar uma fonte
// que nunca leu, e a tela precisa refletir isso em vez de esconder o botão.

export type SourceKind =
  | 'api_polling'
  | 'webhook'
  | 'websocket'
  | 'app_action'
  | 'rss'
  | 'http_page'
  | 'browser'
  | 'dataset'
  | 'internal_event'

export type SourceStatus = 'draft' | 'active' | 'paused'
export type SourceHealth = 'online' | 'degraded' | 'paused' | 'never_read'

export const KIND_LABEL: Record<SourceKind, string> = {
  api_polling: 'API (consulta periódica)',
  webhook: 'Webhook recebido',
  websocket: 'WebSocket / SSE',
  app_action: 'Ação de App',
  rss: 'RSS / Atom',
  http_page: 'Página web',
  browser: 'Página com navegador',
  dataset: 'Conjunto de dados',
  internal_event: 'Evento da plataforma',
}

export const HEALTH_LABEL: Record<SourceHealth, string> = {
  online: 'no ar',
  degraded: 'degradada',
  paused: 'pausada',
  never_read: 'nunca leu',
}

export const STATUS_LABEL: Record<SourceStatus, string> = {
  draft: 'rascunho',
  active: 'ativa',
  paused: 'pausada',
}

export interface Telemetry {
  lastReadAt: string | null
  lastOkAt: string | null
  lastErrorAt: string | null
  lastErrorCode: string | null
  lastLatencyMs: number | null
  consecutiveFailures: number
  readsOk: number
  readsFailed: number
  reconnects: number
  /** O TESTE, separado da leitura: é ele que destrava a ativação sem gravar histórico. */
  lastTestAt?: string | null
  lastTestOkAt?: string | null
  lastTestError?: string | null
}

export interface FieldRule {
  to: string
  from: string
  transforms?: { op: string; [k: string]: unknown }[]
  required?: boolean
}

export interface SourceSummary {
  id: string
  name: string
  description: string
  kind: SourceKind
  status: SourceStatus
  health: SourceHealth
  config: Record<string, unknown>
  mapping: { version: number; itemsPath?: string | null; fields: FieldRule[] }
  schema: Record<string, unknown>
  cadence: { mode: string; intervalMs: number | null; cron?: string | null; timezone?: string | null }
  freshness: { staleAfterMs: number; onStale: string }
  destination: { live: boolean; history: boolean; retentionDays: number | null }
  /** A chave do conjunto que esta fonte alimenta — só depois de ela ser materializada. */
  datasetKey?: string | null
  nextReadAt: string | null
  telemetry: Telemetry
}

export interface OverviewItem {
  id: string
  name: string
  kind: SourceKind
  status: SourceStatus
  health: SourceHealth
  reason: string
  lastReadAt: string | null
  latencyMs: number | null
  consecutiveFailures: number
  readsOk: number
  readsFailed: number
  nextReadAt: string | null
  destination: { live: boolean; history: boolean }
}

export interface TestOutcome {
  ok: boolean
  rows: Record<string, unknown>[]
  sample: unknown
  strategy: 'json' | 'jsonld' | 'dom' | 'none'
  missing: string[]
  fields: { name: string; present: boolean }[]
  latencyMs: number
  status: number | null
  error?: { kind: string; message: string }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
    throw new Error(corpo?.message ?? corpo?.error ?? `${res.status}`)
  }
  return (res.status === 204 ? (null as T) : ((await res.json()) as T))
}

const req = <T>(caminho: string, init: { method?: string; body?: unknown } = {}): Promise<T> =>
  fetch(`${API_URL}${caminho}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
  }).then((r) => json<T>(r))

export interface ConnectionOption {
  id: string
  name: string
  appKey: string
  status: string
}

/**
 * As conexões que podem emprestar credencial a uma fonte.
 *
 * A fonte guarda só o NOME do cabeçalho; o valor sai daqui, cifrado, na hora da leitura. É
 * por isso que o wizard pergunta "qual conexão" em vez de "qual chave".
 */
export const connections = () =>
  fetch(`${API_URL}/api/app-installations`, { credentials: 'include' })
    .then((r) => (r.ok ? (r.json() as Promise<{ _id: string; name: string; appKey: string; status: string }[]>) : []))
    .then((lista) => lista.map((c) => ({ id: String(c._id), name: c.name, appKey: c.appKey, status: c.status })))
    .catch(() => [] as ConnectionOption[])

export const meta = () => req<{ kinds: { kind: SourceKind; pull: boolean; push: boolean; needsUrl: boolean; needsConnection: boolean }[]; transforms: string[] }>('/api/monitoring/meta')
export const overview = () => req<{ items: OverviewItem[]; summary: Record<string, number> }>('/api/monitoring/overview')
export interface LiveReading {
  at: string
  value: Record<string, unknown>
}

export interface LiveSource {
  id: string
  name: string
  kind: SourceKind
  health: SourceHealth
  lastReadAt: string | null
  latencyMs: number | null
  reconnects: number
  readsOk: number
  readsFailed: number
  readings: LiveReading[]
  triggers: number
}

export const live = () => req<{ items: LiveSource[] }>('/api/monitoring/live').then((r) => r.items)
export const listSources = () => req<{ items: SourceSummary[] }>('/api/monitoring/sources').then((r) => r.items)
export const createSource = (body: unknown) => req<{ id: string; status: SourceStatus }>('/api/monitoring/sources', { method: 'POST', body })
export const updateSource = (id: string, body: unknown) => req<{ id: string }>(`/api/monitoring/sources/${id}`, { method: 'PUT', body })
export const testDraft = (body: unknown) => req<TestOutcome>('/api/monitoring/sources/test', { method: 'POST', body })
export const testSource = (id: string) => req<TestOutcome>(`/api/monitoring/sources/${id}/test`, { method: 'POST' })
export const readNow = (id: string) => req<{ ok: boolean; rows: number; recorded: number; unchanged?: boolean }>(`/api/monitoring/sources/${id}/read`, { method: 'POST' })
export const activate = (id: string) => req<{ status: SourceStatus }>(`/api/monitoring/sources/${id}/activate`, { method: 'POST' })
export const pause = (id: string) => req<{ status: SourceStatus }>(`/api/monitoring/sources/${id}/pause`, { method: 'POST' })
export const duplicate = (id: string) => req<{ id: string; name: string }>(`/api/monitoring/sources/${id}/duplicate`, { method: 'POST' })
export const remove = (id: string) => req<null>(`/api/monitoring/sources/${id}`, { method: 'DELETE' })

/**
 * O monitor de uma fonte — criado de verdade, no motor canônico.
 *
 * O wizard oferece isso no fim, e a promessa precisa ter registro atrás: dizer "um monitor
 * foi criado" sem criar nada é a mentira que só aparece quando a pessoa vai procurá-lo.
 */
export const createMonitorForSource = (id: string, body: unknown) =>
  req<{ id: string; status: string }>(`/api/monitoring/sources/${id}/monitor`, { method: 'POST', body })

export type EventKind = 'collect' | 'delivery' | 'dispatch'
export type EventOutcome = 'ok' | 'unchanged' | 'failed' | 'refused'

export interface MonitoringEvent {
  id: string
  sourceId: string
  sourceName: string
  kind: EventKind
  outcome: EventOutcome
  at: string
  durationMs: number | null
  rows: number | null
  recorded: number | null
  errorCode: string | null
  errorMessage: string | null
  pages: number | null
  monitorId: string | null
  monitorName: string | null
  runId: string | null
}

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  collect: 'coleta',
  delivery: 'entrega recebida',
  dispatch: 'monitor disparou',
}

export const EVENT_OUTCOME_LABEL: Record<EventOutcome, string> = {
  ok: 'deu certo',
  unchanged: 'sem novidade',
  failed: 'falhou',
  refused: 'recusada',
}

/**
 * O histórico operacional, com filtro e página.
 *
 * Contadores acumulados não respondem nenhuma das perguntas de quem abre isto às três da
 * manhã: quando parou, quanto demorou, quantas linhas vieram, qual foi o erro.
 */
export const history = (filtro: { sourceId?: string; kind?: string; outcome?: string; cursor?: string; limit?: number } = {}) => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(filtro)) if (v) q.set(k, String(v))
  return req<{ items: MonitoringEvent[]; nextCursor: string | null }>(`/api/monitoring/history${q.toString() ? `?${q}` : ''}`)
}

/** O tempo relativo como gente lê. Sem biblioteca: são quatro casos. */
export function desde(iso: string | null, agora = Date.now()): string {
  if (!iso) return 'nunca'
  const ms = agora - new Date(iso).getTime()
  if (ms < 0) return 'em instantes'
  if (ms < 60_000) return `há ${Math.max(1, Math.round(ms / 1000))} s`
  if (ms < 3_600_000) return `há ${Math.round(ms / 60_000)} min`
  if (ms < 86_400_000) return `há ${Math.round(ms / 3_600_000)} h`
  return `há ${Math.round(ms / 86_400_000)} d`
}

/**
 * A frase da fonte, em português.
 *
 * A tela não pode mostrar `api_polling / degraded / 3` e esperar que quem lê monte a
 * frase de cabeça — principalmente às três da manhã, que é quando alguém abre isto.
 */
export function frase(item: OverviewItem): string {
  const partes = [KIND_LABEL[item.kind] ?? item.kind]
  if (item.health === 'online') partes.push(`lendo, última ${desde(item.lastReadAt)}`)
  else if (item.health === 'degraded') partes.push(item.reason)
  else if (item.health === 'never_read') partes.push('ainda não leu')
  else partes.push(STATUS_LABEL[item.status])
  if (item.latencyMs !== null && item.health === 'online') partes.push(`${item.latencyMs} ms`)
  return partes.join(' · ')
}
