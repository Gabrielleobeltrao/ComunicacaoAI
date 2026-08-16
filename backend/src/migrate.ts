import { db } from './db.js'
import { ensureDefaultOffice } from './offices.js'
import { ensureBuildingIndexes, ensureDefaultBuilding } from './building.js'
import { ensureFloorIndexes } from './floors.js'
import { ensureAutomationIndexes } from './automations/repository.js'
import { ensureRunIndexes } from './automations/runRepository.js'
import { ensureConnectionIndexes } from './connections/repository.js'
import { ensureInstallationIndexes } from './apps/installations.js'
import { ensureNavigationIndexes } from './apps/navigation.js'
import { ensureAgentLiveStateIndexes } from './agentLiveState.js'
import { ensureAppActionIndexes } from './apps/grants.js'
import { migrateAppsAndInstallations } from './apps/migration.js'

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

  await backfillBuildingsAndFloors()
  await ensureAutomationIndexes()
  await ensureRunIndexes()
  await ensureConnectionIndexes()
  await ensureInstallationIndexes()
  await ensureNavigationIndexes()
  await ensureAgentLiveStateIndexes()
  await ensureAppActionIndexes()

  // Apps: connections learn their appKey, Google gains an installation, and every
  // credential still sitting in an agent document moves into an encrypted one.
  const apps = await migrateAppsAndInstallations()
  if (apps.installationsCreated || apps.agentsMigrated || apps.googleInstallations || apps.connectionsBackfilled) {
    // Counts only — never a value.
    console.log('[migrate] apps', JSON.stringify(apps))
  }
}

// AI-building pivot backfill (idempotent, additive). Ensures a Building per owner
// and evolves each Office document into a Floor-shaped one. Never touches _id, so
// existing agents/sectors (which reference officeId) keep working unchanged.
// Each field is guarded by $exists:false, so a re-run produces zero changes.
async function backfillBuildingsAndFloors(): Promise<void> {
  await ensureBuildingIndexes()
  await ensureFloorIndexes()

  const officesCol = db.collection('offices')
  const officeOwners = (await officesCol.distinct('ownerId')) as string[]

  for (const ownerId of officeOwners) {
    const building = await ensureDefaultBuilding(ownerId)
    await officesCol.updateMany({ ownerId, buildingId: { $exists: false } }, { $set: { buildingId: building._id } })
    await officesCol.updateMany({ ownerId, mission: { $exists: false } }, { $set: { mission: '' } })
    await officesCol.updateMany({ ownerId, description: { $exists: false } }, { $set: { description: '' } })
    await officesCol.updateMany({ ownerId, timezone: { $exists: false } }, { $set: { timezone: building.defaultTimezone } })
    await officesCol.updateMany({ ownerId, defaultLanguage: { $exists: false } }, { $set: { defaultLanguage: building.defaultLanguage } })
    await officesCol.updateMany({ ownerId, color: { $exists: false } }, { $set: { color: null } })
    await officesCol.updateMany({ ownerId, icon: { $exists: false } }, { $set: { icon: null } })
    await officesCol.updateMany({ ownerId, status: { $exists: false } }, { $set: { status: 'active' } })

    // Stable order for docs that don't have one yet, continuing past any already set.
    const needOrder = await officesCol.find({ ownerId, order: { $exists: false } }).sort({ createdAt: 1 }).toArray()
    if (needOrder.length) {
      const maxOrdered = await officesCol.find({ ownerId, order: { $exists: true } }).sort({ order: -1 }).limit(1).next()
      let next = ((maxOrdered?.order as number | undefined) ?? -1) + 1
      for (const doc of needOrder) {
        await officesCol.updateOne(
          { _id: doc._id },
          { $set: { order: next, updatedAt: (doc.updatedAt as Date) ?? (doc.createdAt as Date) ?? new Date() } },
        )
        next++
      }
    }
    // Any remaining docs without updatedAt inherit createdAt.
    await officesCol.updateMany({ ownerId, updatedAt: { $exists: false } }, [{ $set: { updatedAt: '$createdAt' } }])
  }
}
