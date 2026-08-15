// The building-wide collaboration context: who exists, in which building, and who
// each of them accepts calls from. Lives outside index.ts so it can be exercised
// against a real database in the integration tests, and so the API, the readiness
// calculation and the validation of client-sent references all read the SAME data.
import { listAgents } from './agents.js'
import type { Agent } from './agents.js'
import { listFloors } from './floors.js'
import { listSectors, normalizeSectorMode, sectorIsExecutable } from './sectors.js'
import { callerPolicyFromLegacy, reachableCollaborators } from './agentReadiness.js'
import type { CollaboratorCandidate, SectorCandidate } from './agentReadiness.js'

// Everything needed to answer "who can this agent actually reach?", loaded once so
// a page listing many agents does not re-query per agent. Owner-scoped by construction.
export interface CollaboratorContext {
  buildingOf: (floorId: string) => string
  agents: CollaboratorCandidate[]
  sectors: SectorCandidate[]
}

export async function collaboratorContext(ownerId: string): Promise<CollaboratorContext> {
  const [floors, all, sectors] = await Promise.all([
    listFloors(ownerId, { includeArchived: true }).catch(() => []),
    listAgents(ownerId).catch(() => []),
    listSectors(ownerId).catch(() => []),
  ])
  const byFloor = new Map(floors.map((f) => [f._id.toString(), f.buildingId.toString()]))
  // A floor we cannot resolve becomes its own building: isolated, never a false match.
  const buildingOf = (floorId: string) => byFloor.get(floorId) ?? floorId
  return {
    buildingOf,
    agents: all.map((a) => ({
      id: a._id.toString(),
      buildingId: buildingOf(a.officeId?.toString() ?? ''),
      callerPolicy: callerPolicyFromLegacy(a),
      allowedCallerAgentIds: a.allowedCallerAgentIds ?? [],
    })),
    sectors: sectors.map((t) => ({
      id: t._id.toString(),
      buildingId: buildingOf(t.officeId?.toString() ?? ''),
      executable: sectorIsExecutable(normalizeSectorMode(t.mode)),
    })),
  }
}

export const collaboratorCountFor = (agent: Agent, ctx: CollaboratorContext): number =>
  reachableCollaborators(
    { ...agent, id: agent._id.toString(), buildingId: ctx.buildingOf(agent.officeId?.toString() ?? '') },
    ctx.agents,
    ctx.sectors,
  ).count

