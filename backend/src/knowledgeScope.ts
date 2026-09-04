import { ObjectId } from 'mongodb'
import { getAgentById } from './agents.js'
import { getSectorById } from './sectors.js'
import { getFloor } from './floors.js'
import { getBuilding, ensureDefaultBuilding } from './building.js'
import { isKnowledgeOwnerType } from './knowledge.js'
import type { KnowledgeOwner, KnowledgeOwnerType } from './knowledge.js'

// QUEM é o dono de um documento — resolvido pelo servidor, sempre.
//
// Um `ownerId` que chega do cliente é um pedido, não um fato. Aceitá-lo como veio faria
// o id de um agente de outra conta virar um dono válido: bastaria enviar um ObjectId
// alheio para ler, escrever ou apagar a base de outra pessoa. Aqui cada tipo passa pelo
// getter que já filtra por conta — e o que não pertence a esta conta simplesmente não
// resolve.
//
// A recusa é sempre a MESMA para os três casos possíveis: id inválido, recurso
// inexistente e recurso de outra conta. Distinguir "não existe" de "não é seu" contaria
// ao visitante que aquele id existe em algum lugar — e uma contagem de tentativas
// desenharia o escritório alheio.

export interface KnowledgeScopeRef {
  scopeType: KnowledgeOwnerType
  /** Ausente só faz sentido no prédio: ele é um por conta, e quem o resolve é o servidor. */
  scopeId?: string | null
}

export function parseScopeRef(scopeType: unknown, scopeId: unknown): KnowledgeScopeRef | null {
  if (!isKnowledgeOwnerType(scopeType)) return null
  const id = typeof scopeId === 'string' && scopeId.trim() ? scopeId.trim() : null
  if (scopeType !== 'building' && !id) return null
  return { scopeType, scopeId: id }
}

/**
 * O dono real, ou `null`.
 *
 * `null` é a única resposta negativa: quem chama devolve 404 sem dizer qual dos motivos
 * foi. O prédio é o caso especial — ele não vem do cliente, vem da conta; se o cliente
 * mandar um id de prédio, ele precisa ser exatamente o desta conta, e qualquer outro é
 * tratado como inexistente.
 */
export async function resolveKnowledgeOwner(accountId: string, ref: KnowledgeScopeRef): Promise<KnowledgeOwner | null> {
  const id = ref.scopeId && ObjectId.isValid(ref.scopeId) ? new ObjectId(ref.scopeId) : null

  switch (ref.scopeType) {
    case 'building': {
      // Sem id: o prédio da conta. Com id: só se for o mesmo — um id de prédio alheio
      // não pode virar um dono só porque prédio é "um por conta".
      const predio = ref.scopeId ? await getBuilding(accountId) : await ensureDefaultBuilding(accountId)
      if (!predio) return null
      if (id && !predio._id.equals(id)) return null
      if (ref.scopeId && !id) return null
      return { ownerType: 'building', ownerId: predio._id }
    }
    case 'floor': {
      if (!id) return null
      const andar = await getFloor(accountId, id)
      return andar ? { ownerType: 'floor', ownerId: andar._id } : null
    }
    case 'sector': {
      if (!id) return null
      const setor = await getSectorById(accountId, id)
      return setor ? { ownerType: 'sector', ownerId: setor._id } : null
    }
    case 'agent': {
      if (!id) return null
      const agente = await getAgentById(accountId, id)
      return agente ? { ownerType: 'agent', ownerId: agente._id } : null
    }
    default:
      return null
  }
}

/** O provedor de LLM deste escopo — ou nada, quando ele não dá para resolver com segurança. */
export async function providerForScope(accountId: string, owner: KnowledgeOwner): Promise<'anthropic' | 'openai' | null> {
  if (owner.ownerType !== 'agent') return null
  const agente = await getAgentById(accountId, owner.ownerId)
  return agente?.provider ?? null
}
