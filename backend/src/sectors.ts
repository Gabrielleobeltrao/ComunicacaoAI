import { ObjectId } from 'mongodb'
import { db } from './db.js'

// A sector is a TEAM (never a schedule). Its mode says how the team works:
//   'organization' — only groups agents on the map; not executable as a unit.
//   'orchestrated' — a coordinator receives the request, delegates to members and
//                    consolidates the answer (this is the old 'adaptive').
//   'pipeline'     — ordered stages, each an agent, chaining outputs to inputs.
export type SectorMode = 'organization' | 'orchestrated' | 'pipeline'
export const SECTOR_MODES: SectorMode[] = ['organization', 'orchestrated', 'pipeline']

// Legacy documents used 'adaptive'; read it as 'orchestrated' without rewriting.
// Anything unknown falls back to 'orchestrated' (the historical executable default).
export function normalizeSectorMode(mode: unknown): SectorMode {
  if (mode === 'organization' || mode === 'orchestrated' || mode === 'pipeline') return mode
  return 'orchestrated' // covers legacy 'adaptive' and missing/unknown values
}

// Only orchestrated/pipeline sectors can actually run; an organization sector is a
// visual grouping and is refused by delegate_to_sector.
export function sectorIsExecutable(mode: SectorMode): boolean {
  return mode === 'orchestrated' || mode === 'pipeline'
}

// Pipeline only: a conditional jump from this stage to another one (identified
// by its agent). Lets a flow skip ahead, branch (A → B or C), or go back to an
// earlier stage when the topic changes — beyond the plain linear advance.
export interface SectorTransition {
  condition: string
  targetAgentId: ObjectId
}

// Pipeline execution stage — the REAL, deterministic flow (replaces the
// conversational advanceWhen/transitions for the task path). Ordered by array
// position; `dependsOn` chains a stage's input to earlier stages' outputs.
export interface SectorStage {
  id: string
  name: string
  agentId: ObjectId
  instruction: string
  dependsOn: string[] // stage ids whose outputs feed this one ([] = the sector input)
  inputMapping: Record<string, string> // optional named-var mapping (kept simple)
  expectedOutput: string
  retryPolicy: { maxAttempts: number; backoffMs: number }
  onError: 'stop' | 'continue'
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
  // The room's base colour on the office map (a CSS colour / hex).
  color: string
  mode: SectorMode
  members: SectorMember[]
  // Orchestrated mode (all additive; absent on legacy/other modes):
  coordinatorAgentId?: ObjectId // the agent that receives, delegates and consolidates
  instruction?: string // how the coordinator should run the team
  inputContract?: string // what the team expects to receive
  outputContract?: string // what the team must produce
  // Pipeline mode: the ordered execution stages (replaces advanceWhen/transitions).
  stages?: SectorStage[]
  createdAt: Date
  // Set on new writes/edits. Additive — old documents may lack it until edited.
  updatedAt?: Date
}

const sectors = db.collection<Sector>('sectors')

export const MAX_SECTOR_MEMBERS = 10

// Operational readiness derived from mode + shape:
//   organization — ready as soon as it has at least one member (just a grouping).
//   orchestrated — needs a coordinator and at least one member.
//   pipeline     — needs at least one stage (each stage carries its own agent).
export function sectorReadiness(
  mode: SectorMode,
  members: SectorMember[],
  extra?: { coordinatorAgentId?: ObjectId | null; stages?: SectorStage[] },
): 'ready' | 'incomplete' {
  if (mode === 'organization') return members.length >= 1 ? 'ready' : 'incomplete'
  if (mode === 'pipeline') return (extra?.stages?.length ?? 0) >= 1 ? 'ready' : 'incomplete'
  // orchestrated
  return extra?.coordinatorAgentId && members.length >= 1 ? 'ready' : 'incomplete'
}

