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
}

// The four triggers with both truths, so the UI can say "permitido, mas não
// configurado" instead of implying the agent already runs on a schedule.
export function triggerStates(agent: Pick<Agent, 'activationModes'>, wiring: AgentWiring): TriggerState[] {
  const { allowed } = normalizeActivation(agent.activationModes)
  const isAllowed = (k: TriggerKind) => allowed.includes(k)
  return [
    { kind: 'manual', allowed: isAllowed('manual'), configured: isAllowed('manual') },
    { kind: 'scheduled', allowed: isAllowed('scheduled'), configured: wiring.routineCount > 0 },
    { kind: 'channel', allowed: isAllowed('channel'), configured: wiring.channelCount > 0 },
    { kind: 'event', allowed: isAllowed('event'), configured: wiring.webhookCount > 0 },
  ]
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
    case 'manager': {
      // 'all' means the whole building is reachable — that already counts as having
      // collaborators; 'selected' must actually name someone.
      const hasCollaborators =
        agent.delegationPolicy === 'all' ||
        (agent.delegationPolicy === 'selected' && (agent.callableAgentIds?.length ?? 0) + (agent.callableSectorIds?.length ?? 0) > 0) ||
        wiring.collaboratorCount > 0
      if (!hasCollaborators) issues.push(issue('no_collaborators'))
      break
    }
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
