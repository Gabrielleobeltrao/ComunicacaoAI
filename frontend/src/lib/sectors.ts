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

// Legacy documents used 'adaptive'; anything unknown reads as 'orchestrated', the
// historical executable default. Mirrors backend/src/sectors.ts — without it a
// legacy sector indexes SECTOR_MODE_LABEL with a missing key and blows up the page.
export function normalizeSectorMode(mode: unknown): SectorMode {
  return mode === 'organization' || mode === 'orchestrated' || mode === 'pipeline' ? mode : 'orchestrated'
}

// Operational readiness — mirrors backend/src/sectors.ts (same codes, same copy),
// so the wizard, the sector page and the API agree on what is missing.
export type SectorReadinessCode = 'no_members' | 'no_coordinator' | 'no_stages' | 'stage_without_agent' | 'agent_pending'
export interface SectorReadinessIssue {
  code: SectorReadinessCode
  message: string
  action: string
  severity: 'blocking' | 'warning'
}
export interface SectorReadinessInput {
  mode: SectorMode
  members: { agentId: string }[]
  coordinatorAgentId?: string | null
  stages?: { id: string; name?: string; agentId?: string | null }[]
  pendingAgentNames?: string[]
  knownAgentIds?: string[]
}
export function sectorReadiness(input: SectorReadinessInput): { ready: boolean; issues: SectorReadinessIssue[] } {
  const issues: SectorReadinessIssue[] = []
  const known = input.knownAgentIds ? new Set(input.knownAgentIds) : null
  const mode = normalizeSectorMode(input.mode)
  if (mode === 'organization') {
    if (input.members.length === 0) issues.push({ code: 'no_members', message: 'Este grupo ainda não tem nenhum agente.', action: 'Adicionar agentes', severity: 'blocking' })
  } else if (mode === 'pipeline') {
    const stages = input.stages ?? []
    if (stages.length === 0) issues.push({ code: 'no_stages', message: 'O fluxo ainda não tem nenhuma etapa.', action: 'Adicionar etapa', severity: 'blocking' })
    for (const stage of stages) {
      if (!stage.agentId || (known && !known.has(stage.agentId))) {
        issues.push({ code: 'stage_without_agent', message: `A etapa “${stage.name || stage.id}” está sem um agente válido.`, action: 'Escolher agente', severity: 'blocking' })
      }
    }
  } else {
    if (!input.coordinatorAgentId) issues.push({ code: 'no_coordinator', message: 'Falta escolher quem coordena a equipe.', action: 'Escolher coordenador', severity: 'blocking' })
    if (input.members.length === 0) issues.push({ code: 'no_members', message: 'A equipe ainda não tem membros.', action: 'Adicionar membros', severity: 'blocking' })
  }
  for (const name of input.pendingAgentNames ?? []) {
    issues.push({ code: 'agent_pending', message: `${name} ainda precisa de configuração para trabalhar.`, action: 'Abrir agente', severity: 'warning' })
  }
  return { ready: !issues.some((i) => i.severity === 'blocking'), issues }
}

// Plain-language mode copy — the user picks what the team DOES, not a jargon word.
export const SECTOR_MODE_LABEL: Record<SectorMode, { title: string; help: string }> = {
  organization: { title: 'Só organizar', help: 'Agrupa agentes no mapa. Não executa nada como equipe.' },
  orchestrated: { title: 'Um gerente coordena', help: 'Um coordenador recebe o pedido, aciona quem precisa e junta a resposta.' },
  pipeline: { title: 'Executar em etapas', help: 'As etapas rodam em ordem, cada uma usando o resultado da anterior.' },
}

// Human label for a sector mode — the plain-language title, never the internal word.
export const sectorModeLabel = (mode: SectorMode): string => SECTOR_MODE_LABEL[normalizeSectorMode(mode)].title

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
