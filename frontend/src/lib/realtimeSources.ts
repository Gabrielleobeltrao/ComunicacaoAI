import { API_URL } from './api'

/**
 * Fontes de dados em tempo real, do lado da tela.
 *
 * Nada aqui carrega credencial: uma fonte guarda a REFERÊNCIA de uma conexão, e a
 * credencial dela continua cifrada na instalação do App. O que trafega é configuração —
 * de onde ler, qual chave, que nome o agente usa — e o valor de agora.
 */

export interface RealtimeReading {
  found: boolean
  alias: string
  key: string
  value: Record<string, unknown> | null
  receivedAt: string | null
  ageMs: number | null
  stale: boolean
  updates: number | null
}

export interface RealtimeSource {
  id: string
  name: string
  sourceKind: 'live_data'
  sourceRef: string
  /** O nome amigável da conexão. É o que a tela mostra — nunca o id. */
  sourceLabel: string | null
  key: string
  alias: string
  allowedFields: string[] | null
  staleAfterSeconds: number
  agentIds: string[]
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface RealtimeSourceWithReading extends RealtimeSource {
  reading: RealtimeReading
}

export interface RealtimeCatalog {
  live_data: { ref: string; label: string; keys: { key: string; receivedAt: string; updates: number }[] }[]
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_URL}/api/realtime-sources${path}`, {
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

export const listRealtimeSources = () => request<RealtimeSource[]>('/')
export const listAgentSources = (agentId: string) => request<RealtimeSourceWithReading[]>(`/agent/${agentId}`)
export const realtimeCatalog = () => request<RealtimeCatalog>('/catalog')
export const createRealtimeSource = (body: Record<string, unknown>) => request<RealtimeSource>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateRealtimeSource = (id: string, body: Record<string, unknown>) =>
  request<RealtimeSource>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteRealtimeSource = (id: string) => request<null>(`/${id}`, { method: 'DELETE' })
export const grantSourceToAgent = (id: string, agentId: string, granted: boolean) =>
  request<RealtimeSource>(`/${id}/agents/${agentId}`, { method: 'POST', body: JSON.stringify({ granted }) })

/** "há 1s", "há 3 min". A idade é a primeira pergunta de quem olha um dado ao vivo. */
export const idade = (ms: number | null): string => {
  if (ms === null) return '—'
  if (ms < 2_000) return 'agora'
  if (ms < 60_000) return `há ${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `há ${Math.round(ms / 60_000)} min`
  return `há ${Math.round(ms / 3_600_000)}h`
}

/** O status em uma palavra: é o que a pessoa quer saber de relance. */
export const statusDa = (r: RealtimeReading): { texto: string; tone: 'success' | 'warning' | 'neutral' } => {
  if (!r.found) return { texto: 'sem dado ainda', tone: 'neutral' }
  if (r.stale) return { texto: 'dado velho', tone: 'warning' }
  return { texto: 'recebendo', tone: 'success' }
}
