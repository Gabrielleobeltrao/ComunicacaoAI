import type { AgentSummary, DelegationPolicy, SectorSummary } from './types'
import { normalizeSectorMode } from './sectors'

// Mirrors backend/src/agentReadiness.ts: who this agent can REALLY reach. A policy
// is not a colleague — 'all' over an empty building reaches nobody, which is why the
// hiring wizard, the card and the API must all count the same way.
//
// The frontend only ever holds one floor's agents, and a floor always belongs to a
// single building, so "same building" is already true for the lists it passes in.

export interface ReachableInput {
  // The agent doing the calling. `id` is empty while hiring (it does not exist yet).
  id?: string
  delegationPolicy: DelegationPolicy
  callableAgentIds?: string[]
  callableSectorIds?: string[]
}

export function reachableCollaboratorCount(agent: ReachableInput, agents: AgentSummary[], sectors: SectorSummary[]): number {
  if (agent.delegationPolicy === 'none') return 0
  const selectedAgents = new Set(agent.callableAgentIds ?? [])
  const selectedSectors = new Set(agent.callableSectorIds ?? [])

  const reachableAgents = agents
    .filter((a) => a._id !== agent.id)
    .filter((a) => (agent.delegationPolicy === 'selected' ? selectedAgents.has(a._id) : true))
    .filter((a) => {
      const incoming = a.callerPolicy ?? 'all'
      if (incoming === 'none') return false
      if (incoming === 'selected') return Boolean(agent.id) && (a.allowedCallerAgentIds ?? []).includes(agent.id as string)
      return true
    }).length

  // Only a sector that can actually execute counts as a collaborator.
  const reachableSectors = sectors
    .filter((s) => normalizeSectorMode(s.mode) !== 'organization')
    .filter((s) => (agent.delegationPolicy === 'selected' ? selectedSectors.has(s._id) : true)).length

  return reachableAgents + reachableSectors
}
