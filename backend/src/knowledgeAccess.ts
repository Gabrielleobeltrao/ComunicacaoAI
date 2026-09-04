import { ObjectId } from 'mongodb'
import { db } from './db.js'
import { getSectorById } from './sectors.js'
import { getFloor } from './floors.js'
import { getBuilding } from './building.js'
import type { Agent } from './agents.js'
import type { KnowledgeOwner, KnowledgeOwnerType } from './knowledge.js'

// O QUE CADA AGENTE PODE LER — declarado, versionado, e resolvido num lugar só.
//
// Antes disto, cada fluxo montava a própria lista de bases: o chat passava o agente, a
// delegação passava o agente e o setor, a rotina passava outra coisa. Cinco listas
// significam cinco chances de a mesma pergunta ter respostas diferentes dependendo de
// por onde ela entrou — e a que erra nunca é a que alguém está olhando.
//
// Aqui a política é do AGENTE e a resolução é do servidor. O cliente não escolhe base:
// andar e prédio vêm da relação real do agente, o setor da execução precisa ter sido
// validado antes de chegar, e os setores escolhidos à mão são conferidos contra a conta
// a cada execução — um setor que mudou de dono ou deixou de existir simplesmente não
// entra, sem quebrar nada.

export type SectorAccessMode = 'execution_context' | 'home_sector' | 'selected' | 'none'
export const SECTOR_ACCESS_MODES: readonly SectorAccessMode[] = ['execution_context', 'home_sector', 'selected', 'none']

export interface KnowledgeAccessPolicy {
  /** Sobe quando a FORMA da política muda. Guardada para uma leitura antiga continuar explicável. */
  version: number
  own: boolean
  building: boolean
  floor: boolean
  sectorMode: SectorAccessMode
  selectedSectorIds: ObjectId[]
}

export const KNOWLEDGE_ACCESS_VERSION = 1

/**
 * O comportamento de HOJE, escrito.
 *
 * O agente lê a própria base; o setor entra apenas quando a execução começou num setor
 * validado; andar e prédio ficam de fora. Não é um padrão escolhido agora — é
 * exatamente o que o sistema faz desde antes desta política existir, e é por isso que
 * um agente sem configuração salva não muda de comportamento ao subir esta versão.
 */
export const LEGACY_POLICY: Readonly<KnowledgeAccessPolicy> = Object.freeze({
  version: KNOWLEDGE_ACCESS_VERSION,
  own: true,
  building: false,
  floor: false,
  sectorMode: 'execution_context' as const,
  selectedSectorIds: [] as ObjectId[],
})

/** A política do agente — a salva, ou a de sempre. Nada é gravado aqui. */
export function policyOf(agent: Pick<Agent, 'knowledgeAccess'>): KnowledgeAccessPolicy {
  const bruta = agent.knowledgeAccess
  if (!bruta) return { ...LEGACY_POLICY, selectedSectorIds: [] }
  return {
    version: bruta.version ?? KNOWLEDGE_ACCESS_VERSION,
    own: bruta.own ?? LEGACY_POLICY.own,
    building: bruta.building ?? LEGACY_POLICY.building,
    floor: bruta.floor ?? LEGACY_POLICY.floor,
    sectorMode: SECTOR_ACCESS_MODES.includes(bruta.sectorMode as SectorAccessMode) ? (bruta.sectorMode as SectorAccessMode) : LEGACY_POLICY.sectorMode,
    selectedSectorIds: (bruta.selectedSectorIds ?? []).filter((id) => id instanceof ObjectId),
  }
}

/** Este agente TEM política salva? A tela precisa saber para não dizer "configurado" sobre um padrão. */
export const hasStoredPolicy = (agent: Pick<Agent, 'knowledgeAccess'>): boolean => Boolean(agent.knowledgeAccess)

export class KnowledgeAccessError extends Error {}

/**
 * A política que veio do cliente, conferida contra a conta.
 *
 * Setor escolhido precisa existir NESTA conta — um id alheio não vira permissão por ter
 * sido enviado, e a recusa é a mesma de "não existe" para não contar que ele existe em
 * algum lugar. A lista é deduplicada e limitada: uma política com quinhentos setores é
 * uma busca que estoura o orçamento antes de escolher o que responde.
 */
export const MAX_SELECTED_SECTORS = 20

