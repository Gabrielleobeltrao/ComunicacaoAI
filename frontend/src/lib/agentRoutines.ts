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
  lastPublishedVersion: number | null
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
