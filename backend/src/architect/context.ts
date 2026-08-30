import { listFloors } from '../floors.js'
import { listAgents } from '../agents.js'
import { listSectors } from '../sectors.js'
import { listAutomations } from '../automations/service.js'
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
  const [floors, agents, sectors, routines, apps, installations] = await Promise.all([
    listFloors(ownerId, { includeArchived: true }),
    listAgents(ownerId),
    listSectors(ownerId),
    listAutomations(ownerId, { limit: 200, skip: 0 }),
    listAppsForOwner(ownerId),
    listInstallations(ownerId),
  ])
  for (const f of floors) ctx.floorIds.add(f._id.toString())
  for (const a of agents) ctx.agentIds.add(a._id.toString())
  for (const s of sectors) ctx.sectorIds.add(s._id.toString())
  for (const r of routines.items) ctx.routineIds.add(r._id.toString())
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

/**
 * O que a conta JÁ TEM, resumido para o prompt.
 *
 * Sem isto o Arquiteto é cego para o escritório existente: ele propõe criar um andar
 * "Atendimento" para quem já tem um, e a pessoa recebe uma proposta que duplica o que
 * ela construiu. Saber o que existe é o que permite dizer "reaproveite este".
 *
 * O que vai: NOME e OBJETIVO — o vocabulário da própria conta, que é o que ajuda o
 * modelo a falar a língua de quem está do outro lado. O que NÃO vai: id de banco, em
 * nenhum campo. O `resourceId` de um reaproveitamento é preenchido pela TELA, depois de
 * o dono escolher; um id no prompt seria um id que o modelo pode inventar, e o
 * validador teria de recusar depois de a pessoa já ter aprovado.
 */
export interface ExistingResources {
  floors: { name: string; mission: string | null; agents: number }[]
  agents: { name: string; objective: string; floor: string | null }[]
  sectors: { name: string; mode: string; floor: string | null; members: number }[]
}

/** Teto por tipo: um escritório grande não pode empurrar a conversa para fora do prompt. */
const MAX_POR_TIPO = 25

export async function loadExistingResources(ownerId: string): Promise<ExistingResources> {
  const [floors, agents, sectors] = await Promise.all([listFloors(ownerId), listAgents(ownerId), listSectors(ownerId)])
  const nomeDoAndar = new Map(floors.map((f) => [f._id.toString(), f.name]))
  const porAndar = new Map<string, number>()
  for (const a of agents) {
    const id = a.officeId?.toString() ?? ''
    porAndar.set(id, (porAndar.get(id) ?? 0) + 1)
  }
  return {
    floors: floors.slice(0, MAX_POR_TIPO).map((f) => ({
      name: f.name,
      mission: f.mission || null,
      agents: porAndar.get(f._id.toString()) ?? 0,
    })),
    agents: agents.slice(0, MAX_POR_TIPO).map((a) => ({
      name: a.name,
      objective: String(a.objective ?? '').slice(0, 200),
      floor: nomeDoAndar.get(a.officeId?.toString() ?? '') ?? null,
    })),
    sectors: sectors.slice(0, MAX_POR_TIPO).map((s) => ({
      name: s.name,
      mode: String(s.mode ?? 'organization'),
      floor: nomeDoAndar.get(s.officeId?.toString() ?? '') ?? null,
      members: (s.members ?? []).length,
    })),
  }
}
