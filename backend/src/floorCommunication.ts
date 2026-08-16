// Which floors may talk to which.
//
// This belongs to the BUILDING, because it describes the network between its areas.
// A link only opens the PATH: it never grants access to an agent or a sector, never
// adds a tool and never overrides `delegationPolicy`, `callerPolicy` or a sector's
// entry policy. It can only ever remove a way through.
import { ObjectId } from 'mongodb'
import { db } from './db.js'
import { ValidationError } from './building.js'

export type FloorCommunicationMode = 'isolated' | 'all' | 'selected'
export const FLOOR_COMMUNICATION_MODES: FloorCommunicationMode[] = ['isolated', 'all', 'selected']

export type FloorLinkDirection = 'one_way' | 'both'

export interface FloorLink {
  fromFloorId: ObjectId
  toFloorId: ObjectId
  direction: FloorLinkDirection
}

export interface FloorCommunicationConfig {
  mode: FloorCommunicationMode
  links: FloorLink[]
}

export const COMMUNICATION_LABEL: Record<FloorCommunicationMode, { title: string; help: string }> = {
  isolated: { title: 'Andares isolados', help: 'Nenhuma chamada cruza andares.' },
  all: { title: 'Todos colaboram', help: 'Qualquer andar ativo pode se comunicar, ainda sujeito às permissões de agentes e setores.' },
  selected: { title: 'Conexões escolhidas', help: 'Somente os caminhos que você criar permitem comunicação entre andares.' },
}

const buildings = db.collection<{ _id: ObjectId; ownerId: string; floorCommunication?: { mode?: string; links?: { fromFloorId: ObjectId; toFloorId: ObjectId; direction?: string }[] } }>('buildings')

// A building written before this model keeps its CURRENT behaviour, which was
// "everything can talk". The migration writes that explicitly; this read-side default
// covers anything it has not reached yet.
export function communicationConfigOf(building: { floorCommunication?: { mode?: string; links?: { fromFloorId: ObjectId; toFloorId: ObjectId; direction?: string }[] } }): FloorCommunicationConfig {
  const raw = building.floorCommunication
  const mode = FLOOR_COMMUNICATION_MODES.includes(raw?.mode as FloorCommunicationMode) ? (raw?.mode as FloorCommunicationMode) : 'all'
  return {
    mode,
    links: (raw?.links ?? []).map((l) => ({
      fromFloorId: l.fromFloorId,
      toFloorId: l.toFloorId,
      direction: l.direction === 'both' ? 'both' : 'one_way',
    })),
  }
}

// The decision. Same floor is always fine — this is only about CROSSING.
export function canCommunicate(config: FloorCommunicationConfig, fromFloorId: string | null, toFloorId: string | null): boolean {
  if (!fromFloorId || !toFloorId) return false
  if (fromFloorId === toFloorId) return true
  if (config.mode === 'isolated') return false
  if (config.mode === 'all') return true
  return config.links.some((link) => {
    const from = link.fromFloorId.toString()
    const to = link.toFloorId.toString()
    if (from === fromFloorId && to === toFloorId) return true
    // A one-way link is one way: A→B does not authorise B→A.
    return link.direction === 'both' && from === toFloorId && to === fromFloorId
  })
}

export async function getFloorCommunication(ownerId: string, buildingId: ObjectId): Promise<FloorCommunicationConfig> {
  const building = await buildings.findOne({ _id: buildingId, ownerId })
  return communicationConfigOf(building ?? {})
}

// Validated against THIS owner's floors, in THIS building: an id from anywhere else
// simply does not resolve, so a crafted body cannot open a path.
export async function setFloorCommunication(
  ownerId: string,
  buildingId: ObjectId,
  patch: { mode?: unknown; links?: unknown },
): Promise<FloorCommunicationConfig> {
  const current = await getFloorCommunication(ownerId, buildingId)
  const mode = patch.mode === undefined ? current.mode : (patch.mode as FloorCommunicationMode)
  if (!FLOOR_COMMUNICATION_MODES.includes(mode)) throw new ValidationError('modo de comunicação inválido')

  let links = current.links
  if (patch.links !== undefined) {
    if (!Array.isArray(patch.links)) throw new ValidationError('links deve ser uma lista')
    const floors = await db
      .collection('offices')
      .find({ ownerId }, { projection: { _id: 1 } })
      .toArray()
    const known = new Set(floors.map((f) => f._id.toString()))

    const seen = new Set<string>()
    links = []
    for (const raw of patch.links) {
      const entry = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
      const from = String(entry.fromFloorId ?? '')
      const to = String(entry.toFloorId ?? '')
      if (!known.has(from) || !known.has(to)) throw new ValidationError('link aponta para um andar que não existe neste prédio')
      if (from === to) throw new ValidationError('um andar não se conecta a si mesmo')
      const direction: FloorLinkDirection = entry.direction === 'both' ? 'both' : 'one_way'
      // A repeated pair is the same link, whichever direction was typed first.
      const key = direction === 'both' ? [from, to].sort().join('|') : `${from}>${to}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push({ fromFloorId: new ObjectId(from), toFloorId: new ObjectId(to), direction })
    }
  }

  const config: FloorCommunicationConfig = { mode, links }
  await buildings.updateOne({ _id: buildingId, ownerId }, { $set: { floorCommunication: config, updatedAt: new Date() } })
  return config
}

export interface CommunicationImpact {
  mode: FloorCommunicationMode
  // References that WOULD be blocked by the configuration being considered.
  blocked: { callerId: string; callerName: string; callerFloorId: string | null; targetName: string; targetFloorId: string | null }[]
}

// What a change would break, computed BEFORE saving.
export async function communicationImpact(ownerId: string, candidate: FloorCommunicationConfig): Promise<CommunicationImpact> {
  const agents = await db
    .collection<{ _id: ObjectId; name: string; officeId?: ObjectId; delegationPolicy?: string; callableAgentIds?: string[] }>('agents')
    .find({ ownerId }, { projection: { name: 1, officeId: 1, delegationPolicy: 1, callableAgentIds: 1 } })
    .toArray()
  const byId = new Map(agents.map((a) => [a._id.toString(), a]))

  const blocked: CommunicationImpact['blocked'] = []
  for (const caller of agents) {
    for (const targetId of caller.callableAgentIds ?? []) {
      const target = byId.get(targetId)
      if (!target) continue
      const from = caller.officeId?.toString() ?? null
      const to = target.officeId?.toString() ?? null
      if (from && to && from !== to && !canCommunicate(candidate, from, to)) {
        blocked.push({ callerId: caller._id.toString(), callerName: caller.name, callerFloorId: from, targetName: target.name, targetFloorId: to })
      }
    }
  }
  return { mode: candidate.mode, blocked }
}

// Existing buildings keep collaborating exactly as they do today; a building with a
// single floor has nothing to cross, so it starts isolated.
export async function backfillFloorCommunication(): Promise<number> {
  const docs = await buildings.find({ floorCommunication: { $exists: false } }).toArray()
  let touched = 0
  for (const building of docs) {
    const floorCount = await db.collection('offices').countDocuments({ ownerId: building.ownerId })
    const mode: FloorCommunicationMode = floorCount > 1 ? 'all' : 'isolated'
    await buildings.updateOne({ _id: building._id }, { $set: { floorCommunication: { mode, links: [] } } })
    touched++
  }
  return touched
}