// Assign stable ids to stages that lack one and clamp the retry policy.
export function normalizeStages(stages: SectorStage[]): SectorStage[] {
  return stages.map((s, i) => ({
    ...s,
    id: s.id && s.id.trim() ? s.id : `s${i + 1}`,
    retryPolicy: { maxAttempts: Math.max(1, Math.min(s.retryPolicy?.maxAttempts ?? 1, 5)), backoffMs: s.retryPolicy?.backoffMs ?? 2000 },
    onError: s.onError === 'continue' ? 'continue' : 'stop',
  }))
}

// Exactly one member must be the default. If none/many are flagged, pick the first.
export function normalizeMembers(members: SectorMember[]): SectorMember[] {
  if (members.length === 0) return members
  const defaultIndex = members.findIndex((m) => m.isDefault)
  const chosen = defaultIndex >= 0 ? defaultIndex : 0
  return members.map((m, i) => ({ ...m, isDefault: i === chosen }))
}

export interface SectorTeamFields {
  coordinatorAgentId?: ObjectId | null
  instruction?: string
  inputContract?: string
  outputContract?: string
  stages?: SectorStage[]
}

export async function createSector(
  ownerId: string,
  officeId: ObjectId,
  name: string,
  color: string,
  mode: SectorMode,
  members: SectorMember[],
  extra: SectorTeamFields = {},
) {
  const now = new Date()
  const sector: Omit<Sector, '_id'> = {
    ownerId,
    officeId,
    name,
    color,
    mode,
    members: normalizeMembers(members),
    ...(extra.coordinatorAgentId ? { coordinatorAgentId: extra.coordinatorAgentId } : {}),
    ...(extra.instruction !== undefined ? { instruction: extra.instruction } : {}),
    ...(extra.inputContract !== undefined ? { inputContract: extra.inputContract } : {}),
    ...(extra.outputContract !== undefined ? { outputContract: extra.outputContract } : {}),
    ...(extra.stages ? { stages: normalizeStages(extra.stages) } : {}),
    createdAt: now,
    updatedAt: now,
  }
  const result = await sectors.insertOne(sector as Sector)
  return { ...sector, _id: result.insertedId }
}

export function listSectors(ownerId: string, floorId?: ObjectId) {
  const filter: Record<string, unknown> = { ownerId }
  if (floorId) filter.officeId = floorId
  return sectors.find(filter).sort({ createdAt: -1 }).toArray()
}

export function getSectorById(ownerId: string, sectorId: ObjectId) {
  return sectors.findOne({ _id: sectorId, ownerId })
}

// Resolve a raw sector id INSIDE an account. Returns null both when the id is
// malformed and when it belongs to someone else — callers must not distinguish the
// two, so an id is never confirmed to exist across tenants. This is the only way a
// sectorId may enter an execution.
export async function resolveOwnedSectorId(ownerId: string, raw: unknown): Promise<ObjectId | null> {
  if (typeof raw !== 'string' || !ObjectId.isValid(raw)) return null
  const sector = await sectors.findOne({ _id: new ObjectId(raw), ownerId }, { projection: { _id: 1 } })
  return sector ? sector._id : null
}

export function updateSector(
  ownerId: string,
  sectorId: ObjectId,
  updates: {
    name?: string
    color?: string
    mode?: SectorMode
    members?: SectorMember[]
    officeId?: ObjectId
    coordinatorAgentId?: ObjectId | null
    instruction?: string
    inputContract?: string
    outputContract?: string
    stages?: SectorStage[]
  },
) {
  const base: Record<string, unknown> = { ...updates }
  if (updates.members) base.members = normalizeMembers(updates.members)
  if (updates.stages) base.stages = normalizeStages(updates.stages)
  // A null coordinator means "clear it" — $unset rather than storing null.
  const unset = base.coordinatorAgentId === null ? { coordinatorAgentId: '' } : undefined
  if (unset) delete base.coordinatorAgentId
  const update: Record<string, unknown> = { $set: { ...base, updatedAt: new Date() } }
  if (unset) update.$unset = unset
  return sectors.findOneAndUpdate({ _id: sectorId, ownerId }, update, { returnDocument: 'after' })
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
