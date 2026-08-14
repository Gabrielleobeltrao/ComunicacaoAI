// The conceptual model behind the agent UI, kept pure so it can be unit-tested and
// shared by the API and the frontend.
//
// Two corrections live here:
//
// 1. `agent_only` was never a trigger — it says WHO may call the agent, which is what
//    `callerPolicy` already models. It is read (legacy agents still carry it) and
//    normalised away, never written again.
//
// 2. An activation has two different truths: it may be ALLOWED (the agent accepts it)
//    and it may be CONFIGURED (something real exists that fires it — a routine, a
//    channel, a webhook). The UI must not promise "scheduled" when no routine exists.
import type { ActivationMode, Agent, AgentPreset, DelegationPolicy } from './agents.js'

// Real triggers. 'agent_only' is deliberately absent: it is a permission, not a way in.
export type TriggerKind = 'manual' | 'scheduled' | 'channel' | 'event'
export const TRIGGER_KINDS: TriggerKind[] = ['manual', 'scheduled', 'channel', 'event']

// What a legacy `agent_only` meant, expressed in the model that owns it. Reading an
// old agent yields the same behaviour without keeping the duplicate concept.
export interface NormalizedActivation {
  // Triggers the agent accepts (the 'allowed' side).
  allowed: TriggerKind[]
  // True when the agent was marked agent_only, i.e. it exists to be called by other
  // agents/sectors rather than started on its own.
  agentOnly: boolean
}

export function normalizeActivation(modes: ActivationMode[] | undefined): NormalizedActivation {
  const list = modes ?? []
  const agentOnly = list.includes('agent_only')
  const allowed = TRIGGER_KINDS.filter((t) => list.includes(t as ActivationMode))
  return { allowed, agentOnly }
}

// The WRITE path: agent_only is never stored again. Anything a client sends is
// reduced to real triggers, and a legacy agent_only is converted into the incoming
// permission it always meant (unless the caller stated one explicitly).
export function sanitizeActivationWrite(
  modes: readonly string[] | undefined,
  explicitCallerPolicy?: DelegationPolicy,
): { activationModes: TriggerKind[]; callerPolicy?: DelegationPolicy } {
  const list = modes ?? []
  const activationModes = TRIGGER_KINDS.filter((t) => list.includes(t))
  // Only widen the incoming permission when the client did NOT decide for itself.
  const callerPolicy = list.includes('agent_only') && !explicitCallerPolicy ? ('all' as DelegationPolicy) : explicitCallerPolicy
  return { activationModes, callerPolicy }
}

// The incoming permission a legacy agent_only agent should have: reachable by other
// agents. Only used when the stored callerPolicy is absent — an explicit choice always
// wins, and this never widens an agent that already restricted itself.
export function callerPolicyFromLegacy(agent: Pick<Agent, 'activationModes' | 'callerPolicy'>): DelegationPolicy {
  if (agent.callerPolicy) return agent.callerPolicy
  return 'all'
}

// What actually exists around the agent right now. Supplied by the API from real
// rows (routines, widgets, webhooks) — never guessed.
export interface AgentWiring {
  routineCount: number
  channelCount: number
  webhookCount: number
  collaboratorCount: number // agents/sectors this agent may call (selected ones)
  toolCount: number // custom HTTP tools + enabled built-in apps
  knowledgeCount: number
  deliveryConfigured: boolean // a real destination for a communicator
}

export const EMPTY_WIRING: AgentWiring = {
  routineCount: 0,
  channelCount: 0,
  webhookCount: 0,
  collaboratorCount: 0,
  toolCount: 0,
  knowledgeCount: 0,
  deliveryConfigured: false,
}

export interface TriggerState {
  kind: TriggerKind
  allowed: boolean
  // Configured = something real fires it. 'manual' is configured whenever allowed:
  // pressing the button IS the configuration.
  configured: boolean
  // Legacy inconsistency: something real fires this trigger while the agent does not
  // allow it. New configuration syncs the permission (see ensureActivationMode), so
  // this only ever describes rows written before that rule existed. The UI says
  // "Configurado, mas não permitido" and offers the one-click fix.
  inconsistent: boolean
}

// The four triggers with both truths, so the UI can say "permitido, mas não
// configurado" instead of implying the agent already runs on a schedule.
export function triggerStates(agent: Pick<Agent, 'activationModes'>, wiring: AgentWiring): TriggerState[] {
  const { allowed } = normalizeActivation(agent.activationModes)
  const isAllowed = (k: TriggerKind) => allowed.includes(k)
  // Manual is the one trigger with no external row: being allowed IS being configured.
  // Every other one is configured only by something that really exists — a channel is
  // never "configured" just because the agent accepts channels.
  const raw: [TriggerKind, boolean, boolean][] = [
    ['manual', isAllowed('manual'), isAllowed('manual')],
    ['scheduled', isAllowed('scheduled'), wiring.routineCount > 0],
    ['channel', isAllowed('channel'), wiring.channelCount > 0],
    ['event', isAllowed('event'), wiring.webhookCount > 0],
  ]
  return raw.map(([kind, allowedNow, configured]) => ({ kind, allowed: allowedNow, configured, inconsistent: configured && !allowedNow }))
}

// Which permission a piece of configuration implies. Used at the write site so
// creating a routine/channel/webhook keeps activationModes — the single source of
// truth for "allowed" — in sync instead of drifting from it.
export const TRIGGER_FOR_CONFIG = { routine: 'scheduled', channel: 'channel', webhook: 'event' } as const

