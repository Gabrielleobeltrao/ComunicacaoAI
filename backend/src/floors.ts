import { ObjectId } from 'mongodb'
import { db } from './db.js'
import type { ArchitectStamp } from './architectStamp.js'
import { ensureDefaultBuilding, isValidTimezone, LANGUAGES, ValidationError, DEFAULT_TIMEZONE } from './building.js'
import type { BuildingLanguage } from './building.js'

// A Floor (Andar) is a permanent work area with a mission. It is stored in the
// legacy `offices` collection so that floorId === officeId and existing agents /
// sectors (which reference officeId) keep working with no physical migration.
// The extra Floor fields are backfilled by the boot migration and defaulted on
// read here for any document that predates the backfill.
export type FloorStatus = 'active' | 'archived'

// How a floor works. A floor is an ORGANISATIONAL area — it never reasons and never
// executes; an agent always does. So there are exactly two modes and nothing else:
//   organization — free: agents and sectors keep working through their own channels,
//                  routines, triggers and calls.
//   coordinated  — one existing agent is the way in and decides which authorised
//                  agents or sectors to consult.
// No tool, App, trigger or permission list is copied onto the floor document:
// `coordinatorAgentId` only POINTS at an agent, and that agent's own delegation
// policy stays the source of truth for what it may call.
export type FloorWorkMode = 'organization' | 'coordinated'
export const FLOOR_WORK_MODES: FloorWorkMode[] = ['organization', 'coordinated']

export interface Floor {
  _id: ObjectId
  ownerId: string
  buildingId: ObjectId
  name: string
  mission: string
  description: string
  timezone: string
  defaultLanguage: BuildingLanguage
  color: string | null
  icon: string | null
  order: number
  status: FloorStatus
  workMode: FloorWorkMode
  coordinatorAgentId: ObjectId | null
  instruction: string
  createdAt: Date
  updatedAt: Date
}

// Raw shape as stored (legacy office docs may lack the Floor fields).
interface FloorDoc {
  _id: ObjectId
  ownerId: string
  name: string
  createdAt: Date
  /** A marca do Arquiteto, quando foi ele que criou. Ausente em tudo o mais. */
  architect?: ArchitectStamp
  buildingId?: ObjectId
  mission?: string
  description?: string
  timezone?: string
  defaultLanguage?: BuildingLanguage
  color?: string | null
  icon?: string | null
  order?: number
  status?: FloorStatus
  workMode?: FloorWorkMode
  coordinatorAgentId?: ObjectId | null
  instruction?: string
  updatedAt?: Date
}

const collection = db.collection<FloorDoc>('offices')

export async function ensureFloorIndexes(): Promise<void> {
  await collection.createIndex({ ownerId: 1, status: 1, order: 1 })
}

// Fill defaults for legacy docs so the API always returns a complete Floor.
function toFloor(doc: FloorDoc, buildingId: ObjectId): Floor {
  return {
    _id: doc._id,
    ownerId: doc.ownerId,
    buildingId: doc.buildingId ?? buildingId,
    name: doc.name,
    mission: doc.mission ?? '',
    description: doc.description ?? '',
    timezone: doc.timezone ?? DEFAULT_TIMEZONE,
    defaultLanguage: doc.defaultLanguage ?? 'pt',
    color: doc.color ?? null,
    icon: doc.icon ?? null,
    order: doc.order ?? 0,
    status: doc.status ?? 'active',
    // A floor written before this model is FREE, which is exactly how it behaved.
    workMode: FLOOR_WORK_MODES.includes(doc.workMode as FloorWorkMode) ? (doc.workMode as FloorWorkMode) : 'organization',
    coordinatorAgentId: doc.coordinatorAgentId ?? null,
    instruction: doc.instruction ?? '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt ?? doc.createdAt,
  }
}

export async function listFloors(ownerId: string, opts: { includeArchived?: boolean } = {}): Promise<Floor[]> {
  const building = await ensureDefaultBuilding(ownerId)
  const query: Record<string, unknown> = { ownerId }
  if (!opts.includeArchived) query.status = { $ne: 'archived' }
  const docs = await collection.find(query).sort({ order: 1, createdAt: 1 }).toArray()
  return docs.map((d) => toFloor(d, building._id))
}

