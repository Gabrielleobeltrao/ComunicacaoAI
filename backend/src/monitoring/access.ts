import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { resolveAgentSubject, resolveSubject } from '../resources/scope.js'
import { sourcesCollection } from './service.js'

// QUEM ALCANÇA UMA FONTE — com a mesma precedência do resto do produto.
//
// A regra não é nova, e é de propósito: `deny` vence qualquer `allow`, e entre permissões,
// a mais específica ganha (agente > setor > andar > prédio). Inventar uma precedência
// própria aqui faria a mesma pergunta ter duas respostas dependendo do recurso — e a que
// estivesse errada seria descoberta em produção.
//
// A conferência acontece IMEDIATAMENTE antes da leitura, e não na montagem de nada: entre
// conceder e usar cabe uma revogação, e uma permissão conferida cedo demais autoriza o que
// já não devia.

export type SourceCapability = 'read' | 'configure'
export const SOURCE_CAPABILITIES: readonly SourceCapability[] = ['read', 'configure']

export type SubjectType = 'building' | 'floor' | 'sector' | 'agent'

export interface SourceGrant {
  _id: ObjectId
  ownerId: string
  sourceId: ObjectId
  subjectType: SubjectType
  subjectId: string
  capabilities: SourceCapability[]
  effect: 'allow' | 'deny'
  createdAt: Date
  updatedAt: Date
}

const grants = db.collection<SourceGrant>('monitoring_source_grants')

export async function ensureSourceGrantIndexes(): Promise<void> {
  await grants.createIndex({ ownerId: 1, sourceId: 1, subjectType: 1, subjectId: 1 }, { unique: true })
  await grants.createIndex({ ownerId: 1, subjectId: 1 })
}

/** Quanto mais específico, mais pesa. É o desempate entre permissões que se sobrepõem. */
const PESO: Record<SubjectType, number> = { agent: 4, sector: 3, floor: 2, building: 1 }
const ORIGEM: Record<SubjectType, string> = { agent: 'concedido ao agente', sector: 'pelo setor', floor: 'pelo andar', building: 'pelo prédio' }

export interface SourceAccessDecision {
  allowed: boolean
  capabilities: SourceCapability[]
  origin: string | null
  reason: string
}

const negado = (reason = 'este agente não alcança esta fonte'): SourceAccessDecision => ({ allowed: false, capabilities: [], origin: null, reason })

export interface SourceAccessQuery {
  accountId: string
  sourceId: ObjectId
  /** Ausente = pergunta administrativa: quem administra a conta administra as fontes dela. */
  agentId?: ObjectId | null
  capability?: SourceCapability
}

export async function resolveSourceAccess(q: SourceAccessQuery): Promise<SourceAccessDecision> {
  const fonte = await sourcesCollection.findOne({ _id: q.sourceId, ownerId: q.accountId })
  if (!fonte) return negado('esta fonte não está disponível para esta conta')

  if (!q.agentId) {
    return { allowed: true, capabilities: ['read', 'configure'], origin: 'você administra esta conta', reason: 'administração da conta' }
  }

  /**
   * O agente é resolvido contra a CONTA antes de qualquer coisa.
   *
   * Um id vindo do cliente é um pedido: sem esta conferência, perguntar "o agente X pode?"
   * com um id de outra conta devolveria a política daquele agente — que já é vazamento,
   * mesmo sem ler nada.
   */
  const sujeito = await resolveAgentSubject(q.accountId, q.agentId)
  if (!sujeito) return negado()

  if (fonte.status !== 'active') return negado(`esta fonte está ${fonte.status === 'paused' ? 'pausada' : 'em rascunho'}`)

  // Os ids do sujeito são `ObjectId`; o grant guarda TEXTO, porque um grant de prédio e um
  // de agente vivem na mesma coluna e precisam comparar igual.
  const ids = [sujeito.subjectId, ...sujeito.sectorIds, ...(sujeito.floorId ? [sujeito.floorId] : []), ...(sujeito.buildingId ? [sujeito.buildingId] : [])].map((id) =>
    id.toString(),
  )
  const aplicaveis = await grants.find({ ownerId: q.accountId, sourceId: q.sourceId, subjectId: { $in: ids } }).toArray()
  if (aplicaveis.length === 0) return negado()

  // `deny` primeiro, e ele vence qualquer allow — inclusive um mais específico.
  const proibido = new Set<SourceCapability>()
  for (const g of aplicaveis.filter((g) => g.effect === 'deny')) for (const c of g.capabilities) proibido.add(c)

  const permissoes = aplicaveis.filter((g) => g.effect === 'allow').sort((a, b) => PESO[b.subjectType] - PESO[a.subjectType])
  if (permissoes.length === 0) return negado(proibido.size > 0 ? 'há uma negação explícita para este agente' : undefined)

  const vencedor = permissoes[0]
  const capacidades = vencedor.capabilities.filter((c) => !proibido.has(c))
  if (capacidades.length === 0) {
    return { allowed: false, capabilities: [], origin: ORIGEM[vencedor.subjectType], reason: 'todas as capacidades concedidas foram negadas explicitamente' }
  }
  if (q.capability && !capacidades.includes(q.capability)) {
    return { allowed: false, capabilities: capacidades, origin: ORIGEM[vencedor.subjectType], reason: `o acesso concedido não inclui "${q.capability}"` }
  }
  return { allowed: true, capabilities: capacidades, origin: ORIGEM[vencedor.subjectType], reason: 'concedido' }
}

