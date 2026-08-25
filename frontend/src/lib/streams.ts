import { API_URL } from './api'

// O estado dos streams de mercado. Nada aqui carrega credencial: o backend devolve
// estado, contagem e uma frase de erro — nunca o que o provider mandou.

export type StreamState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'paused'

export interface MarketStream {
  id: string
  installationId: string
  appKey: string
  environment: string
  symbols: string[]
  state: StreamState
  lastConnectedAt: string | null
  lastEventAt: string | null
  lastError: { message: string; at: string } | null
  eventCount: number
}

export interface StreamEvent {
  eventId: string
  type: string
  source: string
  schemaVersion: number
  occurredAt: string
  status: 'pending' | 'processing' | 'done' | 'dead_letter'
  attempts: number
  error: string | null
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_URL}${path}`, {
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

export const listStreams = () => request<MarketStream[]>('/api/streams')
/** Ligar ou atualizar. A MESMA rota para os dois: a resposta é a mesma nos dois casos. */
export const saveStream = (installationId: string, symbols: string[]) =>
  request<MarketStream>('/api/streams', { method: 'POST', body: JSON.stringify({ installationId, symbols }) })
/** Desligar de vez. Pausar é outra coisa — guarda a intenção de voltar. */
export const deleteStream = (id: string) => request<null>(`/api/streams/${id}`, { method: 'DELETE' })
export const pauseStream = (id: string) => request<MarketStream>(`/api/streams/${id}/pause`, { method: 'POST' })
export const resumeStream = (id: string) => request<MarketStream>(`/api/streams/${id}/resume`, { method: 'POST' })
export const reconnectStream = (id: string) => request<MarketStream>(`/api/streams/${id}/reconnect`, { method: 'POST' })
export const testStream = (installationId: string) =>
  request<{ ok: boolean; message: string }>('/api/streams/test', { method: 'POST', body: JSON.stringify({ installationId }) })
export const listStreamEvents = (limit = 20) => request<StreamEvent[]>(`/api/streams/events?limit=${limit}`)

export const STREAM_STATE_LABEL: Record<StreamState, string> = {
  disconnected: 'Desligado',
  connecting: 'Conectando',
  connected: 'Recebendo',
  reconnecting: 'Reconectando',
  error: 'Com erro',
  paused: 'Pausado',
}

// Verde só quando está realmente entregando. "Reconectando" é amarelo de propósito:
// não é erro, mas também não é normal — e quem olha precisa dessa diferença.
export const STREAM_STATE_COLOR: Record<StreamState, string> = {
  disconnected: 'var(--text-faint)',
  connecting: 'var(--mango-600)',
  connected: 'var(--intent-brand)',
  reconnecting: 'var(--mango-600)',
  error: 'var(--coral-600, #d92d20)',
  paused: 'var(--text-faint)',
}
