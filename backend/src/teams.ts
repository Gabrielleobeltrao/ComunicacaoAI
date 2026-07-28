import { ObjectId } from 'mongodb'
import { db } from './db.js'

// 'adaptive': a supervisor consults the right specialists per message.
// 'pipeline': an ordered flow — each member handles one stage and hands off to
// the next when its advance condition is met (member order = stage order).
export type TeamMode = 'adaptive' | 'pipeline'

// Pipeline only: a conditional jump from this stage to another one (identified
// by its agent). Lets a flow skip ahead, branch (A → B or C), or go back to an
// earlier stage when the topic changes — beyond the plain linear advance.
export interface TeamTransition {
  condition: string
  targetAgentId: ObjectId
}

export interface TeamMember {
  agentId: ObjectId
  // Adaptive: "when to use this agent" hint the supervisor reads. Pipeline:
  // what this stage does. Either way, a short description of the member's role.
  routingDescription: string
  // Pipeline only: the condition under which this stage is complete and the
  // flow should advance to the NEXT member (the simple linear case). Ignored
  // in adaptive mode.
  advanceWhen: string
  // Pipeline only: conditional jumps to non-adjacent stages (skip/branch/back).
  transitions: TeamTransition[]
  // The fallback specialist for ambiguous messages; also the source of
  // widget-level settings (first message, conversation persistence, limit).
  isDefault: boolean
}

export interface Team {
  _id: ObjectId
  ownerId: string
  name: string
  mode: TeamMode
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

export async function createTeam(ownerId: string, name: string, mode: TeamMode, members: TeamMember[]) {
  const team: Omit<Team, '_id'> = {
    ownerId,
    name,
    mode,
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
  updates: { name?: string; mode?: TeamMode; members?: TeamMember[] },
) {
  const normalized = updates.members ? { ...updates, members: normalizeMembers(updates.members) } : updates
  return teams.findOneAndUpdate({ _id: teamId, ownerId }, { $set: normalized }, { returnDocument: 'after' })
}

export function deleteTeam(ownerId: string, teamId: ObjectId) {
  return teams.deleteOne({ _id: teamId, ownerId })
}
