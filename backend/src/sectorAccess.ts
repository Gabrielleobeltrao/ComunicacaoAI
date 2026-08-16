// Who may knock on a sector, and on whom.
//
// Without this, an outside agent could call a pipeline stage directly and walk into
// the middle of a flow — skipping the coordinator, the order and the contract the
// sector exists to enforce. The policy is a boundary, not a permission: it only ever
// REMOVES ways in; every other guard (owner, building, delegation policy, caller
// policy, depth, budget) still applies on top.
import { ObjectId } from 'mongodb'
import { db } from './db.js'
import { ValidationError } from './building.js'
import { normalizeSectorMode } from './sectors.js'
import type { Sector } from './sectors.js'

export type SectorEntryPolicy = 'sector_only' | 'selected_members' | 'open_members'
export const SECTOR_ENTRY_POLICIES: SectorEntryPolicy[] = ['sector_only', 'selected_members', 'open_members']

export const ENTRY_POLICY_LABEL: Record<SectorEntryPolicy, { title: string; help: string }> = {
  sector_only: {
    title: 'Sempre pelo setor (núcleo fechado)',
    help: 'Chamadas de fora enxergam e chamam somente o setor. Coordenador, membros e etapas não recebem chamada direta.',
  },
  selected_members: {
    title: 'Setor + agentes selecionados',
    help: 'O setor continua disponível e apenas os agentes que você escolher podem receber chamada direta.',
  },
  open_members: {
    title: 'Setor + qualquer agente',
    help: 'Comportamento flexível: qualquer agente do setor pode ser chamado direto, sujeito às permissões dele.',
  },
}

export interface SectorAccessConfig {
  entryPolicy: SectorEntryPolicy
  exposedAgentIds: ObjectId[]
}

// A sector written before this model keeps behaving exactly as it did.
export function accessConfigOf(sector: Pick<Sector, 'mode'> & { entryPolicy?: string; exposedAgentIds?: ObjectId[] }): SectorAccessConfig {
  const entryPolicy = SECTOR_ENTRY_POLICIES.includes(sector.entryPolicy as SectorEntryPolicy)
    ? (sector.entryPolicy as SectorEntryPolicy)
    : 'open_members'
  return { entryPolicy, exposedAgentIds: sector.exposedAgentIds ?? [] }
}

// Everyone the sector PROTECTS: members, the coordinator and every stage agent. Using
// `members` alone would leave a pipeline stage reachable from outside, which is the
// exact hole this policy exists to close.
export function protectedAgentIds(sector: Pick<Sector, 'members' | 'coordinatorAgentId' | 'stages'>): string[] {
  const ids = new Set<string>()
  for (const m of sector.members ?? []) ids.add(m.agentId.toString())
  if (sector.coordinatorAgentId) ids.add(sector.coordinatorAgentId.toString())
  for (const stage of sector.stages ?? []) if (stage.agentId) ids.add(stage.agentId.toString())
  return [...ids]
}

// The suggested default for a NEW sector. Existing ones are never changed silently.
export const suggestedEntryPolicy = (mode: string): SectorEntryPolicy =>
  normalizeSectorMode(mode) === 'organization' ? 'open_members' : 'sector_only'

export function validateAccessConfig(
  sector: Pick<Sector, 'mode' | 'members' | 'coordinatorAgentId' | 'stages'>,
  patch: { entryPolicy?: unknown; exposedAgentIds?: unknown },
  current: SectorAccessConfig,
): SectorAccessConfig {
  const entryPolicy = patch.entryPolicy === undefined ? current.entryPolicy : (patch.entryPolicy as SectorEntryPolicy)
  if (!SECTOR_ENTRY_POLICIES.includes(entryPolicy)) throw new ValidationError('política de entrada inválida')

  // A group that does not execute cannot be "the only way in": there is no sector
  // call to make.
  if (entryPolicy === 'sector_only' && normalizeSectorMode(sector.mode) === 'organization') {
    throw new ValidationError('um setor que apenas organiza não executa como unidade; escolha outra política de entrada')
  }

  let exposedAgentIds = current.exposedAgentIds
  if (patch.exposedAgentIds !== undefined) {
    if (!Array.isArray(patch.exposedAgentIds)) throw new ValidationError('exposedAgentIds deve ser uma lista')
    const known = new Set(protectedAgentIds(sector))
    exposedAgentIds = []
    for (const raw of patch.exposedAgentIds) {
      const id = String(raw ?? '')
      if (!ObjectId.isValid(id)) throw new ValidationError('agente exposto inválido')
      // Exposing someone who is not in the sector would be meaningless — and would
      // let a foreign id be written into the document.
      if (!known.has(id)) throw new ValidationError('só é possível expor agentes que participam deste setor')
      exposedAgentIds.push(new ObjectId(id))
    }
  }
  // The list only means something for `selected_members`; the others keep it stored
  // so switching back does not lose the choice.
  return { entryPolicy, exposedAgentIds }
}

