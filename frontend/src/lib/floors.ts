import { API_URL } from './api'

// Client + types for the Building/Floor domain (AI operational-building pivot).
// Presentation is gated by featureFlags.aiFloors; the backend always enforces
// ownership. floorId is a serialized ObjectId (hex string).
export type FloorStatus = 'active' | 'archived'
export type Language = 'pt' | 'en' | 'es'

export interface Building {
  id: string
  name: string
  description: string
  defaultTimezone: string
  defaultLanguage: Language
  createdAt: string
  updatedAt: string
}

export interface Floor {
  id: string
  buildingId: string
  name: string
  mission: string
  description: string
  timezone: string
  defaultLanguage: Language
  color: string | null
  icon: string | null
  order: number
  status: FloorStatus
  // How this floor works. The floor is an organisational area — `coordinatorAgentId`
  // only points at an existing agent, and that agent's own policy stays the source of
  // truth for what it may call.
  workMode: 'organization' | 'coordinated'
  coordinatorAgentId: string | null
  instruction: string
  createdAt: string
  updatedAt: string
}

export interface FloorTarget {
  id: string
  kind: 'agent' | 'sector'
  name: string
  competency: string
  mode?: string
  ready: boolean
  blockedReason?: string
}

export interface FloorWorkOverview {
  workMode: 'organization' | 'coordinated'
  instruction: string
  coordinator: { id: string; name: string; objective: string; delegationPolicy: string } | null
  targets: FloorTarget[]
  ready: boolean
  issues: { code: string; message: string; severity: 'blocking' | 'warning' }[]
  preview: { from: string; to: string[] } | null
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json() as Promise<T>
}

const opts = (method: string, body?: unknown): RequestInit => ({
  method,
  credentials: 'include',
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const getBuilding = () => fetch(`${API_URL}/api/building`, opts('GET')).then(json<Building>)
export const patchBuilding = (patch: Partial<Building>) => fetch(`${API_URL}/api/building`, opts('PATCH', patch)).then(json<Building>)

export const listFloors = (includeArchived = false) =>
  fetch(`${API_URL}/api/floors${includeArchived ? '?includeArchived=true' : ''}`, opts('GET')).then(json<Floor[]>)
export const getFloor = (floorId: string) => fetch(`${API_URL}/api/floors/${floorId}`, opts('GET')).then(json<Floor>)
export const createFloor = (input: { name: string; mission?: string; description?: string; timezone?: string }) =>
  fetch(`${API_URL}/api/floors`, opts('POST', input)).then(json<Floor>)
// A refused save carries the SERVER's explanation ("escolha o agente que coordena
// este andar"), not just a status code — the person has to know what to fix.
export const patchFloor = async (floorId: string, patch: Partial<Floor>): Promise<Floor> => {
  const res = await fetch(`${API_URL}/api/floors/${floorId}`, opts('PATCH', patch))
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
    throw new Error(body?.message ?? body?.error ?? 'Não foi possível salvar.')
  }
  return (await res.json()) as Floor
}
export const archiveFloor = (floorId: string) => fetch(`${API_URL}/api/floors/${floorId}/archive`, opts('POST')).then(json<Floor>)
export const restoreFloor = (floorId: string) => fetch(`${API_URL}/api/floors/${floorId}/restore`, opts('POST')).then(json<Floor>)

// Surfaces the backend's guard message/code (LAST_FLOOR / FLOOR_NOT_EMPTY) instead
// of a bare status, so the settings dialog can explain why a delete was refused.
export class FloorApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'FloorApiError'
    this.status = status
    this.code = code
  }
}
export const deleteFloor = async (floorId: string): Promise<void> => {
  const res = await fetch(`${API_URL}/api/floors/${floorId}`, opts('DELETE'))
  if (res.ok || res.status === 204) return
  const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string }
  throw new FloorApiError(res.status, body.message ?? `HTTP ${res.status}`, body.code)
}
export const getFloorActivity = (floorId: string) =>
  fetch(`${API_URL}/api/floors/${floorId}/activity`, opts('GET')).then(json<{ floorId: string; agentCount: number; sectorCount: number }>)

