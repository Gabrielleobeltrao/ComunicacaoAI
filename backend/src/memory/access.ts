// Quem pode ler e escrever qual memória.
//
// A regra de fundo é simples: memória pertence a um LUGAR do prédio, e quem está
// naquele lugar enxerga. Um agente vê o que é dele, o que é do setor em que
// trabalha, o que é do andar em que fica e o que é do prédio inteiro. Não vê a
// memória particular de outro agente, nem a de um setor de que não participa.
//
// Isso não é uma hierarquia nova: é a mesma que a interface já mostra. O que este
// módulo faz é traduzi-la para a lista de alvos que uma consulta pode tocar — e a
// consulta NUNCA recebe alvo escolhido por quem pergunta.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { getAgentById } from '../agents.js'
import { getSectorById, listSectors } from '../sectors.js'
import { scopeKeyOf } from './records.js'
import type { MemoryScope, MemoryTarget } from './records.js'

export class MemoryAccessError extends Error {}

export interface ResolvedScope {
  scope: MemoryScope
  scopeKey: string
  label: string
  target: MemoryTarget
}

const floors = db.collection<{ _id: ObjectId; ownerId: string; buildingId?: ObjectId; name: string }>('offices')

/**
 * Os alvos que ESTE agente pode ler.
 *
 * Montado a partir do agente para fora: ele mesmo, os setores de que participa, o
 * andar dele e o prédio. O setor entra por PARTICIPAÇÃO — estar na lista de membros
 * —, não por poder chamar: poder pedir uma tarefa a um setor não é o mesmo que
 * poder ler o que ele guardou.
 */
export async function scopesForAgent(ownerId: string, agentId: ObjectId): Promise<ResolvedScope[]> {
  const agent = await getAgentById(ownerId, agentId)
  if (!agent) throw new MemoryAccessError('agent not found')

  const escopos: ResolvedScope[] = [
    {
      scope: 'agent',
      scopeKey: scopeKeyOf({ scope: 'agent', agentId }),
      label: agent.name,
      target: { scope: 'agent', agentId, floorId: agent.officeId },
    },
  ]

  const doAndar = await listSectors(ownerId, agent.officeId)
  for (const setor of doAndar) {
    const participa = (setor.members ?? []).some((m: { agentId?: ObjectId }) => m.agentId?.toString() === agentId.toString())
    if (!participa) continue
    escopos.push({
      scope: 'sector',
      scopeKey: scopeKeyOf({ scope: 'sector', sectorId: setor._id }),
      label: setor.name,
      target: { scope: 'sector', sectorId: setor._id, floorId: setor.officeId },
    })
  }

  const andar = await floors.findOne({ _id: agent.officeId, ownerId })
  if (andar) {
    escopos.push({
      scope: 'floor',
      scopeKey: scopeKeyOf({ scope: 'floor', floorId: andar._id }),
      label: andar.name,
      target: { scope: 'floor', floorId: andar._id, buildingId: andar.buildingId ?? null },
    })
    if (andar.buildingId) {
      escopos.push({
        scope: 'building',
        scopeKey: scopeKeyOf({ scope: 'building', buildingId: andar.buildingId }),
        label: 'Prédio',
        target: { scope: 'building', buildingId: andar.buildingId },
      })
    }
  }

  return escopos
}

/**
 * Os alvos que o DONO da conta pode ler — que é todo o prédio dele.
 *
 * O dono não é um agente: ele configurou tudo isso e responde por tudo isso. A
 * restrição que continua valendo é a única que importa aqui, a da conta.
 */
