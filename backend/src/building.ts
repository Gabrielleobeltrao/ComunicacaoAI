import { ObjectId } from 'mongodb'
import { db } from './db.js'

// A Building (Prédio) is the top-level workspace for an owner. Each owner has
// exactly one for now; the entity exists explicitly so the product isn't tied to
// the auth user and multi-building can arrive later without a data reshape.
export type BuildingLanguage = 'pt' | 'en' | 'es'

export interface Building {
  _id: ObjectId
  ownerId: string
  name: string
  description: string
  defaultTimezone: string
  defaultLanguage: BuildingLanguage
  createdAt: Date
  updatedAt: Date
}

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo'
export const LANGUAGES: readonly BuildingLanguage[] = ['pt', 'en', 'es']

const buildings = db.collection<Building>('buildings')

export async function ensureBuildingIndexes(): Promise<void> {
  // One building per owner in this phase; never codify a rule that blocks multi.
  await buildings.createIndex({ ownerId: 1 }, { unique: true })
}

export function getBuilding(ownerId: string): Promise<Building | null> {
  return buildings.findOne({ ownerId })
}

// Idempotent: returns the owner's building, creating a safe default if missing.
// Survives the unique-index race (two concurrent callers) by re-reading.
export async function ensureDefaultBuilding(ownerId: string): Promise<Building> {
  const existing = await buildings.findOne({ ownerId })
  if (existing) return existing
  const now = new Date()
  const doc: Omit<Building, '_id'> = {
    ownerId,
    name: 'Meu prédio',
    description: '',
    defaultTimezone: DEFAULT_TIMEZONE,
    defaultLanguage: 'pt',
    createdAt: now,
    updatedAt: now,
  }
  try {
    const res = await buildings.insertOne(doc as Building)
    return { ...doc, _id: res.insertedId }
  } catch {
    const again = await buildings.findOne({ ownerId })
    if (again) return again
    throw new Error('ensureDefaultBuilding failed')
  }
}

// Valid IANA timezone check via Intl (throws on unknown zone).
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export interface BuildingPatch {
  name?: string
  description?: string
  defaultTimezone?: string
  defaultLanguage?: BuildingLanguage
}

export async function updateBuilding(ownerId: string, patch: BuildingPatch): Promise<Building> {
  const building = await ensureDefaultBuilding(ownerId)
  const set: Partial<Building> = { updatedAt: new Date() }
  if (patch.name !== undefined) {
    const name = String(patch.name).trim()
    if (!name || name.length > 120) throw new ValidationError('invalid building name')
    set.name = name
  }
  if (patch.description !== undefined) set.description = String(patch.description).slice(0, 2000)
  if (patch.defaultTimezone !== undefined) {
    if (!isValidTimezone(patch.defaultTimezone)) throw new ValidationError('invalid timezone')
    set.defaultTimezone = patch.defaultTimezone
  }
  if (patch.defaultLanguage !== undefined) {
    if (!LANGUAGES.includes(patch.defaultLanguage)) throw new ValidationError('invalid language')
    set.defaultLanguage = patch.defaultLanguage
  }
  await buildings.updateOne({ _id: building._id }, { $set: set })
  return { ...building, ...set }
}

// Thrown for client-supplied input errors → mapped to HTTP 400 by routes.
export class ValidationError extends Error {}
