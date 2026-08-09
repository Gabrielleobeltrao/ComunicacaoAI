import { ObjectId } from 'mongodb'
import { db } from './db.js'

// The Escritório: the top of the hierarchy (Escritório → Setores → Agentes).
// Every sector and agent belongs to exactly one office. For now each account has
// a single "Escritório principal" (created on demand / by the boot migration);
// the multi-office selector is a later phase.
export interface Office {
  _id: ObjectId
  ownerId: string
  name: string
  createdAt: Date
}

const offices = db.collection<Office>('offices')

export function listOffices(ownerId: string) {
  return offices.find({ ownerId }).sort({ createdAt: 1 }).toArray()
}

export function getOfficeById(ownerId: string, officeId: ObjectId) {
  return offices.findOne({ _id: officeId, ownerId })
}

export async function createOffice(ownerId: string, name: string) {
  const office: Omit<Office, '_id'> = { ownerId, name, createdAt: new Date() }
  const result = await offices.insertOne(office as Office)
  return { ...office, _id: result.insertedId }
}

// Every owner has at least one office. Returns the owner's first (default)
// office, creating "Escritório principal" if none exists yet. Idempotent.
export async function ensureDefaultOffice(ownerId: string): Promise<Office> {
  const existing = await offices.find({ ownerId }).sort({ createdAt: 1 }).limit(1).next()
  if (existing) return existing
  return createOffice(ownerId, 'Escritório principal')
}
