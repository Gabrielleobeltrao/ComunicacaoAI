// "Como este andar trabalha", answered from what really exists.
//
// The floor never gains a runtime of its own: coordination reuses the agent that was
// chosen, its own delegation policy, and the delegation tools that already exist. So
// this module only DISCOVERS and VALIDATES — it computes who the coordinator can
// effectively reach and whether the arrangement is ready, and it changes nothing.
import { ObjectId } from 'mongodb'
import { db } from './db.js'
import type { Agent } from './agents.js'
import { withAgentDefaults } from './agents.js'
import type { Floor } from './floors.js'
import { normalizeSectorMode } from './sectors.js'

export interface FloorTarget {
  id: string
  kind: 'agent' | 'sector'
  name: string
  // What it is good at / what it is for — the competency the model chooses by.
  competency: string
  // A sector that only groups agents is not an executable target.
  mode?: string
  ready: boolean
  // Why it is not usable, in the product's words. Never a stack trace.
  blockedReason?: string
}

export interface FloorWorkOverview {
  workMode: Floor['workMode']
  instruction: string
  coordinator: { id: string; name: string; objective: string; delegationPolicy: string } | null
  // Everything the coordinator may actually reach, given ITS policy — not everything
  // that exists on the floor.
  targets: FloorTarget[]
  ready: boolean
  issues: { code: string; message: string; severity: 'blocking' | 'warning' }[]
  // A sanitized preview of the arrangement, for the UI to render without guessing.
  preview: { from: string; to: string[] } | null
}

const agents = db.collection<Agent>('agents')
const sectors = db.collection<{
  _id: ObjectId
  ownerId: string
  officeId: ObjectId
  name: string
  mode?: string
  objective?: string
  inputContract?: string
  members?: { agentId: ObjectId }[]
  stages?: { agentId: ObjectId }[]
  coordinatorAgentId?: ObjectId | null
}>('sectors')

const competencyOf = (a: Agent): string => (a.capabilities?.length ? a.capabilities.join(', ') : a.objective || '')

// Which targets a policy really opens. `all` still means the building, and it is
// never turned on implicitly by the floor's configuration.
export function effectiveTargets(
  coordinator: Agent,
  floorAgents: Agent[],
  floorSectors: { _id: ObjectId; name: string; mode?: string; objective?: string; officeId: ObjectId }[],
  buildingAgents: Agent[],
): FloorTarget[] {
  const policy = coordinator.delegationPolicy
  const selfId = coordinator._id.toString()

  const agentPool =
    policy === 'all'
      ? buildingAgents
      : policy === 'floor'
        ? floorAgents
        : policy === 'selected'
          ? buildingAgents.filter((a) => (coordinator.callableAgentIds ?? []).includes(a._id.toString()))
          : []

  const agentTargets: FloorTarget[] = agentPool
    .filter((a) => a._id.toString() !== selfId)
    .map((a) => {
      // The target's own incoming policy still applies: being reachable is a decision
      // on BOTH sides.
      const accepts = a.callerPolicy === 'all' || (a.callerPolicy === 'selected' && (a.allowedCallerAgentIds ?? []).includes(selfId)) || (a.callerPolicy === 'floor' && a.officeId?.toString() === coordinator.officeId?.toString())
      return {
        id: a._id.toString(),
        kind: 'agent' as const,
        name: a.name,
        competency: competencyOf(a),
        ready: accepts,
        ...(accepts ? {} : { blockedReason: 'este agente não aceita chamadas deste coordenador' }),
      }
    })

  const sectorPool =
    policy === 'all' || policy === 'floor'
      ? floorSectors
      : policy === 'selected'
        ? floorSectors.filter((s) => (coordinator.callableSectorIds ?? []).includes(s._id.toString()))
        : []

  const sectorTargets: FloorTarget[] = sectorPool.map((s) => {
    const mode = normalizeSectorMode(s.mode)
    // An organisational group does not execute, so it is never offered as a tool.
    const executable = mode !== 'organization'
    return {
      id: s._id.toString(),
      kind: 'sector' as const,
      name: s.name,
      competency: s.objective ?? '',
      mode,
      ready: executable,
      ...(executable ? {} : { blockedReason: 'este setor apenas agrupa agentes e não executa como unidade' }),
    }
  })

  return [...agentTargets, ...sectorTargets].sort((a, b) => a.name.localeCompare(b.name))
}

export async function floorWorkOverview(ownerId: string, floor: Floor): Promise<FloorWorkOverview> {
  const issues: FloorWorkOverview['issues'] = []

  if (floor.workMode === 'organization') {
    return {
      workMode: 'organization',
      instruction: floor.instruction,
      coordinator: null,
      targets: [],
      ready: true,
      issues: [],
      preview: null,
    }
  }

  const coordinatorDoc = floor.coordinatorAgentId
    ? await agents.findOne({ _id: floor.coordinatorAgentId, ownerId })
    : null
  const coordinator = coordinatorDoc ? withAgentDefaults(coordinatorDoc) : null

  // Removing, moving or archiving leaves the coordination NOT READY. A substitute is
  // never chosen automatically — that would silently change who speaks for the floor.
  if (!coordinator) {
    issues.push({ code: 'no_coordinator', message: 'O andar está coordenado, mas o agente coordenador não existe mais.', severity: 'blocking' })
  } else if (coordinator.officeId?.toString() !== floor._id.toString()) {
    issues.push({ code: 'coordinator_moved', message: `${coordinator.name} não está mais neste andar.`, severity: 'blocking' })
  }
  if (floor.status === 'archived') {
    issues.push({ code: 'floor_archived', message: 'Este andar está arquivado; a coordenação não roda.', severity: 'blocking' })
  }

  let targets: FloorTarget[] = []
  if (coordinator) {
    const [floorAgentDocs, buildingAgentDocs, floorSectorDocs] = await Promise.all([
      agents.find({ ownerId, officeId: floor._id }).toArray(),
      agents.find({ ownerId }).toArray(),
      sectors.find({ ownerId, officeId: floor._id }).toArray(),
    ])
    targets = effectiveTargets(
      coordinator,
      floorAgentDocs.map(withAgentDefaults),
      floorSectorDocs.map((s) => ({ _id: s._id, name: s.name, mode: s.mode, objective: s.objective, officeId: s.officeId })),
      buildingAgentDocs.map(withAgentDefaults),
    )

    if (coordinator.delegationPolicy === 'none') {
      issues.push({
        code: 'coordinator_cannot_delegate',
        message: `${coordinator.name} não pode chamar ninguém: ajuste a política de delegação dele.`,
        severity: 'blocking',
      })
    } else if (targets.filter((t) => t.ready).length === 0) {
      issues.push({
        code: 'no_targets',
        message: 'O coordenador não alcança nenhum agente ou setor executável.',
        severity: 'blocking',
      })
    }
  }

  const ready = issues.every((i) => i.severity !== 'blocking')
  return {
    workMode: floor.workMode,
    instruction: floor.instruction,
    coordinator: coordinator
      ? { id: coordinator._id.toString(), name: coordinator.name, objective: coordinator.objective, delegationPolicy: coordinator.delegationPolicy }
      : null,
    targets,
    ready,
    issues,
    preview: coordinator ? { from: coordinator.name, to: targets.filter((t) => t.ready).map((t) => t.name) } : null,
  }
}
