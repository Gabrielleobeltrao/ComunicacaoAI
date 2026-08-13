import { ObjectId } from 'mongodb'
import type { WithId } from 'mongodb'
import { db } from './db.js'
import { getAgentById } from './agents.js'
import { MAX_SECTOR_MEMBERS, normalizeMembers } from './sectors.js'
import type { Sector, SectorMember, SectorMode } from './sectors.js'

// Single place for agent↔sector association (plan §9.1): validates ownership +
// same-floor, keeps one sector per agent, normalizes the default, and compensates
// a partial failure so an agent is never left in two sectors.
const sectors = db.collection<Sector>('sectors')

export interface AssignResult {
  floorId: string | null
  previousSector: { id: string; name: string } | null
  currentSector: { id: string; name: string; mode: SectorMode } | null
  needsConfiguration: boolean
}
export type MembershipFail = { ok: false; error: string; code: string; status: number }
export type AssignOutcome = { ok: true; result: AssignResult } | MembershipFail

// The (single) sector currently containing the agent, if any.
function sectorOfAgent(ownerId: string, agentId: ObjectId): Promise<WithId<Sector> | null> {
  return sectors.findOne({ ownerId, 'members.agentId': agentId })
}

export async function assignAgentToSector(ownerId: string, agentIdRaw: string, targetSectorIdRaw: string | null): Promise<AssignOutcome> {
  if (!ObjectId.isValid(agentIdRaw)) return { ok: false, error: 'Invalid agent id', code: 'INVALID_ID', status: 400 }
  const agentId = new ObjectId(agentIdRaw)
  const agent = await getAgentById(ownerId, agentId)
  if (!agent) return { ok: false, error: 'Agent not found', code: 'AGENT_NOT_FOUND', status: 404 }
  const floorId = agent.officeId?.toString() ?? null

  const current = await sectorOfAgent(ownerId, agentId)

  // Remove from any sector.
  if (targetSectorIdRaw === null) {
    if (!current) return { ok: true, result: { floorId, previousSector: null, currentSector: null, needsConfiguration: false } }
    const remaining = normalizeMembers(current.members.filter((m) => !m.agentId.equals(agentId)))
    await sectors.updateOne({ _id: current._id }, { $set: { members: remaining, updatedAt: new Date() } })
    return { ok: true, result: { floorId, previousSector: { id: current._id.toString(), name: current.name }, currentSector: null, needsConfiguration: false } }
  }

  // Assign to a sector on the SAME floor.
  if (!ObjectId.isValid(targetSectorIdRaw)) return { ok: false, error: 'Invalid sector id', code: 'INVALID_ID', status: 400 }
  const targetId = new ObjectId(targetSectorIdRaw)
  const target = await sectors.findOne({ _id: targetId, ownerId })
  if (!target) return { ok: false, error: 'Sector not found', code: 'SECTOR_NOT_FOUND', status: 404 }
  if (!agent.officeId || !agent.officeId.equals(target.officeId)) {
    return { ok: false, error: 'Agent belongs to a different floor', code: 'CROSS_FLOOR_ASSIGNMENT', status: 409 }
  }

  const prev = current && !current._id.equals(targetId) ? { id: current._id, name: current.name, members: current.members } : null

  // Already a member → idempotent no-op (but still report the pipeline hint).
  if (target.members.some((m) => m.agentId.equals(agentId))) {
    return { ok: true, result: { floorId, previousSector: prev ? { id: prev.id.toString(), name: prev.name } : null, currentSector: { id: target._id.toString(), name: target.name, mode: target.mode }, needsConfiguration: target.mode === 'pipeline' } }
  }
  if (target.members.length >= MAX_SECTOR_MEMBERS) return { ok: false, error: `A sector can have at most ${MAX_SECTOR_MEMBERS} agents`, code: 'SECTOR_MEMBER_LIMIT', status: 409 }

  // Append (pipeline → last stage), then pull from the previous sector. If the
  // second write fails, undo the first so we never leave a duplicate membership.
  const newMember: SectorMember = { agentId, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: target.members.length === 0 }
  const targetMembers = normalizeMembers([...target.members, newMember])
  await sectors.updateOne({ _id: targetId }, { $set: { members: targetMembers, updatedAt: new Date() } })
  try {
    if (prev) {
      const remaining = normalizeMembers(prev.members.filter((m) => !m.agentId.equals(agentId)))
      await sectors.updateOne({ _id: prev.id }, { $set: { members: remaining, updatedAt: new Date() } })
    }
  } catch (err) {
    await sectors.updateOne({ _id: targetId }, { $set: { members: target.members, updatedAt: new Date() } })
    throw err
  }

  return {
    ok: true,
    result: {
      floorId,
      previousSector: prev ? { id: prev.id.toString(), name: prev.name } : null,
      currentSector: { id: target._id.toString(), name: target.name, mode: target.mode },
      needsConfiguration: target.mode === 'pipeline',
    },
  }
}