export async function getFloor(ownerId: string, floorId: ObjectId): Promise<Floor | null> {
  const doc = await collection.findOne({ _id: floorId, ownerId })
  if (!doc) return null
  const building = await ensureDefaultBuilding(ownerId)
  return toFloor(doc, building._id)
}

export interface FloorInput {
  /** A marca do Arquiteto, quando foi ele que criou. Ver `architectStamp.ts`. */
  architect?: ArchitectStamp
  name: string
  mission?: string
  description?: string
  timezone?: string
  defaultLanguage?: BuildingLanguage
  color?: string | null
  icon?: string | null
}

function normalizeName(name: unknown): string {
  const s = String(name ?? '').trim()
  if (!s || s.length > 120) throw new ValidationError('invalid floor name')
  return s
}

export async function createFloor(ownerId: string, input: FloorInput): Promise<Floor> {
  const building = await ensureDefaultBuilding(ownerId)
  const name = normalizeName(input.name)
  const timezone = input.timezone ?? building.defaultTimezone
  if (!isValidTimezone(timezone)) throw new ValidationError('invalid timezone')
  const language = input.defaultLanguage ?? building.defaultLanguage
  if (!LANGUAGES.includes(language)) throw new ValidationError('invalid language')
  const last = await collection.find({ ownerId }).sort({ order: -1 }).limit(1).next()
  const now = new Date()
  const doc: FloorDoc = {
    _id: new ObjectId(),
    ownerId,
    name,
    buildingId: building._id,
    mission: String(input.mission ?? '').slice(0, 2000),
    description: String(input.description ?? '').slice(0, 4000),
    timezone,
    defaultLanguage: language,
    color: input.color ?? null,
    icon: input.icon ?? null,
    order: (last?.order ?? -1) + 1,
    status: 'active',
    workMode: 'organization',
    coordinatorAgentId: null,
    instruction: '',
    ...(input.architect ? { architect: input.architect } : {}),
    createdAt: now,
    updatedAt: now,
  }
  await collection.insertOne(doc)
  return toFloor(doc, building._id)
}

export interface FloorPatch {
  name?: string
  mission?: string
  description?: string
  timezone?: string
  defaultLanguage?: BuildingLanguage
  color?: string | null
  icon?: string | null
  order?: number
  workMode?: FloorWorkMode
  coordinatorAgentId?: string | null
  instruction?: string
}

// The floor's own configuration is validated ATOMICALLY: a coordinated floor without
// a coordinator would be a mode that cannot work, so it is refused rather than saved
// and then patched. The coordinator must be an agent of THIS floor, in this account.
export async function validateWorkConfig(
  ownerId: string,
  floorId: ObjectId,
  patch: Pick<FloorPatch, 'workMode' | 'coordinatorAgentId'>,
  current: Floor,
): Promise<{ workMode: FloorWorkMode; coordinatorAgentId: ObjectId | null }> {
  const workMode = patch.workMode ?? current.workMode
  if (!FLOOR_WORK_MODES.includes(workMode)) throw new ValidationError('modo de trabalho inválido')

  let coordinatorAgentId: ObjectId | null =
    patch.coordinatorAgentId === undefined ? current.coordinatorAgentId : patch.coordinatorAgentId === null ? null : null

  if (patch.coordinatorAgentId) {
    if (!ObjectId.isValid(patch.coordinatorAgentId)) throw new ValidationError('agente coordenador inválido')
    const candidate = new ObjectId(patch.coordinatorAgentId)
    // Owner AND floor are in the query: an agent from another account or another
    // floor simply is not found.
    const agent = await db.collection('agents').findOne({ _id: candidate, ownerId, officeId: floorId }, { projection: { _id: 1 } })
    if (!agent) throw new ValidationError('o coordenador precisa ser um agente deste andar')
    coordinatorAgentId = candidate
  }

  if (workMode === 'coordinated' && !coordinatorAgentId) {
    throw new ValidationError('escolha o agente que coordena este andar')
  }
  // Leaving coordinated mode does not delete the choice — it just stops being used.
  return { workMode, coordinatorAgentId }
}

