import { ObjectId } from 'mongodb'
import { db } from './db.js'

// 'adaptive': a supervisor consults the right specialists per message.
// 'pipeline': an ordered flow — each member handles one stage and hands off to
// the next when its advance condition is met (member order = stage order).
export type SectorMode = 'adaptive' | 'pipeline'

// Pipeline only: a conditional jump from this stage to another one (identified
// by its agent). Lets a flow skip ahead, branch (A → B or C), or go back to an
// earlier stage when the topic changes — beyond the plain linear advance.
export interface SectorTransition {
  condition: string
  targetAgentId: ObjectId
}

export interface SectorMember {
  agentId: ObjectId
  // Optional department/sector label (e.g. Suporte, Vendas) used to group
  // members in the UI and to help the adaptive supervisor route. Empty = none.
  sector: string
  // Adaptive: "when to use this agent" hint the supervisor reads. Pipeline:
  // what this stage does. Either way, a short description of the member's role.
  routingDescription: string
  // Pipeline only: the condition under which this stage is complete and the
  // flow should advance to the NEXT member (the simple linear case). Ignored
  // in adaptive mode.
  advanceWhen: string
  // Pipeline only: conditional jumps to non-adjacent stages (skip/branch/back).
  transitions: SectorTransition[]
  // The fallback specialist for ambiguous messages; also the source of
  // widget-level settings (first message, conversation persistence, limit).
  isDefault: boolean
}

export interface Sector {
  _id: ObjectId
  ownerId: string
  // The Escritório this sector belongs to. Required — a sector is never an
  // orphan (unlike agents, which may have no sector).
  officeId: ObjectId
  name: string
  mode: SectorMode
  members: SectorMember[]
  createdAt: Date
}

const sectors = db.collection<Sector>('sectors')

// Exactly one member must be the default. If none/many are flagged, pick the first.
function normalizeMembers(members: SectorMember[]): SectorMember[] {
  if (members.length === 0) return members
  const defaultIndex = members.findIndex((m) => m.isDefault)
  const chosen = defaultIndex >= 0 ? defaultIndex : 0
  return members.map((m, i) => ({ ...m, isDefault: i === chosen }))
}

export async function createSector(
  ownerId: string,
  officeId: ObjectId,
  name: string,
  mode: SectorMode,
  members: SectorMember[],
) {
  const sector: Omit<Sector, '_id'> = {
    ownerId,
    officeId,
    name,
    mode,
    members: normalizeMembers(members),
    createdAt: new Date(),
  }
  const result = await sectors.insertOne(sector as Sector)
  return { ...sector, _id: result.insertedId }
}

export function listSectors(ownerId: string) {
  return sectors.find({ ownerId }).sort({ createdAt: -1 }).toArray()
}

export function getSectorById(ownerId: string, sectorId: ObjectId) {
  return sectors.findOne({ _id: sectorId, ownerId })
}

export function updateSector(
  ownerId: string,
  sectorId: ObjectId,
  updates: { name?: string; mode?: SectorMode; members?: SectorMember[] },
) {
  const normalized = updates.members ? { ...updates, members: normalizeMembers(updates.members) } : updates
  return sectors.findOneAndUpdate({ _id: sectorId, ownerId }, { $set: normalized }, { returnDocument: 'after' })
}

export function deleteSector(ownerId: string, sectorId: ObjectId) {
  return sectors.deleteOne({ _id: sectorId, ownerId })
}

// An agent belongs to at most one sector (parent-child). After adding agents to
// `keepTeamId`, remove them from every OTHER sector of the same owner, so moving
// an agent into a sector transfers it out of its previous one. Affected sectors
// are re-normalized (a pulled member could have been the default).
export async function enforceSingleMembership(ownerId: string, keepTeamId: ObjectId, agentIds: ObjectId[]) {
  if (agentIds.length === 0) return
  const affected = await sectors
    .find({ ownerId, _id: { $ne: keepTeamId }, 'members.agentId': { $in: agentIds } })
    .toArray()
  for (const t of affected) {
    const remaining = t.members.filter((m) => !agentIds.some((id) => id.equals(m.agentId)))
    await sectors.updateOne({ _id: t._id }, { $set: { members: normalizeMembers(remaining) } })
  }
}