export interface PutGrantInput {
  sourceId: ObjectId
  subjectType: SubjectType
  subjectId: string
  capabilities: SourceCapability[]
  effect?: 'allow' | 'deny'
}

export class GrantError extends Error {
  constructor(
    message: string,
    readonly code = 'invalid',
  ) {
    super(message)
  }
}

export async function putSourceGrant(ownerId: string, input: PutGrantInput): Promise<SourceGrant> {
  const fonte = await sourcesCollection.findOne({ _id: input.sourceId, ownerId })
  if (!fonte) throw new GrantError('fonte não encontrada', 'not_found')

  /**
   * O SUJEITO é resolvido contra a conta — tipo, forma do id, existência e dono.
   *
   * Antes, nada disso era conferido: dava para gravar um acesso para
   * `{subjectType:'banana', subjectId:'lixo'}`, que ficava na lista para sempre sem
   * significar nada, ou para o setor de OUTRA conta, que é pior — a linha na tela diria
   * que alguém tem acesso, e a decisão nunca bateria com ela.
   *
   * Quem resolve é o mesmo `resolveSubject` do resto do produto, que já filtra por conta
   * nos quatro tipos. Um segundo resolvedor aqui divergiria na primeira mudança de
   * hierarquia.
   */
  if (!(['building', 'floor', 'sector', 'agent'] as string[]).includes(input.subjectType)) {
    throw new GrantError('escolha prédio, andar, setor ou agente', 'bad_subject_type')
  }
  if (!ObjectId.isValid(input.subjectId)) throw new GrantError('esse sujeito não existe nesta conta', 'subject_not_found')
  const sujeito = await resolveSubject(ownerId, { subjectType: input.subjectType, subjectId: input.subjectId })
  // A recusa é a mesma para id inválido, inexistente e de outra conta: distinguir os três
  // contaria que aquele id existe em algum lugar.
  if (!sujeito) throw new GrantError('esse sujeito não existe nesta conta', 'subject_not_found')

  const capabilities = [...new Set(input.capabilities)].filter((c): c is SourceCapability => SOURCE_CAPABILITIES.includes(c))
  if (capabilities.length === 0) throw new GrantError('escolha ao menos uma capacidade')

  const agora = new Date()
  const doc = await grants.findOneAndUpdate(
    { ownerId, sourceId: input.sourceId, subjectType: input.subjectType, subjectId: input.subjectId },
    {
      $set: { capabilities, effect: input.effect === 'deny' ? 'deny' : 'allow', updatedAt: agora },
      $setOnInsert: { _id: new ObjectId(), ownerId, sourceId: input.sourceId, subjectType: input.subjectType, subjectId: input.subjectId, createdAt: agora },
    },
    { upsert: true, returnDocument: 'after' },
  )
  return doc!
}

export const listSourceGrants = (ownerId: string, sourceId: ObjectId) => grants.find({ ownerId, sourceId }).sort({ createdAt: 1 }).toArray()

export async function deleteSourceGrant(ownerId: string, sourceId: ObjectId, subjectType: SubjectType, subjectId: string): Promise<boolean> {
  const r = await grants.deleteOne({ ownerId, sourceId, subjectType, subjectId })
  return r.deletedCount === 1
}

export const sourceGrantsCollection = grants
