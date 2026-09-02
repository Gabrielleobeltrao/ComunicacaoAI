import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { getAgentById } from '../agents.js'
import { getSectorById } from '../sectors.js'
import { getFloor } from '../floors.js'
import { getBuilding } from '../building.js'
import type { ResourceSubjectRef, ResourceSubjectType } from './types.js'
import { RESOURCE_SUBJECT_TYPES } from './types.js'

// QUEM É O SUJEITO — resolvido pelo servidor, nunca aceito como veio.
//
// Um `subjectId` que chega do cliente é um pedido. Aceitá-lo faria o id de um setor de
// outra conta virar um filtro válido: bastaria enviar um ObjectId alheio para listar o
// que aquele setor alcança. Aqui cada tipo passa pelo getter que já filtra por conta.
//
// A recusa é sempre a mesma para id inválido, inexistente e de outra conta — distinguir
// os três contaria que aquele id existe em algum lugar.

export interface ResolvedSubject {
  subjectType: ResourceSubjectType
  subjectId: ObjectId
  name: string
  /** A hierarquia REAL, resolvida agora. É dela que sai a herança de acesso. */
  floorId: ObjectId | null
  sectorIds: ObjectId[]
  buildingId: ObjectId | null
}

export function parseSubject(subjectType: unknown, subjectId: unknown): ResourceSubjectRef | null {
  if (!RESOURCE_SUBJECT_TYPES.includes(subjectType as ResourceSubjectType)) return null
  const id = typeof subjectId === 'string' && subjectId.trim() ? subjectId.trim() : null
  if (!id) return null
  return { subjectType: subjectType as ResourceSubjectType, subjectId: id }
}

/**
 * O sujeito real, com a hierarquia dele.
 *
 * A hierarquia é RESOLVIDA, e não guardada dentro do grant: duplicar `floorId` ou a lista
 * de membros do setor num grant cria uma segunda verdade que envelhece na primeira
 * mudança de equipe — e a que erra é sempre a cópia.
 */
export async function resolveSubject(accountId: string, ref: ResourceSubjectRef): Promise<ResolvedSubject | null> {
  if (!ObjectId.isValid(ref.subjectId)) return null
  const id = new ObjectId(ref.subjectId)

  switch (ref.subjectType) {
    case 'building': {
      const predio = await getBuilding(accountId)
      if (!predio || !predio._id.equals(id)) return null
      return { subjectType: 'building', subjectId: predio._id, name: predio.name, floorId: null, sectorIds: [], buildingId: predio._id }
    }
    case 'floor': {
      const andar = await getFloor(accountId, id)
      if (!andar) return null
      return { subjectType: 'floor', subjectId: andar._id, name: andar.name, floorId: andar._id, sectorIds: [], buildingId: andar.buildingId ?? null }
    }
    case 'sector': {
      const setor = await getSectorById(accountId, id)
      if (!setor) return null
      const andar = setor.officeId ? await getFloor(accountId, setor.officeId) : null
      return {
        subjectType: 'sector',
        subjectId: setor._id,
        name: setor.name,
        floorId: setor.officeId ?? null,
        sectorIds: [setor._id],
        buildingId: andar?.buildingId ?? null,
      }
    }
    case 'agent': {
      const agente = await getAgentById(accountId, id)
      if (!agente) return null
      // Os setores de que ele é MEMBRO — a associação real, lida agora.
      const setores = await db
        .collection('sectors')
        .find({ ownerId: accountId, 'members.agentId': agente._id }, { projection: { _id: 1 } })
        .toArray()
      const andar = agente.officeId ? await getFloor(accountId, agente.officeId) : null
      return {
        subjectType: 'agent',
        subjectId: agente._id,
        name: agente.name,
        floorId: agente.officeId ?? null,
        sectorIds: setores.map((s) => s._id as ObjectId),
        buildingId: andar?.buildingId ?? null,
      }
    }
    default:
      return null
  }
}

/** O agente, com a hierarquia dele. Atalho para o caminho mais comum. */
export const resolveAgentSubject = (accountId: string, agentId: ObjectId) =>
  resolveSubject(accountId, { subjectType: 'agent', subjectId: agentId.toString() })