// ------------------------------------------------------------ collaborators
// Who this agent can REALLY reach right now. Mirrors checkDelegation: same owner
// (the caller passes owner-scoped lists), same building, never itself, the target
// must accept the call, and a sector only counts when it can actually execute.
export interface CollaboratorCandidate {
  id: string
  buildingId: string
  callerPolicy?: DelegationPolicy
  allowedCallerAgentIds?: string[]
}
export interface SectorCandidate {
  id: string
  buildingId: string
  executable: boolean
}

export function reachableCollaborators(
  agent: Pick<Agent, 'delegationPolicy' | 'callableAgentIds' | 'callableSectorIds'> & { id: string; buildingId: string },
  agents: CollaboratorCandidate[],
  sectors: SectorCandidate[],
): { agentIds: string[]; sectorIds: string[]; count: number } {
  const policy = agent.delegationPolicy ?? 'none'
  if (policy === 'none') return { agentIds: [], sectorIds: [], count: 0 }

  const selectedAgents = new Set(agent.callableAgentIds ?? [])
  const selectedSectors = new Set(agent.callableSectorIds ?? [])

  const agentIds = agents
    .filter((c) => c.id !== agent.id && c.buildingId === agent.buildingId)
    .filter((c) => (policy === 'selected' ? selectedAgents.has(c.id) : true))
    // The target's own incoming policy decides too — 'all' does not override a
    // colleague that refuses calls.
    .filter((c) => {
      const incoming = c.callerPolicy ?? 'all'
      if (incoming === 'none') return false
      if (incoming === 'selected') return (c.allowedCallerAgentIds ?? []).includes(agent.id)
      return true
    })
    .map((c) => c.id)

  const sectorIds = sectors
    .filter((s) => s.executable && s.buildingId === agent.buildingId)
    .filter((s) => (policy === 'selected' ? selectedSectors.has(s.id) : true))
    .map((s) => s.id)

  return { agentIds, sectorIds, count: agentIds.length + sectorIds.length }
}

// ---------------------------------------------------------------- readiness
export type ReadinessCode = 'no_collaborators' | 'no_research_source' | 'no_tool' | 'no_monitor_source' | 'no_delivery_destination' | 'no_objective'

export interface ReadinessIssue {
  code: ReadinessCode
  // Plain-language explanation and the single action that fixes it.
  message: string
  action: string
  // Where the action lives in the agent page, so the UI can deep-link.
  section: 'como-trabalha' | 'fluxos' | 'visao-geral'
}

export interface Readiness {
  ready: boolean
  issues: ReadinessIssue[]
}

const ISSUE: Record<ReadinessCode, Omit<ReadinessIssue, 'code'>> = {
  no_objective: { message: 'Este agente ainda não tem um objetivo descrito.', action: 'Descrever o objetivo', section: 'visao-geral' },
  no_collaborators: { message: 'Um gerente precisa de colegas para acionar.', action: 'Adicionar colaboradores', section: 'fluxos' },
  no_research_source: { message: 'Este pesquisador não tem nenhuma fonte para consultar.', action: 'Adicionar ferramenta', section: 'como-trabalha' },
  no_tool: { message: 'Um operador precisa de uma integração para executar a ação.', action: 'Adicionar ferramenta', section: 'como-trabalha' },
  no_monitor_source: { message: 'Um monitor precisa de uma fonte e de uma rotina que o acorde.', action: 'Criar rotina', section: 'fluxos' },
  no_delivery_destination: { message: 'Este comunicador envia, mas não tem destino configurado.', action: 'Definir destino', section: 'fluxos' },
}

const issue = (code: ReadinessCode): ReadinessIssue => ({ code, ...ISSUE[code] })

// Is the agent actually able to do its job? One place, per preset, so the wizard
// checklist, the agent page and any test agree on the answer.
export function agentReadiness(agent: Pick<Agent, 'preset' | 'objective' | 'delegationPolicy' | 'callableAgentIds' | 'callableSectorIds'>, wiring: AgentWiring = EMPTY_WIRING): Readiness {
  const issues: ReadinessIssue[] = []
  if (!agent.objective || !agent.objective.trim()) issues.push(issue('no_objective'))

  const preset: AgentPreset = agent.preset ?? 'custom'
  switch (preset) {
    case 'manager':
      // A policy is not a colleague: 'all' over an empty building reaches nobody.
      // collaboratorCount is the REAL count (reachableCollaborators), so the manager
      // is only ready once someone is actually callable.
      if (wiring.collaboratorCount === 0) issues.push(issue('no_collaborators'))
      break
    case 'researcher':
      // Knowledge counts as a source: an agent that only reads a curated base is
      // still able to answer.
      if (wiring.toolCount === 0 && wiring.knowledgeCount === 0) issues.push(issue('no_research_source'))
      break
    case 'operator':
      if (wiring.toolCount === 0) issues.push(issue('no_tool'))
      break
    case 'monitor':
      if (wiring.toolCount === 0 && wiring.knowledgeCount === 0) issues.push(issue('no_monitor_source'))
      else if (wiring.routineCount === 0) issues.push(issue('no_monitor_source'))
      break
    case 'communicator':
      // Only complain when it was actually set up to send somewhere.
      if (wiring.routineCount > 0 && !wiring.deliveryConfigured && wiring.channelCount === 0) issues.push(issue('no_delivery_destination'))
      break
    case 'analyst':
    case 'secretary':
    case 'custom':
      break
  }
  return { ready: issues.length === 0, issues }
}
