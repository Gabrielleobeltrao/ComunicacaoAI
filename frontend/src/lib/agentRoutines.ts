import { API_URL } from './api'

// Client for agent Rotinas (scheduled tasks that live inside an agent) and the
// agent's Histórico (routine runs + delegations). Backend enforces ownership.
export type RoutineStatus = 'draft' | 'active' | 'paused' | 'archived'

export type Recurrence =
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; weekdays: number[] }
  | { kind: 'monthly'; time: string; day: number }

export interface Routine {
  id: string
  name: string
  objective: string
  status: RoutineStatus
  timezone: string
  cron: string
  recurrence: Recurrence | null
  scheduleLabel: string
  // What the edit form opens with.
  input: string
  outputFormat: 'text' | 'markdown' | 'json'
  delivery: { provider: 'email' | 'telegram'; connectionId: string } | null
  lastPublishedVersion: number | null
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RoutineInput {
  name?: string
  objective: string
  recurrence: Recurrence
  timezone?: string
  input?: string
  outputFormat?: 'text' | 'markdown' | 'json'
  delivery?: { provider: 'email' | 'telegram'; connectionId: string } | null
  retryMaxAttempts?: number
}

export interface RunHistoryItem {
  id: string
  routineId: string
  routineName: string
  status: string
  triggerType: string
  queuedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

export interface DelegationHistoryItem {
  id: string
  direction: 'outgoing' | 'incoming'
  targetType: 'agent' | 'sector'
  targetAgentId: string | null
  targetSectorId: string | null
  objective: string
  status: 'running' | 'succeeded' | 'failed' | 'denied' | 'canceled'
  denyCode: string | null
  outputPreview: string | null
  error: string | null
  createdAt: string
  finishedAt: string | null
}

export interface AgentHistory {
  total: number
  items: RunHistoryItem[]
  delegations: DelegationHistoryItem[]
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(String(res.status))
  return res.json() as Promise<T>
}
const req = (method: string, body?: unknown): RequestInit => ({
  method,
  credentials: 'include',
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

const base = (agentId: string) => `${API_URL}/api/agents/${agentId}`

export const listRoutines = (agentId: string) => fetch(`${base(agentId)}/routines`, req('GET')).then(json<Routine[]>)
export const createRoutine = (agentId: string, input: RoutineInput) => fetch(`${base(agentId)}/routines`, req('POST', input)).then(json<Routine>)
export const updateRoutine = (agentId: string, routineId: string, input: RoutineInput) =>
  fetch(`${base(agentId)}/routines/${routineId}`, req('PATCH', input)).then(json<Routine>)
export const routineAction = (agentId: string, routineId: string, action: 'activate' | 'pause' | 'archive') =>
  fetch(`${base(agentId)}/routines/${routineId}/${action}`, req('POST')).then(json<Routine>)
export const getAgentHistory = (agentId: string, limit = 25) => fetch(`${base(agentId)}/history?limit=${limit}`, req('GET')).then(json<AgentHistory>)

// --- Event triggers (webhooks that belong to this agent) -------------------------
// Agent-native: the user creates "um gatilho por evento", never an automation. The
// signing secret exists in this contract ONLY in the response of create and rotate —
// it is never listed and never stored in the browser.
export interface EventTrigger {
  id: string
  name: string
  objective: string
  status: RoutineStatus
  endpoint: string | null
  requireSignature: boolean
  hasSecret: boolean
  createdAt: string
  updatedAt: string
}

export interface EventTriggerInput {
  name?: string
  objective: string
}

export const listEventTriggers = (agentId: string) => fetch(`${base(agentId)}/event-triggers`, req('GET')).then(json<EventTrigger[]>)
export const createEventTrigger = (agentId: string, input: EventTriggerInput) =>
  fetch(`${base(agentId)}/event-triggers`, req('POST', input)).then(json<EventTrigger & { secret: string }>)
export const updateEventTrigger = (agentId: string, triggerId: string, input: EventTriggerInput) =>
  fetch(`${base(agentId)}/event-triggers/${triggerId}`, req('PATCH', input)).then(json<EventTrigger>)
export const rotateEventTriggerSecret = (agentId: string, triggerId: string) =>
  fetch(`${base(agentId)}/event-triggers/${triggerId}/rotate`, req('POST')).then(json<EventTrigger & { secret: string }>)
export const eventTriggerAction = (agentId: string, triggerId: string, action: 'activate' | 'pause' | 'archive') =>
  fetch(`${base(agentId)}/event-triggers/${triggerId}/${action}`, req('POST')).then(json<EventTrigger>)

// The request a caller has to make. Shown in the UI so integrating does not require
// reading any documentation — and so the signature headers are never a surprise.
export function eventTriggerExample(endpoint: string | null, requireSignature: boolean): string {
  const url = endpoint ?? 'https://…/api/hooks/automations/<chave>'
  const lines = [`curl -X POST ${url} \\`, `  -H 'content-type: application/json' \\`, `  -H 'x-event-id: <id único do evento>' \\`]
  if (requireSignature) lines.push(`  -H 'x-signature: <HMAC-SHA256 do corpo, em hex, com o segredo>' \\`)
  lines.push(`  -d '{"exemplo":"dados do evento"}'`)
  return lines.join('\n')
}

// Delivery destinations available to a routine. The API returns public metadata
// only — a connection's credentials never reach the browser.
export interface DeliveryConnection {
  id: string
  provider: 'email' | 'telegram'
  name: string
  status: string
}
export const listDeliveryConnections = () =>
  fetch(`${API_URL}/api/connections`, req('GET'))
    .then(json<DeliveryConnection[]>)
    .then((list) => list.filter((c) => c.provider === 'email' || c.provider === 'telegram'))
