import { db } from './db.js'
import { ensureDefaultOffice } from './offices.js'
import { ensureBuildingIndexes, ensureDefaultBuilding } from './building.js'
import { ensureFloorIndexes } from './floors.js'
import { ensureAutomationIndexes } from './automations/repository.js'
import { ensureRunIndexes } from './automations/runRepository.js'
import { backfillSourceFingerprints, ensureSourceCheckpointIndexes } from './automations/sourceCheckpoint.js'
import { ensureMemoryIndexes } from './memory/records.js'
import { ensureConnectionIndexes } from './connections/repository.js'
import { ensureInstallationIndexes } from './apps/installations.js'
import { ensureNavigationIndexes } from './apps/navigation.js'
import { ensurePrivateAppIndexes } from './apps/privateApps.js'
import { ensureAgentLiveStateIndexes } from './agentLiveState.js'
import { ensurePlaygroundSessionIndexes } from './playgroundSession.js'
import { ensureSectorExecutionIndexes } from './sectorExecutions.js'
import { ensureExecutionRootIndexes } from './executionRoots.js'
import { backfillFloorCommunication } from './floorCommunication.js'
import { backfillManagedChannelInstallations } from './apps/channelApps.js'
import { ensureAppActionIndexes } from './apps/grants.js'
import { ensureEventIndexes } from './events/bus.js'
import { ensureStreamIndexes } from './streams/repository.js'
import { ensureCandleIndexes } from './marketData/candleStore.js'
import { ensureMarketStateIndexes } from './marketData/state.js'
import { ensureTickCollection } from './marketData/ticks.js'
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
  // O que cada rotina de monitoramento já viu.
  await ensureSourceCheckpointIndexes()
  await backfillCheckpointFingerprints()
  // A memória determinística: índices de consulta, a trava contra duplicata e o TTL.
  // Não há backfill — quem não tem registro não tem o que migrar, e definições sem
  // `executionMode` já são lidas como 'ai'.
  await ensureMemoryIndexes()
  await ensureConnectionIndexes()
  await ensureInstallationIndexes()
  await ensureNavigationIndexes()
  await ensurePrivateAppIndexes()
  await ensureAgentLiveStateIndexes()
  // A conversa de teste que sobrevive à troca de aba (e some sozinha em 30 dias).
  await ensurePlaygroundSessionIndexes()

  /**
   * Os sites cadastrados passam a ser lidos ANTES de o agente ser usado.
   *
   * O padrão de quando a função nasceu era `manual` — "nada acontece sozinho" —, e a
   * intenção era não consumir banda sem alguém pedir. O efeito prático foi outro: quem
   * cadastrava um site via o agente responder "não encontrei nada" para sempre, e clicava
   * em "Atualizar agora" sem entender por quê. Ninguém escolheu `manual`: foi o que
   * estava lá.
   *
   * `on_demand` não gasta nada em segundo plano: lê quando o agente é acionado, e só se o
   * que está guardado envelheceu. Quem quiser o comportamento anterior escolhe "Só quando
   * eu pedir" na tela — e a partir daí esta migração não o toca mais, porque ela só roda
   * uma vez por endereço (marcado em `refreshModeMigratedAt`).
   */
  await db.collection('agents').updateMany(
    { 'watchedSources.refreshMode': 'manual', 'watchedSources.refreshModeMigratedAt': { $exists: false } },
    { $set: { 'watchedSources.$[fonte].refreshMode': 'on_demand', 'watchedSources.$[fonte].refreshModeMigratedAt': new Date() } },
    { arrayFilters: [{ 'fonte.refreshMode': 'manual', 'fonte.refreshModeMigratedAt': { $exists: false } }] },
  )
  await ensureSectorExecutionIndexes()
  await ensureExecutionRootIndexes()

  // Existing sectors keep their CURRENT behaviour: open. Closing a core is a decision
  // the owner takes explicitly — guessing which pipelines "should" be closed would
  // silently break calls that work today. The recommendation to review shows up in
  // the UI, not here.
  await db
    .collection('sectors')
    .updateMany({ entryPolicy: { $exists: false } }, { $set: { entryPolicy: 'open_members', exposedAgentIds: [] } })

  // Installations of a managed-channel App that point at no real channel — including
  // the empty ones the generic form used to create — stop claiming to be connected.
  // Status only: no conversation, message, number or provider config is touched.
  const channelSync = await backfillManagedChannelInstallations()
  if (channelSync.revoked || channelSync.reconnected) console.log('[migrate] canais', JSON.stringify(channelSync))

  // Existing buildings keep collaborating exactly as they do today.
  await backfillFloorCommunication()
  await ensureAppActionIndexes()
  await ensureEventIndexes()
  await ensureStreamIndexes()
  await ensureCandleIndexes()
  await ensureMarketStateIndexes()
  await ensureTickCollection()

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

// Carimba a identidade da fonte nos checkpoints anteriores ao `sourceFingerprint`.
// A URL vem da própria definição publicada da automação — ela é a fonte de verdade,
// não há cópia em lugar nenhum.
async function backfillCheckpointFingerprints(): Promise<void> {
  const { findAutomation } = await import('./automations/repository.js')
  const { sourceFingerprint } = await import('./automations/sourceChange.js')
  const carimbados = await backfillSourceFingerprints(async (ownerId, automationId, stepId) => {
    const automation = await findAutomation(ownerId, automationId)
    const passo = automation?.draftDefinition?.steps?.find((s) => s.id === stepId)
    if (!passo || (passo.type !== 'source.rss' && passo.type !== 'source.http')) return null
    const url = typeof passo.config?.url === 'string' ? passo.config.url : ''
    return url ? sourceFingerprint(passo.type === 'source.rss' ? 'rss' : 'http', url) : null
  })
  if (carimbados) console.log(`[migrate] ${carimbados} checkpoint(s) de fonte receberam identidade`)
}
