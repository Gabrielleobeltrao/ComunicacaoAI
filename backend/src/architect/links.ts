import { ObjectId } from 'mongodb'
import { ValidationError } from '../building.js'
import { listFloors } from '../floors.js'
import { listAgents } from '../agents.js'
import { listSectors } from '../sectors.js'
import { listAutomations } from '../automations/service.js'
import { listDataStores } from '../databases/store.js'
import { listSources } from '../monitoring/service.js'
import { listMonitors } from '../monitors/state.js'
import { listConnections } from '../connections/service.js'
import type { BlueprintAction, OfficeBlueprintV1 } from './types.js'
import type { OfficeBlueprintV2 } from './typesV2.js'

// Quem liga um item da proposta a um recurso REAL.
//
// O modelo nunca preenche `resourceId` — ele é arrancado da resposta antes de qualquer
// gravação. Aqui o id vem da tela, escolhido de uma lista que só contém recurso do
// dono, e é conferido de novo contra o banco: a lista da tela pode estar velha, e a
// posse é decidida no servidor.

export type LinkKind = 'floor' | 'agent' | 'sector' | 'routine' | 'database' | 'source' | 'monitor' | 'flow'
const KINDS: LinkKind[] = ['floor', 'agent', 'sector', 'routine', 'database', 'source', 'monitor', 'flow']

/**
 * Os quatro últimos moram no plano V2 — e é por isso que eles precisavam existir aqui.
 *
 * O compilador já reaproveita por nome quando reconhece o recurso. O que faltava era a
 * escolha MANUAL: "este Database da proposta é aquele que eu já tenho". Sem ela, a pessoa
 * via a proposta criar um segundo Database ao lado do dela e não tinha onde dizer o
 * contrário.
 */
const NO_V2: Partial<Record<LinkKind, [keyof OfficeBlueprintV2, string]>> = {
  database: ['resources', 'databases'],
  source: ['operations', 'sources'],
  monitor: ['operations', 'monitors'],
  flow: ['operations', 'flows'],
}

export interface BlueprintLink {
  kind: LinkKind
  key: string
  action: BlueprintAction
  resourceId?: string | null
}

export interface ArchitectTargets {
  floors: { id: string; name: string }[]
  agents: { id: string; name: string; floorId: string }[]
  sectors: { id: string; name: string; floorId: string }[]
  routines: { id: string; name: string; status: string }[]
  databases: { id: string; name: string }[]
  sources: { id: string; name: string; status: string }[]
  monitors: { id: string; name: string; status: string }[]
  flows: { id: string; name: string; status: string }[]
  /** Por onde uma entrega pode sair. Só as conectadas: as outras não entregariam nada. */
  connections: { id: string; name: string; provider: string }[]
}

/** O que existe nesta conta — a lista que a tela mostra para escolher. */
export async function loadTargets(ownerId: string): Promise<ArchitectTargets> {
  const [andares, agentes, setores, rotinas, bases, fontes, monitores, conexoes] = await Promise.all([
    listFloors(ownerId),
    listAgents(ownerId),
    listSectors(ownerId),
    listAutomations(ownerId, { limit: 200, skip: 0 }),
    // Cada um pela função canônica do domínio dele, que já filtra por dono.
    listDataStores(ownerId).catch(() => []),
    listSources(ownerId).catch(() => []),
    listMonitors(ownerId).catch(() => []),
    listConnections(ownerId).catch(() => []),
  ])
  const automacoes = rotinas.items.map((r) => ({ id: r._id.toString(), name: r.name, status: r.status }))
  return {
    floors: andares.map((f) => ({ id: f._id.toString(), name: f.name })),
    agents: agentes.map((a) => ({ id: a._id.toString(), name: a.name, floorId: a.officeId.toString() })),
    sectors: setores.map((s) => ({ id: s._id.toString(), name: s.name, floorId: s.officeId.toString() })),
    routines: automacoes,
    databases: bases.map((d) => ({ id: d._id.toString(), name: d.name })),
    sources: fontes.map((f) => ({ id: f._id.toString(), name: f.name, status: f.status })),
    monitors: monitores.map((m) => ({ id: m._id.toString(), name: m.name, status: m.status })),
    // Rotina e Flow são a mesma coleção: a diferença é o papel que a proposta dá a cada um.
    flows: automacoes,
    connections: conexoes.filter((c) => c.status === 'connected').map((c) => ({ id: c._id.toString(), name: c.name, provider: c.provider })),
  }
}

