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
import { checkCollaboration } from './collaborationGate.js'
import type { GateContext } from './collaborationGate.js'
import { DELEGATION_MAX_DEPTH } from './delegation.js'
import { getFloorCommunication } from './floorCommunication.js'
import type { FloorCommunicationConfig } from './floorCommunication.js'
import { ensureDefaultBuilding } from './building.js'
import { sectorEntryDecisionFor } from './sectorAccess.js'

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
// The SAME gate the runtime uses, asked with the same facts. Preview and execution
// therefore agree by construction — a coordinator is never shown a target that would
// be refused the moment it tried.
//
// A refused target is still LISTED, with the reason: hiding it from the owner
// configuring the floor would leave them guessing why someone is missing. Discovery
// offered to the MODEL is the one that hides them (see delegation.ts).
export function effectiveTargets(
  coordinator: Agent,
  floorAgents: Agent[],
  floorSectors: { _id: ObjectId; name: string; mode?: string; objective?: string; officeId: ObjectId }[],
  buildingAgents: Agent[],
  opts: { buildingId?: string; communication?: FloorCommunicationConfig; protectedBy?: Map<string, { sectorId: string; sectorName: string }> } = {},
): FloorTarget[] {
  const selfId = coordinator._id.toString()
  const buildingId = opts.buildingId ?? 'building'
  const communication = opts.communication ?? { mode: 'all', links: [] }
  const ctx: GateContext = {
    buildingId,
    callerAgentId: selfId,
    ancestry: [],
    depth: 0,
    maxDepth: DELEGATION_MAX_DEPTH,
    budget: { tokensSpent: 0, tokenLimit: Number.MAX_SAFE_INTEGER },
    sectorGrant: null,
  }

  const reasonFor = (decision: Exclude<ReturnType<typeof checkCollaboration>, { ok: true }>): string => {
    if (decision.code === 'sector_entry_required') return `este agente participa do setor "${decision.sectorName}", que só recebe chamadas pelo próprio setor`
    if (decision.code === 'cross_floor_blocked') return 'os andares deste prédio estão isolados'
    if (decision.code === 'floor_link_required') return 'não existe conexão deste andar para o andar do alvo'
    return decision.reason
  }

  // Candidates are everything on the floor plus, for a building-wide policy, the rest
  // of the building. The gate decides which of them are reachable.
  const agentCandidates = coordinator.delegationPolicy === 'all' || coordinator.delegationPolicy === 'selected' ? buildingAgents : floorAgents
  const agentTargets: FloorTarget[] = agentCandidates
    .filter((a) => a._id.toString() !== selfId)
    .map((a) => {
      const decision = checkCollaboration(
        coordinator,
        {
          kind: 'agent',
          id: a._id.toString(),
          ownerId: a.ownerId,
          buildingId,
          floorId: a.officeId ? a.officeId.toString() : null,
          callerPolicy: a.callerPolicy,
          allowedCallerAgentIds: a.allowedCallerAgentIds ?? [],
          protectedBy: opts.protectedBy?.get(a._id.toString()) ?? null,
        },
        communication,
        ctx,
      )
      return {
        id: a._id.toString(),
        kind: 'agent' as const,
        name: a.name,
        competency: competencyOf(a),
        ready: decision.ok,
        ...(decision.ok ? {} : { blockedReason: reasonFor(decision) }),
      }
    })
    // A target the caller's own policy never allowed is not "blocked", it is simply
    // not part of this arrangement — listing the whole building would be noise.
    .filter((t) => t.ready || coordinator.delegationPolicy !== 'selected')

  const sectorTargets: FloorTarget[] = floorSectors.map((s) => {
    const mode = normalizeSectorMode(s.mode)
    const decision = checkCollaboration(
      coordinator,
      {
        kind: 'sector',
        id: s._id.toString(),
        ownerId: coordinator.ownerId,
        buildingId,
        floorId: s.officeId ? s.officeId.toString() : null,
        executable: mode !== 'organization',
      },
      communication,
      ctx,
    )
    return {
      id: s._id.toString(),
      kind: 'sector' as const,
      name: s.name,
      competency: s.objective ?? '',
      mode,
      ready: decision.ok,
      ...(decision.ok
        ? {}
        : { blockedReason: mode === 'organization' ? 'este setor apenas agrupa agentes e não executa como unidade' : reasonFor(decision) }),
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
    // The same facts the runtime resolves, so the preview cannot be more optimistic
    // than the execution.
    const building = await ensureDefaultBuilding(ownerId)
    const communication = await getFloorCommunication(ownerId, building._id)
    const candidates = (coordinator.delegationPolicy === 'all' || coordinator.delegationPolicy === 'selected' ? buildingAgentDocs : floorAgentDocs).filter(
      (a) => a._id.toString() !== coordinator._id.toString(),
    )
    const protections = new Map<string, { sectorId: string; sectorName: string }>()
    for (const candidate of candidates) {
      const entry = await sectorEntryDecisionFor(ownerId, candidate._id.toString())
      if (entry.blocked) protections.set(candidate._id.toString(), { sectorId: entry.sectorId, sectorName: entry.sectorName })
    }

    targets = effectiveTargets(
      coordinator,
      floorAgentDocs.map(withAgentDefaults),
      floorSectorDocs.map((s) => ({ _id: s._id, name: s.name, mode: s.mode, objective: s.objective, officeId: s.officeId })),
      buildingAgentDocs.map(withAgentDefaults),
      { buildingId: building._id.toString(), communication, protectedBy: protections },
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
