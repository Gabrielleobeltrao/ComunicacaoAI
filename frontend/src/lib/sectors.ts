import { API_URL } from './api'
import type { SectorMemberSummary, SectorMode, SectorOverview, SectorStageSummary, SectorSummary, SectorTransition } from './types'

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
/**
 * Quem está NESTE setor — venha de onde vier.
 *
 * Um setor guarda seus agentes em dois lugares diferentes conforme o modo: em
 * `members` no orquestrado e no organizacional, e em `stages` no "executar em etapas".
 * A página lia só `members`, então um pipeline — que salva etapas e deixa `members`
 * vazio — mostrava "0 agentes" e uma coluna em branco ao lado do desenho do fluxo, com
 * os agentes existindo o tempo todo dentro das etapas.
 *
 * Esta função é a resposta única para "quem trabalha aqui". Quem pergunta não precisa
 * saber onde o dado ficou guardado.
 */
export interface SectorRosterEntry {
  agentId: string
  /** 1, 2, 3… — a ordem da etapa no pipeline; a posição na lista nos outros modos. */
  order: number
  /** O nome da ETAPA, quando há uma. É o que dá sentido ao agente estar ali. */
  stageName?: string
  /** O que a etapa espera receber de quem vem antes. */
  dependsOnNames?: string[]
  isDefault: boolean
  isCoordinator: boolean
  routingDescription?: string
  advanceWhen?: string
  transitions?: SectorTransition[]
}

export function sectorRoster(sector: {
  mode: SectorMode
  members?: SectorMemberSummary[]
  stages?: SectorStageSummary[]
  coordinatorAgentId?: string | null
}): SectorRosterEntry[] {
  const coordenador = sector.coordinatorAgentId ?? null
  if (normalizeSectorMode(sector.mode) === 'pipeline') {
    const etapas = sector.stages ?? []
    const nomePorId = new Map(etapas.map((e) => [e.id, e.name]))
    // Com etapas, elas mandam. Sem etapas, um pipeline antigo ainda pode ter membros —
    // e mostrar esses membros é melhor que mostrar nada.
    if (etapas.length > 0) {
      return etapas.map((etapa, i) => ({
        agentId: etapa.agentId,
        order: i + 1,
        stageName: etapa.name,
        dependsOnNames: etapa.dependsOn.map((id: string) => nomePorId.get(id) ?? id).filter(Boolean),
        isDefault: false,
        isCoordinator: etapa.agentId === coordenador,
      }))
    }
  }
  return (sector.members ?? []).map((m, i) => ({
    agentId: m.agentId,
    order: i + 1,
    isDefault: m.isDefault,
    isCoordinator: m.agentId === coordenador,
    routingDescription: m.routingDescription,
    advanceWhen: m.advanceWhen,
    transitions: m.transitions,
  }))
}

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
