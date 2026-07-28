import { ObjectId } from 'mongodb'
import { db } from './db.js'

export interface TeamMember {
  agentId: ObjectId
  // Short "when to use this agent" hint the router reads to pick a specialist.
  routingDescription: string
  // The fallback specialist for ambiguous messages; also the source of
  // widget-level settings (first message, conversation persistence, limit).
  isDefault: boolean
}

export interface Team {
  _id: ObjectId
  ownerId: string
  name: string
  members: TeamMember[]
  createdAt: Date
}

const teams = db.collection<Team>('teams')

// Exactly one member must be the default. If none/many are flagged, pick the first.
function normalizeMembers(members: TeamMember[]): TeamMember[] {
  if (members.length === 0) return members
  const defaultIndex = members.findIndex((m) => m.isDefault)
  const chosen = defaultIndex >= 0 ? defaultIndex : 0
  return members.map((m, i) => ({ ...m, isDefault: i === chosen }))
}

export async function createTeam(ownerId: string, name: string, members: TeamMember[]) {
  const team: Omit<Team, '_id'> = {
    ownerId,
    name,
    members: normalizeMembers(members),
    createdAt: new Date(),
  }
  const result = await teams.insertOne(team as Team)
  return { ...team, _id: result.insertedId }
}

export function listTeams(ownerId: string) {
  return teams.find({ ownerId }).sort({ createdAt: -1 }).toArray()
}

export function getTeamById(ownerId: string, teamId: ObjectId) {
  return teams.findOne({ _id: teamId, ownerId })
}

export function updateTeam(
  ownerId: string,
  teamId: ObjectId,
  updates: { name?: string; members?: TeamMember[] },
) {
  const normalized = updates.members ? { ...updates, members: normalizeMembers(updates.members) } : updates
  return teams.findOneAndUpdate({ _id: teamId, ownerId }, { $set: normalized }, { returnDocument: 'after' })
}

export function deleteTeam(ownerId: string, teamId: ObjectId) {
  return teams.deleteOne({ _id: teamId, ownerId })
}