export async function updateFloor(ownerId: string, floorId: ObjectId, patch: FloorPatch): Promise<Floor | null> {
  const set: Partial<FloorDoc> = { updatedAt: new Date() }
  if (patch.name !== undefined) set.name = normalizeName(patch.name)
  if (patch.mission !== undefined) set.mission = String(patch.mission).slice(0, 2000)
  if (patch.description !== undefined) set.description = String(patch.description).slice(0, 4000)
  if (patch.timezone !== undefined) {
    if (!isValidTimezone(patch.timezone)) throw new ValidationError('invalid timezone')
    set.timezone = patch.timezone
  }
  if (patch.defaultLanguage !== undefined) {
    if (!LANGUAGES.includes(patch.defaultLanguage)) throw new ValidationError('invalid language')
    set.defaultLanguage = patch.defaultLanguage
  }
  if (patch.color !== undefined) set.color = patch.color
  if (patch.icon !== undefined) set.icon = patch.icon
  if (patch.order !== undefined) {
    if (!Number.isFinite(patch.order)) throw new ValidationError('invalid order')
    set.order = Math.trunc(patch.order)
  }
  if (patch.instruction !== undefined) set.instruction = String(patch.instruction).slice(0, 4000)
  if (patch.workMode !== undefined || patch.coordinatorAgentId !== undefined) {
    const current = await getFloor(ownerId, floorId)
    if (!current) return null
    const resolved = await validateWorkConfig(ownerId, floorId, patch, current)
    set.workMode = resolved.workMode
    set.coordinatorAgentId = resolved.coordinatorAgentId
  }
  const result = await collection.updateOne({ _id: floorId, ownerId }, { $set: set })
  if (result.matchedCount === 0) return null
  return getFloor(ownerId, floorId)
}

export async function setFloorStatus(ownerId: string, floorId: ObjectId, status: FloorStatus): Promise<Floor | null> {
  const result = await collection.updateOne({ _id: floorId, ownerId }, { $set: { status, updatedAt: new Date() } })
  if (result.matchedCount === 0) return null
  return getFloor(ownerId, floorId)
}

export type DeleteFloorResult =
  | { ok: true }
  | { ok: false; code: 'LAST_FLOOR' }
  | { ok: false; code: 'FLOOR_NOT_EMPTY'; agentCount: number; sectorCount: number }

// Deleting a floor is refused while anything still lives on it (its agents and
// sectors reference officeId), and the last floor is never deletable. Returns
// null when the floor doesn't exist for this owner (→ 404). No physical
// migration — the office document is simply removed once it's empty.
export async function deleteFloor(ownerId: string, floorId: ObjectId): Promise<DeleteFloorResult | null> {
  const floor = await getFloor(ownerId, floorId)
  if (!floor) return null
  const totalFloors = await collection.countDocuments({ ownerId })
  if (totalFloors <= 1) return { ok: false, code: 'LAST_FLOOR' }
  const { agentCount, sectorCount } = await getFloorActivity(ownerId, floorId)
  if (agentCount > 0 || sectorCount > 0) return { ok: false, code: 'FLOOR_NOT_EMPTY', agentCount, sectorCount }
  await collection.deleteOne({ _id: floorId, ownerId })
  /**
   * A base do andar vai junto.
   *
   * Documento e chunk não guardam o id da conta — eles guardam o do dono. Um andar
   * apagado sem esta linha deixaria os dois apontando para um dono que não existe:
   * invisíveis em qualquer tela, contados na cota da conta para sempre, e ainda
   * alcançáveis pela busca vetorial, que filtra por `ownerId` e não pergunta se aquele
   * id ainda é de alguém.
   *
   * Import tardio de propósito: `knowledge.ts` puxa o cliente de embedding, e este
   * módulo é importado por caminhos que não precisam dele.
   */
  const { deleteAllForFloor } = await import('./knowledge.js')
  await deleteAllForFloor(floorId)
  return { ok: true }
}

// Lightweight activity summary for a floor. Run/automation counts arrive in later
// phases; for now it reports the structural occupancy (agents + sectors).
export async function getFloorActivity(ownerId: string, floorId: ObjectId): Promise<{
  agentCount: number
  sectorCount: number
}> {
  const [agentCount, sectorCount] = await Promise.all([
    db.collection('agents').countDocuments({ ownerId, officeId: floorId }),
    db.collection('sectors').countDocuments({ ownerId, officeId: floorId }),
  ])
  return { agentCount, sectorCount }
}
