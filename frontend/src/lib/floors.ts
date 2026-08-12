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
export const getFloorActivity = (floorId: string) =>
  fetch(`${API_URL}/api/floors/${floorId}/activity`, opts('GET')).then(json<{ floorId: string; agentCount: number; sectorCount: number }>)

// Choose the active floor: the saved id if it still points at an active floor,
// otherwise the first active floor (floors arrive ordered), otherwise null.
// Pure so the fallback rule (plan §14.5) is unit-testable.
export function resolveActiveFloor(floors: Floor[], savedId: string | null): string | null {
  const active = floors.filter((f) => f.status === 'active')
  if (savedId && active.some((f) => f.id === savedId)) return savedId
  return active[0]?.id ?? null
}