export async function scopesForOwner(ownerId: string, filtro: { floorId?: ObjectId | null } = {}): Promise<ResolvedScope[]> {
  const escopos: ResolvedScope[] = []

  const andares = await floors.find({ ownerId, ...(filtro.floorId ? { _id: filtro.floorId } : {}) }).toArray()
  const predios = new Set<string>()
  for (const andar of andares) {
    escopos.push({
      scope: 'floor',
      scopeKey: scopeKeyOf({ scope: 'floor', floorId: andar._id }),
      label: andar.name,
      target: { scope: 'floor', floorId: andar._id, buildingId: andar.buildingId ?? null },
    })
    if (andar.buildingId) predios.add(andar.buildingId.toString())
  }
  for (const id of predios) {
    const buildingId = new ObjectId(id)
    escopos.push({
      scope: 'building',
      scopeKey: scopeKeyOf({ scope: 'building', buildingId }),
      label: 'Prédio',
      target: { scope: 'building', buildingId },
    })
  }

  const idsDeAndar = andares.map((a) => a._id.toString())
  const setores = await listSectors(ownerId, filtro.floorId ?? undefined)
  for (const setor of setores) {
    escopos.push({
      scope: 'sector',
      scopeKey: scopeKeyOf({ scope: 'sector', sectorId: setor._id }),
      label: setor.name,
      target: { scope: 'sector', sectorId: setor._id, floorId: setor.officeId },
    })
  }

  const agentes = await db
    .collection<{ _id: ObjectId; ownerId: string; name: string; officeId: ObjectId }>('agents')
    .find({ ownerId, ...(filtro.floorId ? { officeId: filtro.floorId } : {}) })
    .toArray()
  for (const agente of agentes) {
    if (filtro.floorId == null && idsDeAndar.length && !idsDeAndar.includes(agente.officeId?.toString())) continue
    escopos.push({
      scope: 'agent',
      scopeKey: scopeKeyOf({ scope: 'agent', agentId: agente._id }),
      label: agente.name,
      target: { scope: 'agent', agentId: agente._id, floorId: agente.officeId },
    })
  }

  return escopos
}

/**
 * Resolve um destino de gravação declarado numa configuração, na conta do dono.
 *
 * Devolve `null` quando o alvo não existe ou não é dele. Não lança e não diz qual
 * dos dois: quem configurou um id de outra conta não precisa descobrir por aqui que
 * ele existe.
 */
export async function resolveTarget(
  ownerId: string,
  scope: MemoryScope,
  ids: { agentId?: string | null; sectorId?: string | null; floorId?: string | null; buildingId?: string | null },
): Promise<MemoryTarget | null> {
  const oid = (v: string | null | undefined): ObjectId | null => (v && ObjectId.isValid(v) ? new ObjectId(v) : null)

  if (scope === 'agent') {
    const id = oid(ids.agentId)
    if (!id) return null
    const agente = await getAgentById(ownerId, id)
    return agente ? { scope, agentId: id, floorId: agente.officeId } : null
  }
  if (scope === 'sector') {
    const id = oid(ids.sectorId)
    if (!id) return null
    const setor = await getSectorById(ownerId, id)
    return setor ? { scope, sectorId: id, floorId: setor.officeId } : null
  }
  if (scope === 'floor') {
    const id = oid(ids.floorId)
    if (!id) return null
    const andar = await floors.findOne({ _id: id, ownerId })
    return andar ? { scope, floorId: id, buildingId: andar.buildingId ?? null } : null
  }
  const id = oid(ids.buildingId)
  if (!id) return null
  const predio = await db.collection<{ _id: ObjectId; ownerId: string }>('buildings').findOne({ _id: id, ownerId })
  return predio ? { scope, buildingId: id } : null
}

// Um agente só grava onde ele pode ler. Sem isto, um gatilho mal configurado
// escreveria na memória de um setor do qual o agente não participa.
export async function assertAgentMayWrite(ownerId: string, agentId: ObjectId, target: MemoryTarget): Promise<void> {
  const permitidos = await scopesForAgent(ownerId, agentId)
  const alvo = scopeKeyOf(target)
  if (!permitidos.some((e) => e.scopeKey === alvo)) {
    throw new MemoryAccessError('este agente não pode gravar neste destino')
  }
}
