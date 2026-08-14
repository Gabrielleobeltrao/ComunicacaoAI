// Production wiring for delegation: binds the injected DelegationDeps to the real
// agent store, tool resolver, task runtime, provider keys and delegation log. Kept
// separate from ./delegation.ts so that module stays IO-free and unit-testable.
import { ObjectId } from 'mongodb'
import { getAgentById, listAgents } from './agents.js'
import type { Agent } from './agents.js'
import { getSectorById } from './sectors.js'
import { resolveAgentTools } from './builtinTools.js'
import { executeAgentTask } from './agentRuntime.js'
import { getProviderApiKey } from './userSettings.js'
import type { Provider } from './llm.js'
import type { ResolvedTool } from './agentTools.js'
import { finishDelegation, startDelegation } from './delegationLog.js'
import { agentCanDelegate, buildDelegationTools } from './delegation.js'
import type { DelegationContext, DelegationDeps } from './delegation.js'

// The tool list an agent runs with in a delegation-aware context: its own tools,
// plus the delegation tools bound to the child context when it may delegate.
export async function resolveToolsWithDelegation(agent: Agent, ownerId: string, childCtx: DelegationContext, deps: DelegationDeps): Promise<ResolvedTool[]> {
  const base = await resolveAgentTools(agent, ownerId)
  if (!agentCanDelegate(agent)) return base
  return [...base, ...buildDelegationTools(childCtx, deps)]
}

export function productionDelegationDeps(): DelegationDeps {
  const deps: DelegationDeps = {
    loadAgent: (ownerId, id) => getAgentById(ownerId, id),
    loadSector: async (ownerId, id) => {
      const s = await getSectorById(ownerId, id)
      return s ? { _id: s._id, name: s.name, officeId: s.officeId, mode: s.mode ?? 'adaptive', members: s.members } : null
    },
    listAgentsInBuilding: (ownerId, buildingId) => listAgents(ownerId, new ObjectId(buildingId)),
    resolveTools: (agent, ownerId, childCtx) => resolveToolsWithDelegation(agent, ownerId, childCtx, deps),
    apiKeyFor: (ownerId, provider) => getProviderApiKey(ownerId, provider as Provider),
    runTask: (req) => executeAgentTask(req),
    startDelegation,
    finishDelegation,
  }
  return deps
}
