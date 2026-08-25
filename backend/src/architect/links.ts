import { ObjectId } from 'mongodb'
import { ValidationError } from '../building.js'
import { listFloors } from '../floors.js'
import { listAgents } from '../agents.js'
import { listSectors } from '../sectors.js'
import { listAutomations } from '../automations/service.js'
import type { BlueprintAction, OfficeBlueprintV1 } from './types.js'

// Quem liga um item da proposta a um recurso REAL.
//
// O modelo nunca preenche `resourceId` — ele é arrancado da resposta antes de qualquer
// gravação. Aqui o id vem da tela, escolhido de uma lista que só contém recurso do
// dono, e é conferido de novo contra o banco: a lista da tela pode estar velha, e a
// posse é decidida no servidor.

export type LinkKind = 'floor' | 'agent' | 'sector' | 'routine'
const KINDS: LinkKind[] = ['floor', 'agent', 'sector', 'routine']

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
}

/** O que existe nesta conta — a lista que a tela mostra para escolher. */
export async function loadTargets(ownerId: string): Promise<ArchitectTargets> {
  const [andares, agentes, setores, rotinas] = await Promise.all([
    listFloors(ownerId),
    listAgents(ownerId),
    listSectors(ownerId),
    listAutomations(ownerId, { limit: 200, skip: 0 }),
  ])
  return {
    floors: andares.map((f) => ({ id: f._id.toString(), name: f.name })),
    agents: agentes.map((a) => ({ id: a._id.toString(), name: a.name, floorId: a.officeId.toString() })),
    sectors: setores.map((s) => ({ id: s._id.toString(), name: s.name, floorId: s.officeId.toString() })),
    routines: rotinas.items.map((r) => ({ id: r._id.toString(), name: r.name, status: r.status })),
  }
}

const LISTA: Record<LinkKind, keyof OfficeBlueprintV1> = {
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
export async function applyBlueprintLinks(ownerId: string, blueprint: OfficeBlueprintV1, links: unknown): Promise<OfficeBlueprintV1> {
  if (!Array.isArray(links)) throw new ValidationError('ligações inválidas')
  if (links.length > 60) throw new ValidationError('ligações demais de uma vez')

  const alvos = await loadTargets(ownerId)
  const donoTem: Record<LinkKind, Set<string>> = {
    floor: new Set(alvos.floors.map((f) => f.id)),
    agent: new Set(alvos.agents.map((a) => a.id)),
    sector: new Set(alvos.sectors.map((s) => s.id)),
    routine: new Set(alvos.routines.map((r) => r.id)),
  }

  const fora: OfficeBlueprintV1 = JSON.parse(JSON.stringify(blueprint)) as OfficeBlueprintV1
  for (const bruto of links as Record<string, unknown>[]) {
    const kind = String(bruto?.kind ?? '') as LinkKind
    const key = String(bruto?.key ?? '').trim()
    const action = String(bruto?.action ?? '') as BlueprintAction
    if (!KINDS.includes(kind)) throw new ValidationError(`tipo de item desconhecido: ${String(bruto?.kind)}`)
    if (!['create', 'reuse', 'update'].includes(action)) throw new ValidationError('ação inválida')

    const lista = fora[LISTA[kind]] as unknown as { key: string; action: BlueprintAction; resourceId?: string | null }[]
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
  return fora
}
