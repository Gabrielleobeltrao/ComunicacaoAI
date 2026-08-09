import { db } from './db.js'
import { ensureDefaultOffice } from './offices.js'

// Backfills the office hierarchy onto pre-existing data: every owner that has
// agents or sectors without an officeId gets a default "Escritório principal",
// and those docs are attached to it. Idempotent — a no-op once backfilled.
export async function migrateOfficeHierarchy(): Promise<void> {
  const agentsCol = db.collection('agents')
  const teamsCol = db.collection('teams')

  const ownerIds = new Set<string>()
  for (const d of await agentsCol.find({ officeId: { $exists: false } }, { projection: { ownerId: 1 } }).toArray()) {
    if (typeof d.ownerId === 'string') ownerIds.add(d.ownerId)
  }
  for (const d of await teamsCol.find({ officeId: { $exists: false } }, { projection: { ownerId: 1 } }).toArray()) {
    if (typeof d.ownerId === 'string') ownerIds.add(d.ownerId)
  }

  for (const ownerId of ownerIds) {
    const office = await ensureDefaultOffice(ownerId)
    await agentsCol.updateMany({ ownerId, officeId: { $exists: false } }, { $set: { officeId: office._id } })
    await teamsCol.updateMany({ ownerId, officeId: { $exists: false } }, { $set: { officeId: office._id } })
  }
}
