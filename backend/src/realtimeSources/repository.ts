import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { ValidationError } from '../building.js'
import { listInstallations } from '../apps/installations.js'
import { normalizeMappingPath, normalizeMappingTarget } from '../integrations/websocket/mapping.js'
import { DEFAULT_STALE_SECONDS, MAX_SOURCES_PER_OWNER, MAX_STALE_SECONDS, REALTIME_SOURCE_KINDS } from './types.js'
import type { RealtimeDataSource, RealtimeSourceKind } from './types.js'

const sources = db.collection<RealtimeDataSource>('realtime_sources')
export const realtimeSourcesCollection = sources

export async function ensureRealtimeSourceIndexes(): Promise<void> {
  // O alias é o nome que o agente usa: dois iguais na mesma conta seriam ambíguos na
  // hora de resolver, e o erro apareceria só na execução.
  await sources.createIndex({ ownerId: 1, alias: 1 }, { unique: true })
  // A busca do agente: as fontes que ele pode consultar.
  await sources.createIndex({ ownerId: 1, agentIds: 1, enabled: 1 })
}

const texto = (v: unknown, campo: string, max = 120): string => {
  const s = String(v ?? '').trim()
  if (!s) throw new ValidationError(`${campo}: informe um valor.`)
  if (s.length > max) throw new ValidationError(`${campo}: texto longo demais.`)
  return s
}

export interface SourceInput {
  name?: unknown
  sourceKind?: unknown
  sourceRef?: unknown
  key?: unknown
  alias?: unknown
  allowedFields?: unknown
  staleAfterSeconds?: unknown
  agentIds?: unknown
  enabled?: unknown
}

/**
 * A definição normalizada — pura, sem tocar no banco.
 *
 * A posse da conexão é conferida à parte, porque exige consulta. As duas juntas são a
 * resposta completa: a configuração faz sentido E aponta para algo desta conta.
 */
export function normalizarFonte(bruto: SourceInput): Omit<RealtimeDataSource, '_id' | 'ownerId' | 'createdAt' | 'updatedAt'> {
  const sourceKind = String(bruto.sourceKind ?? 'live_data') as RealtimeSourceKind
  if (!REALTIME_SOURCE_KINDS.includes(sourceKind)) throw new ValidationError('fonte: escolha de onde o dado vem.')

  const campos = Array.isArray(bruto.allowedFields) ? bruto.allowedFields.filter((c) => String(c ?? '').trim()) : []
  if (campos.length > 30) throw new ValidationError('no máximo 30 campos.')

  const stale = bruto.staleAfterSeconds === undefined || bruto.staleAfterSeconds === null ? DEFAULT_STALE_SECONDS : Number(bruto.staleAfterSeconds)
  if (!Number.isFinite(stale) || stale < 1 || stale > MAX_STALE_SECONDS) {
    throw new ValidationError(`considerar velho: entre 1 e ${MAX_STALE_SECONDS} segundos.`)
  }

  const agentIds = (Array.isArray(bruto.agentIds) ? bruto.agentIds : [])
    .map((a) => String(a ?? ''))
    .filter((a) => ObjectId.isValid(a))
    .map((a) => new ObjectId(a))

  return {
    name: texto(bruto.name, 'nome'),
    sourceKind,
    sourceRef: texto(bruto.sourceRef, 'conexão', 200),
    key: texto(bruto.key, 'chave', 200),
    // O alias vira identificador dentro do agente: as mesmas regras de um nome de
    // campo, incluindo a recusa do que mexe no protótipo.
    alias: normalizeMappingTarget(bruto.alias, 'nome para o agente'),
    allowedFields: campos.length ? campos.map((c, i) => normalizeMappingPath(c, `campo ${i + 1}`)) : null,
    staleAfterSeconds: Math.round(stale),
    agentIds,
    enabled: bruto.enabled === undefined ? true : Boolean(bruto.enabled),
  }
}

/**
 * A conexão existe e é desta conta?
 *
 * `sourceRef` chega do cliente. Sem esta conferência, alguém poderia apontar uma fonte
 * para a conexão de outra conta e ler, pelo próprio agente, o dado que ela recebe.
 */
export async function conferirFonteRealtime(ownerId: string, sourceKind: RealtimeSourceKind, sourceRef: string): Promise<string> {
  if (sourceKind === 'live_data') {
    if (!ObjectId.isValid(sourceRef)) throw new ValidationError('conexão: escolha uma da lista.')
    const instalacao = (await listInstallations(ownerId, 'websocket')).find((i) => i._id.toString() === sourceRef)
    if (!instalacao) throw new ValidationError('conexão: essa conexão não existe nesta conta.')
    return instalacao.name
  }
  throw new ValidationError('fonte: tipo não suportado.')
}

