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
  createdAt: string
  updatedAt: string
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
export const patchFloor = (floorId: string, patch: Partial<Floor>) =>
  fetch(`${API_URL}/api/floors/${floorId}`, opts('PATCH', patch)).then(json<Floor>)
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

export const getAgentLiveStates = (floorId: string, updatedSince?: string) =>
  fetch(
    `${API_URL}/api/floors/${floorId}/agent-states${updatedSince ? `?updatedSince=${encodeURIComponent(updatedSince)}` : ''}`,
    opts('GET'),
  ).then(json<{ version: number; generatedAt: string; states: AgentLiveVisualState[] }>)

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