export async function parseKnowledgeAccess(accountId: string, bruto: unknown): Promise<KnowledgeAccessPolicy> {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw new KnowledgeAccessError('informe a política de acesso')
  const b = bruto as Record<string, unknown>

  const booleano = (v: unknown, campo: string, padrao: boolean): boolean => {
    if (v === undefined) return padrao
    if (typeof v !== 'boolean') throw new KnowledgeAccessError(`"${campo}" precisa ser verdadeiro ou falso`)
    return v
  }

  const sectorMode = b.sectorMode === undefined ? LEGACY_POLICY.sectorMode : b.sectorMode
  if (!SECTOR_ACCESS_MODES.includes(sectorMode as SectorAccessMode)) {
    throw new KnowledgeAccessError(`"sectorMode" precisa ser um de: ${SECTOR_ACCESS_MODES.join(', ')}`)
  }

  const brutosSetores = Array.isArray(b.selectedSectorIds) ? b.selectedSectorIds : []
  if (brutosSetores.length > MAX_SELECTED_SECTORS) throw new KnowledgeAccessError(`no máximo ${MAX_SELECTED_SECTORS} setores`)

  const selectedSectorIds: ObjectId[] = []
  const vistos = new Set<string>()
  for (const cru of brutosSetores) {
    const texto = String(cru ?? '')
    if (!ObjectId.isValid(texto)) throw new KnowledgeAccessError('setor não encontrado')
    if (vistos.has(texto)) continue
    // Owner-scoped: o id de outra conta não existe para esta.
    const setor = await getSectorById(accountId, new ObjectId(texto))
    if (!setor) throw new KnowledgeAccessError('setor não encontrado')
    vistos.add(texto)
    selectedSectorIds.push(setor._id)
  }

  // `selected` sem setor nenhum é uma política que não faz nada e parece que faz.
  if (sectorMode === 'selected' && selectedSectorIds.length === 0) {
    throw new KnowledgeAccessError('escolha ao menos um setor, ou use outro modo')
  }

  return {
    version: KNOWLEDGE_ACCESS_VERSION,
    own: booleano(b.own, 'own', LEGACY_POLICY.own),
    building: booleano(b.building, 'building', LEGACY_POLICY.building),
    floor: booleano(b.floor, 'floor', LEGACY_POLICY.floor),
    sectorMode: sectorMode as SectorAccessMode,
    selectedSectorIds,
  }
}

// --- a resolução ----------------------------------------------------------------------

/** Por que esta base entrou. Sem isso, "o agente leu o setor X" não tem explicação. */
export type OwnerReason = 'own' | 'floor' | 'building' | 'execution_sector' | 'home_sector' | 'selected_sector'

export interface ResolvedOwner extends KnowledgeOwner {
  reason: OwnerReason
}

export interface ResolvedKnowledgeOwners {
  owners: ResolvedOwner[]
  policy: KnowledgeAccessPolicy
  /** A política estava salva, ou é a de sempre? */
  configured: boolean
}

export interface ExecutionContext {
  /**
   * O setor em que ESTA execução começou — já validado por quem chamou.
   *
   * Continua sendo o único caminho para o conhecimento do setor no modo padrão, e
   * continua não sendo deduzido: um agente que por acaso é membro de um setor não passa
   * a ler a base dele porque alguém mandou uma mensagem direta.
   */
  verifiedSectorId?: ObjectId | null
}

/**
 * As bases que ESTE agente pode ler NESTA execução — a única fonte de verdade.
 *
 * Todo fluxo passa por aqui: chat, delegação, setor, rotina, playground e widget.
 * Cada base vem com o motivo pelo qual entrou, e a lista sai sem repetição — o mesmo
 * setor escolhido à mão e recebido pela execução é uma base só.
 */
export async function resolveKnowledgeOwnersForExecution(
  accountId: string,
  agent: Pick<Agent, '_id' | 'ownerId' | 'officeId' | 'knowledgeAccess'>,
  ctx: ExecutionContext = {},
): Promise<ResolvedKnowledgeOwners> {
  const policy = policyOf(agent)
  const owners: ResolvedOwner[] = []
  const vistos = new Set<string>()
  const incluir = (ownerType: KnowledgeOwnerType, ownerId: ObjectId, reason: OwnerReason) => {
    const chave = `${ownerType}:${ownerId.toString()}`
    if (vistos.has(chave)) return
    vistos.add(chave)
    owners.push({ ownerType, ownerId, reason })
  }

  /**
   * O agente de OUTRA conta não lê nada.
   *
   * A checagem existe porque este resolver é chamado com o agente que cada fluxo já
   * carregava — e um deles pode um dia carregá-lo por um caminho que não confere a
   * posse. Aqui, um agente que não é desta conta produz zero bases em vez de produzir
   * as bases dele.
   */
  if (agent.ownerId !== accountId) return { owners: [], policy, configured: hasStoredPolicy(agent) }

  if (policy.own) incluir('agent', agent._id, 'own')

  if (policy.floor) {
    // O andar vem da RELAÇÃO do agente, nunca de um id enviado por alguém.
    const andar = await getFloor(accountId, agent.officeId)
    if (andar) incluir('floor', andar._id, 'floor')
  }

  if (policy.building) {
    // O prédio é um por conta, e quem o resolve é o servidor. Ausente numa conta que
    // nunca abriu o prédio: não é erro, é uma base a menos.
    const predio = await getBuilding(accountId)
    if (predio) incluir('building', predio._id, 'building')
  }

  switch (policy.sectorMode) {
    case 'execution_context': {
      if (ctx.verifiedSectorId) {
        const setor = await getSectorById(accountId, ctx.verifiedSectorId)
        if (setor) incluir('sector', setor._id, 'execution_sector')
      }
      break
    }
    case 'home_sector': {
      // A associação REAL: os setores em que este agente é membro.
      const meus = await db
        .collection('sectors')
        .find({ ownerId: accountId, 'members.agentId': agent._id }, { projection: { _id: 1 } })
        .toArray()
      for (const s of meus) incluir('sector', s._id as ObjectId, 'home_sector')
      break
    }
    case 'selected': {
      for (const id of policy.selectedSectorIds) {
        // Conferido A CADA execução: um setor apagado, ou que deixou de ser desta
        // conta, para de entrar sem que ninguém precise limpar a política.
        const setor = await getSectorById(accountId, id)
        if (setor) incluir('sector', setor._id, 'selected_sector')
      }
      break
    }
    case 'none':
      break
  }

  return { owners, policy, configured: hasStoredPolicy(agent) }
}