export async function criarFonte(ownerId: string, bruto: SourceInput, agora = new Date()): Promise<RealtimeDataSource> {
  if ((await sources.countDocuments({ ownerId })) >= MAX_SOURCES_PER_OWNER) {
    throw new ValidationError(`limite de ${MAX_SOURCES_PER_OWNER} fontes em tempo real por conta.`)
  }
  const def = normalizarFonte(bruto)
  await conferirFonteRealtime(ownerId, def.sourceKind, def.sourceRef)
  const doc: RealtimeDataSource = { _id: new ObjectId(), ownerId, ...def, createdAt: agora, updatedAt: agora }
  try {
    await sources.insertOne(doc)
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new ValidationError(`já existe uma fonte chamada "${def.alias}" nesta conta.`)
    throw error
  }
  return doc
}

export const listarFontes = (ownerId: string): Promise<RealtimeDataSource[]> => sources.find({ ownerId }).sort({ createdAt: -1 }).toArray()

export const obterFonte = (ownerId: string, id: ObjectId): Promise<RealtimeDataSource | null> => sources.findOne({ _id: id, ownerId })

/** As fontes que ESTE agente pode consultar. Vazio quando ninguém concedeu nada. */
export const fontesDoAgente = (ownerId: string, agentId: ObjectId): Promise<RealtimeDataSource[]> =>
  sources.find({ ownerId, agentIds: agentId, enabled: true }).sort({ alias: 1 }).toArray()

export async function atualizarFonte(ownerId: string, id: ObjectId, bruto: SourceInput, agora = new Date()): Promise<RealtimeDataSource | null> {
  const atual = await obterFonte(ownerId, id)
  if (!atual) return null
  const def = normalizarFonte({
    name: bruto.name ?? atual.name,
    sourceKind: bruto.sourceKind ?? atual.sourceKind,
    sourceRef: bruto.sourceRef ?? atual.sourceRef,
    key: bruto.key ?? atual.key,
    alias: bruto.alias ?? atual.alias,
    allowedFields: bruto.allowedFields === undefined ? atual.allowedFields : bruto.allowedFields,
    staleAfterSeconds: bruto.staleAfterSeconds === undefined ? atual.staleAfterSeconds : bruto.staleAfterSeconds,
    agentIds: bruto.agentIds === undefined ? atual.agentIds.map((a) => a.toString()) : bruto.agentIds,
    enabled: bruto.enabled === undefined ? atual.enabled : bruto.enabled,
  })
  await conferirFonteRealtime(ownerId, def.sourceKind, def.sourceRef)
  try {
    const r = await sources.findOneAndUpdate({ _id: id, ownerId }, { $set: { ...def, updatedAt: agora } }, { returnDocument: 'after' })
    return (r as RealtimeDataSource) ?? null
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new ValidationError(`já existe uma fonte chamada "${def.alias}" nesta conta.`)
    throw error
  }
}

export async function apagarFonte(ownerId: string, id: ObjectId): Promise<boolean> {
  const r = await sources.deleteOne({ _id: id, ownerId })
  return r.deletedCount > 0
}

/**
 * Conceder ou retirar o acesso de um agente — a operação que a tela dele usa.
 *
 * Fica aqui, e não num campo do agente, porque a fonte é do DONO e compartilhada: dois
 * agentes lendo a mesma chave são duas entradas nesta lista, e continua sendo um stream
 * só. Guardar isso no documento do agente espalharia a mesma verdade por N lugares.
 */
export async function definirAgentes(ownerId: string, id: ObjectId, agentIds: string[], agora = new Date()): Promise<RealtimeDataSource | null> {
  const ids = agentIds.filter((a) => ObjectId.isValid(a)).map((a) => new ObjectId(a))
  const r = await sources.findOneAndUpdate({ _id: id, ownerId }, { $set: { agentIds: ids, updatedAt: agora } }, { returnDocument: 'after' })
  return (r as RealtimeDataSource) ?? null
}

/** Um agente foi removido: ele sai das concessões, senão sobra um id que não abre nada. */
export const removerAgenteDasFontes = async (ownerId: string, agentId: ObjectId): Promise<void> => {
  await sources.updateMany({ ownerId, agentIds: agentId }, { $pull: { agentIds: agentId } })
}