export type EntryDecision = { ok: true } | { ok: false; code: 'sector_entry_required'; sectorId: string; sectorName: string; reason: string }

// The decision itself: may an OUTSIDE caller reach this agent directly?
//
// `internal` is the runtime calling a member during THAT sector's own execution —
// it carries the sector's execution grant. Merely being on the member list is NOT
// enough to claim internal context, or any caller could pretend to be one.
export function checkSectorEntry(
  sector: Pick<Sector, '_id' | 'name' | 'mode' | 'members' | 'coordinatorAgentId' | 'stages'> & { entryPolicy?: string; exposedAgentIds?: ObjectId[] },
  targetAgentId: string,
  opts: { internal?: boolean } = {},
): EntryDecision {
  if (opts.internal) return { ok: true }
  const config = accessConfigOf(sector)
  if (!protectedAgentIds(sector).includes(targetAgentId)) return { ok: true }

  if (config.entryPolicy === 'open_members') return { ok: true }
  if (config.entryPolicy === 'selected_members' && config.exposedAgentIds.some((id) => id.toString() === targetAgentId)) {
    return { ok: true }
  }
  return {
    ok: false,
    code: 'sector_entry_required',
    sectorId: sector._id.toString(),
    sectorName: sector.name,
    reason: `este agente participa do setor "${sector.name}", que só recebe chamadas pelo próprio setor`,
  }
}

export interface AccessImpact {
  entryPolicy: SectorEntryPolicy
  // Agents that would stop receiving direct calls under the policy being considered.
  protectedAgents: { id: string; name: string; exposed: boolean }[]
  // Who currently points at those agents and would be blocked.
  affectedCallers: { id: string; name: string; targets: string[] }[]
}

// What closing the core would really break, computed BEFORE saving.
export async function accessImpact(
  ownerId: string,
  sector: Pick<Sector, '_id' | 'name' | 'mode' | 'members' | 'coordinatorAgentId' | 'stages'> & { entryPolicy?: string; exposedAgentIds?: ObjectId[] },
  candidate?: { entryPolicy: SectorEntryPolicy; exposedAgentIds: ObjectId[] },
): Promise<AccessImpact> {
  const config = candidate ?? accessConfigOf(sector)
  const ids = protectedAgentIds(sector)
  const exposed = new Set(config.exposedAgentIds.map((id) => id.toString()))

  const agents = db.collection<{ _id: ObjectId; ownerId: string; name: string; delegationPolicy?: string; callableAgentIds?: string[] }>('agents')
  const [protectedDocs, callers] = await Promise.all([
    agents.find({ ownerId, _id: { $in: ids.map((id) => new ObjectId(id)) } }, { projection: { name: 1 } }).toArray(),
    agents.find({ ownerId, callableAgentIds: { $in: ids } }, { projection: { name: 1, callableAgentIds: 1 } }).toArray(),
  ])

  const nameById = new Map(protectedDocs.map((d) => [d._id.toString(), d.name]))
  const wouldBlock = (targetId: string) =>
    config.entryPolicy === 'sector_only' || (config.entryPolicy === 'selected_members' && !exposed.has(targetId))

  return {
    entryPolicy: config.entryPolicy,
    protectedAgents: ids.map((id) => ({ id, name: nameById.get(id) ?? 'Agente removido', exposed: exposed.has(id) })),
    affectedCallers: callers
      .filter((c) => !ids.includes(c._id.toString()))
      .map((c) => ({
        id: c._id.toString(),
        name: c.name,
        targets: (c.callableAgentIds ?? []).filter((t) => ids.includes(t) && wouldBlock(t)).map((t) => nameById.get(t) ?? 'Agente removido'),
      }))
      .filter((c) => c.targets.length > 0),
  }
}

// Does any sector of this owner refuse a direct call to this agent? A single query
// over the sectors that involve the agent — the answer names the sector to call
// instead, and never leaks anything else about it.
export async function sectorEntryDecisionFor(
  ownerId: string,
  targetAgentId: string,
): Promise<{ blocked: true; sectorId: string; sectorName: string; reason: string } | { blocked: false }> {
  if (!ObjectId.isValid(targetAgentId)) return { blocked: false }
  const agentId = new ObjectId(targetAgentId)
  const sectors = db.collection<Sector>('sectors')
  const candidates = await sectors
    .find({
      ownerId,
      entryPolicy: { $in: ['sector_only', 'selected_members'] },
      $or: [{ 'members.agentId': agentId }, { coordinatorAgentId: agentId }, { 'stages.agentId': agentId }],
    })
    .toArray()

  for (const sector of candidates) {
    const decision = checkSectorEntry(sector, targetAgentId)
    if (!decision.ok) return { blocked: true, sectorId: decision.sectorId, sectorName: decision.sectorName, reason: decision.reason }
  }
  return { blocked: false }
}
