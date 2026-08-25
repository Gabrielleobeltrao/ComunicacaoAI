import { API_URL } from './api'

/**
 * O App WebSocket Genérico, do lado da tela.
 *
 * Nada aqui carrega credencial: a configuração pública sai sem o valor do segredo — ele
 * nunca passa por esta estrutura —, e mensagem e log já chegam cortados do servidor.
 */

export type WsFormat = 'json' | 'text'
export type WsAuthKind = 'none' | 'header' | 'query' | 'message'
export type WsDedupeStrategy = 'none' | 'message_id' | 'payload_hash'
export type WsMessageStatus = 'accepted' | 'filtered' | 'invalid' | 'duplicate' | 'rate_limited' | 'too_large'
export type WsDestinationKind = 'history' | 'memory' | 'routine' | 'agent' | 'sector'

export interface WsFilter {
  path: string
  operator: 'equals' | 'contains'
  value: string
}

export interface WsConnectionConfig {
  endpoint: string
  format: WsFormat
  auth: { kind: WsAuthKind; name: string; prefix: string; messageTemplate: string }
  protocols: string[]
  heartbeat: { enabled: boolean; message: string; intervalMs: number }
  idleTimeoutMs: number
  paths: { payload: string; messageId: string; channel: string; occurredAt: string }
  schema: Record<string, unknown> | null
  filters: WsFilter[]
  dedupe: WsDedupeStrategy
  maxMessagesPerMinute: number
  maxMessageBytes: number
}

export interface WsStream {
  id: string
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'paused'
  lastConnectedAt: string | null
  lastEventAt: string | null
  lastError: { message: string; at: string } | null
  eventCount: number
}

export interface WsConnection {
  id: string
  name: string
  status: string
  config: WsConnectionConfig | null
  stream: WsStream | null
  messages: { total: number; accepted: number; lastAt: string | null }
}

export interface WsDestination {
  kind: WsDestinationKind
  memoryScope?: 'agent' | 'sector' | 'floor' | 'building'
  agentId?: string | null
  sectorId?: string | null
  floorId?: string | null
  buildingId?: string | null
  automationId?: string | null
}

export interface WsSubscription {
  id: string
  installationId: string
  name: string
  subscribeMessage: string
  unsubscribeMessage: string
  filters: WsFilter[]
  channel: string
  active: boolean
  destination: WsDestination
  messageCount: number
  lastMessageAt: string | null
}

export interface WsMessage {
  id: string
  installationId: string
  subscriptionId: string | null
  channel: string
  status: WsMessageStatus
  preview: string
  eventId: string | null
  occurredAt: string
  receivedAt: string
}

export interface WsLog {
  id: string
  installationId: string
  kind: string
  message: string
  subscriptionId: string | null
  createdAt: string
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_URL}/api/websocket${path}`, {
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

export const listConnections = () => request<WsConnection[]>('/connections')
export const saveConnection = (id: string, body: { name?: string; config: WsConnectionConfig; token?: string }) =>
  request<{ id: string; name: string; config: WsConnectionConfig }>(`/connections/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const checkUrl = (endpoint: string) => request<{ ok: boolean; message: string }>('/check-url', { method: 'POST', body: JSON.stringify({ endpoint }) })
export const startConnection = (id: string) => request<WsStream>(`/connections/${id}/start`, { method: 'POST' })
export const pauseWsStream = (id: string) => request<WsStream>(`/streams/${id}/pause`, { method: 'POST' })
export const resumeWsStream = (id: string) => request<WsStream>(`/streams/${id}/resume`, { method: 'POST' })
export const stopWsStream = (id: string) => request<null>(`/streams/${id}`, { method: 'DELETE' })

export const listSubscriptions = (installationId?: string) =>
  request<WsSubscription[]>(`/subscriptions${installationId ? `?installationId=${encodeURIComponent(installationId)}` : ''}`)
export const createSubscription = (body: Record<string, unknown>) => request<WsSubscription>('/subscriptions', { method: 'POST', body: JSON.stringify(body) })
export const updateSubscription = (id: string, body: Record<string, unknown>) =>
  request<WsSubscription>(`/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSubscription = (id: string) => request<null>(`/subscriptions/${id}`, { method: 'DELETE' })

export const listMessages = (q: { installationId?: string; channel?: string; status?: string; skip?: number; limit?: number } = {}) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v))
  return request<{ total: number; items: WsMessage[] }>(`/messages${p.toString() ? `?${p}` : ''}`)
}

export const listLogs = (installationId?: string) =>
  request<WsLog[]>(`/logs${installationId ? `?installationId=${encodeURIComponent(installationId)}` : ''}`)

export const emptyConfig = (): WsConnectionConfig => ({
  endpoint: '',
  format: 'json',
  auth: { kind: 'none', name: '', prefix: '', messageTemplate: '' },
  protocols: [],
  heartbeat: { enabled: false, message: '', intervalMs: 30_000 },
  idleTimeoutMs: 90_000,
  paths: { payload: '', messageId: '', channel: '', occurredAt: '' },
  schema: null,
  filters: [],
  dedupe: 'none',
  maxMessagesPerMinute: 120,
  maxMessageBytes: 16_000,
})

export const STATUS_LABEL: Record<WsMessageStatus, string> = {
  accepted: 'Recebida',
  filtered: 'Filtrada',
  invalid: 'Inválida',
  duplicate: 'Repetida',
  rate_limited: 'Acima do limite',
  too_large: 'Grande demais',
}

export const DESTINATION_LABEL: Record<WsDestinationKind, string> = {
  history: 'Só guardar',
  memory: 'Memória',
  routine: 'Rotina',
  agent: 'Agente',
  sector: 'Setor',
}
