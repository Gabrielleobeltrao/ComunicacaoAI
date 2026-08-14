import { API_URL } from './api'
import type { SectorMemberSummary, SectorMode, SectorOverview, SectorSummary } from './types'

// Centralized sector API client (plan §11.1). Surfaces the backend's real error
// message + structured code instead of collapsing failures into empty state.
export class SectorApiError extends Error {
  status: number
  code?: string
  body?: Record<string, unknown>
  constructor(status: number, message: string, code?: string, body?: Record<string, unknown>) {
    super(message)
    this.name = 'SectorApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    throw new SectorApiError(res.status, (body.error as string) ?? `HTTP ${res.status}`, body.code as string | undefined, body)
  }
  return res.json() as Promise<T>
}

const opts = (method: string, body?: unknown): RequestInit => ({
  method,
  credentials: 'include',
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

// Operational readiness — mirrors the backend rule so the badge matches:
//   organization → any member; orchestrated → a coordinator + a member;
//   pipeline → at least one stage.
export function sectorReadiness(
  mode: SectorMode,
  members: SectorMemberSummary[],
  extra?: { coordinatorAgentId?: string | null; stages?: { id: string }[] },
): 'ready' | 'incomplete' {
  if (mode === 'organization') return members.length >= 1 ? 'ready' : 'incomplete'
  if (mode === 'pipeline') return (extra?.stages?.length ?? 0) >= 1 ? 'ready' : 'incomplete'
  return extra?.coordinatorAgentId && members.length >= 1 ? 'ready' : 'incomplete'
}

// Human label for a sector mode (organization / orchestrated / pipeline).
export const sectorModeLabel = (mode: SectorMode): string => (mode === 'pipeline' ? 'Pipeline' : mode === 'organization' ? 'Organização' : 'Orquestrado')

export const getSectorOverview = (sectorId: string) => fetch(`${API_URL}/api/sectors/${sectorId}/overview`, opts('GET')).then(json<SectorOverview>)

export const updateSector = (sectorId: string, patch: Partial<{ name: string; color: string; mode: SectorMode }>) =>
  fetch(`${API_URL}/api/sectors/${sectorId}`, opts('PATCH', patch)).then(json<SectorSummary>)

export const replaceSectorMembers = (sectorId: string, members: SectorMemberSummary[], confirmChannelImpact = false) =>
  fetch(`${API_URL}/api/sectors/${sectorId}/members`, opts('PUT', { members, confirmChannelImpact })).then(json<SectorSummary>)

export interface AssignAgentResult {
  agentId: string
  floorId: string | null
  previousSector: { id: string; name: string } | null
  currentSector: { id: string; name: string; mode: SectorMode } | null
  needsConfiguration: boolean
}
export const assignAgentToSector = (agentId: string, sectorId: string | null) =>
  fetch(`${API_URL}/api/agents/${agentId}/sector`, opts('PUT', { sectorId })).then(json<AssignAgentResult>)

// --- Move a sector between floors (Phase 7) -----------------------------------
export interface SectorMoveImpact {
  sector: { id: string; name: string }
  sourceFloor: { id: string; name: string }
  targetFloor: { id: string; name: string }
  currentMembers: { id: string; name: string }[]
  linkedChannels: { id: string; name: string; type: string }[]
  targetAgents: { id: string; name: string; currentSector: string | null }[]
  analyticsPreserved: boolean
  agentsWillStayOnSourceFloor: boolean
}
export const getSectorMoveImpact = (sectorId: string, targetFloorId: string) =>
  fetch(`${API_URL}/api/sectors/${sectorId}/move-impact?targetFloorId=${encodeURIComponent(targetFloorId)}`, opts('GET')).then(json<SectorMoveImpact>)

export const moveSector = (sectorId: string, body: { targetFloorId: string; members: SectorMemberSummary[]; confirmChannelImpact?: boolean }) =>
  fetch(`${API_URL}/api/sectors/${sectorId}/move`, opts('POST', body)).then(json<SectorSummary>)