/** Onde cada tipo do V1 mora. Os tipos do V2 usam `NO_V2` em vez desta tabela. */
const LISTA: Partial<Record<LinkKind, keyof OfficeBlueprintV1>> = {
  floor: 'floors',
  agent: 'agents',
  sector: 'sectors',
  routine: 'routines',
}

/**
 * Aplica as ligações escolhidas na tela ao blueprint e devolve o novo.
 *
 * Recusa tudo o que não fecha: item que não existe na proposta, recurso que não é
 * desta conta, `create` que veio com id. O blueprint só muda se TODAS as ligações
 * passarem — meio caminho deixaria a proposta num estado que ninguém revisou.
 */
export async function applyBlueprintLinks(
  ownerId: string,
  blueprint: OfficeBlueprintV1,
  links: unknown,
  blueprintV2?: OfficeBlueprintV2 | null,
): Promise<{ blueprint: OfficeBlueprintV1; blueprintV2: OfficeBlueprintV2 | null }> {
  if (!Array.isArray(links)) throw new ValidationError('ligações inválidas')
  if (links.length > 60) throw new ValidationError('ligações demais de uma vez')

  const alvos = await loadTargets(ownerId)
  const donoTem: Record<LinkKind, Set<string>> = {
    floor: new Set(alvos.floors.map((f) => f.id)),
    agent: new Set(alvos.agents.map((a) => a.id)),
    sector: new Set(alvos.sectors.map((s) => s.id)),
    routine: new Set(alvos.routines.map((r) => r.id)),
    database: new Set(alvos.databases.map((d) => d.id)),
    source: new Set(alvos.sources.map((f) => f.id)),
    monitor: new Set(alvos.monitors.map((m) => m.id)),
    flow: new Set(alvos.flows.map((f) => f.id)),
  }

  const fora: OfficeBlueprintV1 = JSON.parse(JSON.stringify(blueprint)) as OfficeBlueprintV1
  const foraV2: OfficeBlueprintV2 | null = blueprintV2 ? (JSON.parse(JSON.stringify(blueprintV2)) as OfficeBlueprintV2) : null
  for (const bruto of links as Record<string, unknown>[]) {
    const kind = String(bruto?.kind ?? '') as LinkKind
    const key = String(bruto?.key ?? '').trim()
    const action = String(bruto?.action ?? '') as BlueprintAction
    if (!KINDS.includes(kind)) throw new ValidationError(`tipo de item desconhecido: ${String(bruto?.kind)}`)
    if (!['create', 'reuse', 'update'].includes(action)) throw new ValidationError('ação inválida')

    const noV2 = NO_V2[kind]
    if (noV2 && !foraV2) throw new ValidationError(`"${key}" não está na proposta`)
    const lista = (
      noV2 && foraV2
        ? ((foraV2[noV2[0]] as unknown as Record<string, unknown>)[noV2[1]] as unknown)
        : (fora[LISTA[kind]!] as unknown)
    ) as { key: string; action: BlueprintAction; resourceId?: string | null }[] | undefined
    const item = lista?.find((i) => i.key === key)
    if (!item) throw new ValidationError(`"${key}" não está na proposta`)

    if (action === 'create') {
      item.action = 'create'
      delete item.resourceId
      continue
    }
    const id = String(bruto?.resourceId ?? '').trim()
    // Não é desta conta ou não existe — e a mensagem é a mesma nos dois casos, para
    // nenhuma resposta confirmar a existência de um recurso alheio.
    if (!id || !ObjectId.isValid(id) || !donoTem[kind].has(id)) throw new ValidationError('o recurso escolhido não existe nesta conta')
    item.action = action
    item.resourceId = id
  }
  return { blueprint: fora, blueprintV2: foraV2 }
}
