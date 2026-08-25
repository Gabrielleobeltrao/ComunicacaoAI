import { listFloors } from '../floors.js'
import { listAgents } from '../agents.js'
import { listSectors } from '../sectors.js'
import { listAppsForOwner } from '../apps/privateApps.js'
import { listInstallations } from '../apps/installations.js'
import { isUsableApp } from '../apps/types.js'
import { emptyOwnershipContext } from './validate.js'
import type { BlueprintOwnershipContext } from './validate.js'

// O que esta conta REALMENTE tem — lido do banco, em um lugar só.
//
// O validador é puro e recebe isto pronto. A consequência é a que interessa: não
// existe caminho em que a validação consulte o banco sem `ownerId`, porque ela não
// consulta o banco.

export interface ArchitectAppInfo {
  key: string
  name: string
  connected: boolean
}

export async function loadOwnershipContext(ownerId: string): Promise<BlueprintOwnershipContext> {
  const ctx = emptyOwnershipContext()
  const [floors, agents, sectors, apps, installations] = await Promise.all([
    listFloors(ownerId, { includeArchived: true }),
    listAgents(ownerId),
    listSectors(ownerId),
    listAppsForOwner(ownerId),
    listInstallations(ownerId),
  ])
  for (const f of floors) ctx.floorIds.add(f._id.toString())
  for (const a of agents) ctx.agentIds.add(a._id.toString())
  for (const s of sectors) ctx.sectorIds.add(s._id.toString())
  for (const app of apps) {
    ctx.knownAppKeys.add(app.key)
    ctx.appActionKeys.set(app.key, new Set((app.actions ?? []).map((a) => a.key)))
  }
  // Conectado = tem instalação NÃO revogada. Uma instalação revogada é uma conexão
  // que já não abre porta nenhuma, e prometer permissão sobre ela seria mentira.
  for (const i of installations) {
    if (i.status !== 'revoked') ctx.installedAppKeys.add(i.appKey)
  }
  return ctx
}

/** O catálogo que entra no prompt: só o que dá para usar, com o estado da conexão. */
export async function loadAppsForPrompt(ownerId: string): Promise<ArchitectAppInfo[]> {
  const [apps, installations] = await Promise.all([listAppsForOwner(ownerId), listInstallations(ownerId)])
  const conectados = new Set(installations.filter((i) => i.status !== 'revoked').map((i) => i.appKey))
  return apps
    .filter((app) => app.status === 'published' && isUsableApp(app))
    .map((app) => ({ key: app.key, name: app.name, connected: conectados.has(app.key) }))
}
