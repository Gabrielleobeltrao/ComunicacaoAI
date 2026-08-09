import { db } from './db.js'
import { ensureDefaultOffice } from './offices.js'

async function renameCollectionIfNeeded(from: string, to: string): Promise<void> {
  const source = await db.listCollections({ name: from }).toArray()
  if (source.length === 0) return
  const target = await db.listCollections({ name: to }).toArray()
  if (target.length > 0) return
  await db.renameCollection(from, to)
}

// Idempotent boot migrations:
//  1) Team → Sector collection renames (a no-op once renamed).
//  2) Backfill the Escritório hierarchy (officeId) onto existing agents/sectors,
//     creating a default "Escritório principal" per owner as needed.
export async function runMigrations(): Promise<void> {
  await renameCollectionIfNeeded('teams', 'sectors')
  await renameCollectionIfNeeded('team_decisions', 'sector_decisions')

  // Team → Sector persisted field renames on existing docs (idempotent — only
  // touches docs that still carry the old field).
  await db.collection('widgets').updateMany({ teamId: { $exists: true } }, { $rename: { teamId: 'sectorId' } })
  await db.collection('sector_decisions').updateMany({ teamId: { $exists: true } }, { $rename: { teamId: 'sectorId' } })

  const agentsCol = db.collection('agents')
  const sectorsCol = db.collection('sectors')

  const ownerIds = new Set<string>()
  for (const d of await agentsCol.find({ officeId: { $exists: false } }, { projection: { ownerId: 1 } }).toArray()) {
    if (typeof d.ownerId === 'string') ownerIds.add(d.ownerId)
  }
  for (const d of await sectorsCol.find({ officeId: { $exists: false } }, { projection: { ownerId: 1 } }).toArray()) {
    if (typeof d.ownerId === 'string') ownerIds.add(d.ownerId)
  }

  for (const ownerId of ownerIds) {
    const office = await ensureDefaultOffice(ownerId)
    await agentsCol.updateMany({ ownerId, officeId: { $exists: false } }, { $set: { officeId: office._id } })
    await sectorsCol.updateMany({ ownerId, officeId: { $exists: false } }, { $set: { officeId: office._id } })
  }

  // Backfill a room colour on legacy sectors, cycling a palette per owner.
  const SECTOR_PALETTE = ['#2E5BFF', '#38B6F0', '#17B98A', '#FFB53D', '#8B5CF6', '#FF6A5B']
  const colorlessOwners = (await sectorsCol.distinct('ownerId', { color: { $exists: false } })) as string[]
  for (const ownerId of colorlessOwners) {
    const list = await sectorsCol.find({ ownerId, color: { $exists: false } }).sort({ createdAt: 1 }).toArray()
    for (let i = 0; i < list.length; i++) {
      await sectorsCol.updateOne({ _id: list[i]._id }, { $set: { color: SECTOR_PALETTE[i % SECTOR_PALETTE.length] } })
    }
  }
}
