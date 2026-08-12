import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import type { Connection, Delivery } from './types.js'

const connections = db.collection<Connection>('connections')
const deliveries = db.collection<Delivery>('deliveries')

export async function ensureConnectionIndexes(): Promise<void> {
  await connections.createIndex({ ownerId: 1, provider: 1 })
  await deliveries.createIndex({ ownerId: 1, idempotencyKey: 1 }, { unique: true })
  await deliveries.createIndex({ runId: 1 })
}

export function insertConnection(doc: Connection): Promise<unknown> {
  return connections.insertOne(doc)
}
export function findConnection(ownerId: string, id: ObjectId): Promise<Connection | null> {
  return connections.findOne({ _id: id, ownerId })
}
export function listConnections(ownerId: string): Promise<Connection[]> {
  return connections.find({ ownerId }).sort({ createdAt: -1 }).toArray()
}
export async function updateConnection(ownerId: string, id: ObjectId, set: Partial<Connection>): Promise<Connection | null> {
  const r = await connections.findOneAndUpdate(
    { _id: id, ownerId },
    { $set: { ...set, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  return r ?? null
}
export async function deleteConnection(ownerId: string, id: ObjectId): Promise<boolean> {
  const r = await connections.deleteOne({ _id: id, ownerId })
  return r.deletedCount === 1
}

// Insert a delivery idempotently: a duplicate (ownerId, idempotencyKey) returns
// the existing record so a step retry never sends twice.
export async function insertDeliveryIdempotent(doc: Delivery): Promise<{ delivery: Delivery; created: boolean }> {
  try {
    await deliveries.insertOne(doc)
    return { delivery: doc, created: true }
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const existing = await deliveries.findOne({ ownerId: doc.ownerId, idempotencyKey: doc.idempotencyKey })
      if (existing) return { delivery: existing, created: false }
    }
    throw error
  }
}
export async function updateDelivery(id: ObjectId, set: Partial<Delivery>): Promise<void> {
  await deliveries.updateOne({ _id: id }, { $set: set })
}
export function listDeliveries(ownerId: string, runId: ObjectId): Promise<Delivery[]> {
  return deliveries.find({ ownerId, runId }).sort({ createdAt: 1 }).toArray()
}