export interface FloorMetrics {
  automationsActive: number
  runsToday: number
  running: number
  failures24h: number
  succeeded24h: number
  successRate: number | null
  recentArtifacts: number
}
export const getFloorMetrics = (floorId: string) =>
  fetch(`${API_URL}/api/floors/${floorId}/metrics`, opts('GET')).then(json<FloorMetrics>)

// The map still consumes the legacy `Record<agentId, 'working'>` shape. The backend
// now projects rich operational states; `legacy=1` asks it for the old contract, so
// the current map is untouched until the bubble layer ships.
export const getAgentStates = (floorId: string) =>
  fetch(`${API_URL}/api/floors/${floorId}/agent-states?legacy=1`, opts('GET')).then(json<Record<string, string>>)

// The versioned DTO the bubble layer will read: enum, timestamps and an allowlisted
// detail. Nothing here can carry a prompt, an input, an output or a raw error.
export interface AgentLiveVisualState {
  agentId: string
  floorId: string | null
  rootExecutionId: string
  state: string
  safeDetail?: { appKey?: string; actionLabel?: string; targetType?: 'agent' | 'sector' | 'channel' }
  startedAt: string
  updatedAt: string
  expiresAt: string
  concurrent: number
}

export interface AgentLiveStatesResponse {
  version: number
  generatedAt: string
  states: AgentLiveVisualState[]
  etag: string | null
}

// Polled every couple of seconds, so the common answer — nothing changed — has to
// cost nothing. `If-None-Match` turns that into a 304 with no body, and `signal`
// lets the caller drop a request that is no longer wanted (floor changed, unmounted)
// instead of paying for a payload it will throw away.
export const getAgentLiveStates = async (
  floorId: string,
  { etag, signal }: { etag?: string | null; signal?: AbortSignal } = {},
): Promise<AgentLiveStatesResponse | null> => {
  const res = await fetch(`${API_URL}/api/floors/${floorId}/agent-states`, {
    ...opts('GET'),
    signal,
    headers: etag ? { 'If-None-Match': etag } : undefined,
  })
  // 304: what is on screen is already current.
  if (res.status === 304) return null
  if (!res.ok) throw new Error('falhou')
  const body = (await res.json()) as Omit<AgentLiveStatesResponse, 'etag'>
  return { ...body, etag: res.headers.get('ETag') }
}

// Aggregated dashboard overview (one call — KPIs + per-floor cards).
export interface FloorOverview {
  floor: Pick<Floor, 'id' | 'name' | 'mission' | 'color' | 'icon' | 'order' | 'status'>
  agentCount: number
  sectorCount: number
  automationsActive: number
  runsActive: number
  failures24h: number
}
export interface BuildingOverview {
  building: { id: string; name: string; description: string }
  totals: { floors: number; agents: number; sectors: number; automationsActive: number; runsActive: number; failures24h: number }
  floors: FloorOverview[]
}
export const getBuildingOverview = () =>
  fetch(`${API_URL}/api/building/overview`, opts('GET')).then(json<BuildingOverview>)

// Choose the active floor: the saved id if it still points at an active floor,
// otherwise the first active floor (floors arrive ordered), otherwise null.
// Pure so the fallback rule (plan §14.5) is unit-testable.
export function resolveActiveFloor(floors: Floor[], savedId: string | null): string | null {
  const active = floors.filter((f) => f.status === 'active')
  if (savedId && active.some((f) => f.id === savedId)) return savedId
  return active[0]?.id ?? null
}

// Who coordinates this floor and what they can effectively reach. Read-only.
export const getFloorWorkOverview = (floorId: string) =>
  fetch(`${API_URL}/api/floors/${floorId}/work-overview`, opts('GET')).then(json<FloorWorkOverview>)
