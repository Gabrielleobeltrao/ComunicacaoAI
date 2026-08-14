// Production wiring for delegation: binds the injected DelegationDeps to the real
// agent store, tool resolver, task runtime, provider keys and delegation log. Kept
// separate from ./delegation.ts so that module stays IO-free and unit-testable.
import { getAgentById, listAgents } from './agents.js'
import type { Agent } from './agents.js'
import { getFloor, listFloors } from './floors.js'
import { getSectorById, normalizeSectorMode } from './sectors.js'
import { resolveAgentTools } from './builtinTools.js'
import { executeAgentTask } from './agentRuntime.js'
import { getProviderApiKey } from './userSettings.js'
import type { Provider } from './llm.js'
import type { ResolvedTool } from './agentTools.js'
import { finishDelegation, startDelegation } from './delegationLog.js'
import { agentCanDelegate, buildDelegationTools, capabilityMissingTool } from './delegation.js'
import type { DelegationContext, DelegationDeps } from './delegation.js'

// The tool list an agent runs with in a delegation-aware context: its own tools,
// the capability_missing escape hatch (every task agent), plus the delegation tools
// bound to the child context when it may delegate.
export async function resolveToolsWithDelegation(agent: Agent, ownerId: string, childCtx: DelegationContext, deps: DelegationDeps): Promise<ResolvedTool[]> {
  const base = await resolveAgentTools(agent, ownerId)
  return [...base, capabilityMissingTool(), ...(agentCanDelegate(agent) ? buildDelegationTools(childCtx, deps) : [])]
}

export function productionDelegationDeps(): DelegationDeps {
  const deps: DelegationDeps = {
    loadAgent: (ownerId, id) => getAgentById(ownerId, id),
    loadSector: async (ownerId, id) => {
      const s = await getSectorById(ownerId, id)
      if (!s) return null
      return {
        _id: s._id,
        name: s.name,
        officeId: s.officeId,
        mode: normalizeSectorMode(s.mode),
        coordinatorAgentId: s.coordinatorAgentId ?? null,
        instruction: s.instruction ?? '',
        members: s.members,
        stages: (s.stages ?? []).map((st) => ({
          id: st.id,
          name: st.name,
          agentId: st.agentId,
          instruction: st.instruction,
          dependsOn: st.dependsOn ?? [],
          expectedOutput: st.expectedOutput ?? '',
          onError: st.onError ?? 'stop',
          retryPolicy: st.retryPolicy ?? { maxAttempts: 1, backoffMs: 2000 },
        })),
      }
    },
    // Every agent whose FLOOR belongs to this building — delegation spans floors of
    // the same building, not just one floor.
    listAgentsInBuilding: async (ownerId, buildingId) => {
      const floors = await listFloors(ownerId, { includeArchived: true })
      const floorIds = new Set(floors.filter((f) => f.buildingId.toString() === buildingId).map((f) => f._id.toString()))
      const all = await listAgents(ownerId)
      return all.filter((a) => floorIds.has(a.officeId.toString()))
    },
    buildingIdForFloor: async (ownerId, floorId) => {
      const floor = await getFloor(ownerId, floorId)
      return floor ? floor.buildingId.toString() : null
    },
    resolveTools: (agent, ownerId, childCtx) => resolveToolsWithDelegation(agent, ownerId, childCtx, deps),
    apiKeyFor: (ownerId, provider) => getProviderApiKey(ownerId, provider as Provider),
    runTask: (req) => executeAgentTask(req),
    startDelegation,
    finishDelegation,
  }
  return deps
}
