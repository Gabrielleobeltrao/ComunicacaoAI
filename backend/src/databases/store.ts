import { ObjectId } from 'mongodb'
import type { ArchitectStamp } from '../architectStamp.js'
import { db } from '../db.js'
import { ensureDefaultBuilding } from '../building.js'
import type { DataSetDefinition, DataStore, DataStoreAdapterKind, DataStoreGrant, DataStoreStatus, QueryLogEntry } from './types.js'
import { ADAPTER_KINDS, DATABASE_CAPABILITIES } from './types.js'
import type { DatabaseCapability } from './types.js'

// A persistência dos Data Stores.
//
// Três coleções pequenas: o store (nome, dono, adapter, retenção), o dataset (schema e
// mutabilidade) e o grant. Os REGISTROS não moram aqui — eles continuam onde já estavam,
// nos recorders do histórico e no engine de mercado. Copiá-los seria criar uma segunda
// verdade sobre a mesma série, e a que erra é sempre a cópia.

const stores = db.collection<DataStore>('data_stores')
const datasets = db.collection<DataSetDefinition>('dataset_definitions')
const grants = db.collection<DataStoreGrant>('data_store_grants')
const queryLog = db.collection<QueryLogEntry>('data_store_query_log')

export async function ensureDatabaseIndexes(): Promise<void> {
  await stores.createIndex({ ownerId: 1, name: 1 }, { unique: true })
  await stores.createIndex({ ownerId: 1, adapterKind: 1 })
  await datasets.createIndex({ ownerId: 1, dataStoreId: 1, key: 1 }, { unique: true })
  await grants.createIndex({ ownerId: 1, dataStoreId: 1, subjectType: 1, subjectId: 1 }, { unique: true })
  await queryLog.createIndex({ ownerId: 1, at: -1 })
  // O log de consulta é telemetria: ele mede uso, não guarda dado. Sem prazo, ele vira
  // um arquivo que ninguém lê e todo mundo paga.
  await queryLog.createIndex({ at: 1 }, { expireAfterSeconds: 30 * 24 * 3600, name: 'query_log_retencao' })
}

export class DataStoreError extends Error {
  constructor(
    message: string,
    readonly code = 'invalid',
  ) {
    super(message)
  }
}

/** Uma conta não pode criar stores sem fim: a cota é da conta, e é conferida antes. */
export const MAX_STORES_POR_CONTA = Number(process.env.DATA_STORE_MAX_PER_ACCOUNT ?? 50)
export const MAX_DATASETS_POR_STORE = Number(process.env.DATA_STORE_MAX_DATASETS ?? 50)

export interface CreateStoreInput {
  name: string
  description?: string
  adapterKind: DataStoreAdapterKind
  adapterConfig?: Record<string, unknown>
  retention?: DataStore['retention']
}

export async function createDataStore(ownerId: string, input: CreateStoreInput & { architect?: ArchitectStamp }): Promise<DataStore> {
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 120) throw new DataStoreError('o nome precisa ter de 1 a 120 caracteres')
  if (!ADAPTER_KINDS.includes(input.adapterKind)) throw new DataStoreError('adapter desconhecido')
  if ((await stores.countDocuments({ ownerId })) >= MAX_STORES_POR_CONTA) {
    throw new DataStoreError(`esta conta já tem ${MAX_STORES_POR_CONTA} databases`, 'quota_exceeded')
  }

  const predio = await ensureDefaultBuilding(ownerId)
  const agora = new Date()
  const doc: DataStore = {
    _id: new ObjectId(),
    ownerId,
    buildingId: predio._id,
    name,
    description: String(input.description ?? '').slice(0, 500),
    owner: { ownerType: 'building', ownerId: predio._id.toString() },
    adapterKind: input.adapterKind,
    // Referências, nunca segredo — o adapter resolve a credencial na fonte dela.
    adapterConfig: sanitizarConfig(input.adapterConfig ?? {}),
    status: 'active',
    // A marca vai na MESMA escrita que cria o recurso: gravá-la depois reabriria a janela
    // que ela existe para fechar.
    ...(input.architect ? { architect: input.architect } : {}),
    retention: input.retention ?? { mode: 'forever' },
    version: 1,
    createdAt: agora,
    updatedAt: agora,
  }
  try {
    await stores.insertOne(doc)
  } catch (erro) {
    if ((erro as { code?: number }).code === 11000) throw new DataStoreError('já existe um database com este nome', 'duplicate')
    throw erro
  }
  return doc
}

/**
 * A config do adapter nunca carrega segredo.
 *
 * Não é uma questão de disciplina de quem chama: qualquer chave com cara de credencial é
 * recusada aqui, porque a config viaja para a tela e para o catálogo — e um token que
 * chegou por engano num campo de configuração vaza pelo caminho mais banal que existe.
 */
const PROIBIDO = /(secret|token|password|senha|apikey|api_key|credential|authorization)/i
function sanitizarConfig(config: Record<string, unknown>): Record<string, unknown> {
  const fora: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config)) {
    if (PROIBIDO.test(k)) throw new DataStoreError(`"${k}" não pode entrar na configuração: credencial fica na conexão`, 'secret_in_config')
    if (typeof v === 'string' && v.length > 500) throw new DataStoreError(`"${k}" é longo demais`)
    fora[k] = v
  }
  return fora
}

export const listDataStores = (ownerId: string) => stores.find({ ownerId }).sort({ name: 1 }).toArray()
export const getDataStore = (ownerId: string, id: ObjectId) => stores.findOne({ _id: id, ownerId })

export async function updateDataStore(
  ownerId: string,
  id: ObjectId,
  patch: { name?: string; description?: string; status?: DataStoreStatus; retention?: DataStore['retention'] },
): Promise<DataStore | null> {
  const set: Partial<DataStore> = { updatedAt: new Date() }
  if (patch.name !== undefined) {
    const n = patch.name.trim()
    if (!n) throw new DataStoreError('o nome não pode ficar vazio')
    set.name = n.slice(0, 120)
  }
  if (patch.description !== undefined) set.description = patch.description.slice(0, 500)
  if (patch.status !== undefined) {
    if (!['active', 'paused', 'archived'].includes(patch.status)) throw new DataStoreError('estado desconhecido')
    set.status = patch.status
  }
  if (patch.retention !== undefined) set.retention = patch.retention
  return stores.findOneAndUpdate({ _id: id, ownerId }, { $set: set }, { returnDocument: 'after' })
}

/** Apagar leva os datasets e os grants — nunca os registros, que são de outro dono. */
export async function deleteDataStore(ownerId: string, id: ObjectId): Promise<boolean> {
  const r = await stores.deleteOne({ _id: id, ownerId })
  if (r.deletedCount === 0) return false
  await Promise.all([datasets.deleteMany({ ownerId, dataStoreId: id }), grants.deleteMany({ ownerId, dataStoreId: id })])
  return true
}

// --- datasets ---------------------------------------------------------------------------

export interface CreateDatasetInput {
  key: string
  name: string
  schema: Record<string, unknown>
  primaryKey?: string[]
  mutability?: DataSetDefinition['mutability']
  timeField?: string
}

const CHAVE = /^[a-z0-9_]{1,60}$/

export async function createDataset(ownerId: string, dataStoreId: ObjectId, input: CreateDatasetInput): Promise<DataSetDefinition> {
  const store = await getDataStore(ownerId, dataStoreId)
  if (!store) throw new DataStoreError('database não encontrado', 'not_found')
  const key = String(input.key ?? '').trim().toLowerCase()
  if (!CHAVE.test(key)) throw new DataStoreError('a chave usa letras minúsculas, números e _ (até 60)')
  if ((await datasets.countDocuments({ ownerId, dataStoreId })) >= MAX_DATASETS_POR_STORE) {
    throw new DataStoreError(`este database já tem ${MAX_DATASETS_POR_STORE} datasets`, 'quota_exceeded')
  }

  const schema = input.schema ?? {}
  if (typeof schema !== 'object' || Array.isArray(schema)) throw new DataStoreError('o schema precisa ser um objeto')
  if (!schema.properties || typeof schema.properties !== 'object') {
    // Sem campos declarados não há consulta possível: a DSL só permite o que o schema
    // declara, e um dataset sem propriedades aceitaria tudo ou nada.
    throw new DataStoreError('o schema precisa declarar "properties"', 'no_schema')
  }

  const agora = new Date()
  const doc: DataSetDefinition = {
    _id: new ObjectId(),
    ownerId,
    dataStoreId,
    key,
    name: String(input.name ?? key).slice(0, 120),
    schema: schema as Record<string, unknown>,
    ...(input.primaryKey?.length ? { primaryKey: input.primaryKey.slice(0, 5) } : {}),
    // Série temporal nasce `append_only`: aceitar `update` faria alguém corrigir um valor
    // de ontem e o gráfico mudar sem que nada registre a mudança.
    mutability: input.mutability ?? (store.adapterKind === 'market_data' ? 'read_only' : 'append_only'),
    ...(input.timeField ? { timeField: input.timeField } : {}),
    createdAt: agora,
    updatedAt: agora,
  }
  try {
    await datasets.insertOne(doc)
  } catch (erro) {
    if ((erro as { code?: number }).code === 11000) throw new DataStoreError('já existe um dataset com esta chave', 'duplicate')
    throw erro
  }
  return doc
}

export const listDatasets = (ownerId: string, dataStoreId: ObjectId) => datasets.find({ ownerId, dataStoreId }).sort({ key: 1 }).toArray()
export const getDataset = (ownerId: string, dataStoreId: ObjectId, key: string) => datasets.findOne({ ownerId, dataStoreId, key })
export const getDatasetById = (ownerId: string, id: ObjectId) => datasets.findOne({ _id: id, ownerId })

export async function updateDataset(
  ownerId: string,
  dataStoreId: ObjectId,
  key: string,
  patch: { name?: string; schema?: Record<string, unknown>; mutability?: DataSetDefinition['mutability'] },
): Promise<DataSetDefinition | null> {
  const set: Partial<DataSetDefinition> = { updatedAt: new Date() }
  if (patch.name !== undefined) set.name = patch.name.slice(0, 120)
  if (patch.schema !== undefined) {
    if (!patch.schema.properties) throw new DataStoreError('o schema precisa declarar "properties"', 'no_schema')
    set.schema = patch.schema
  }
  if (patch.mutability !== undefined) set.mutability = patch.mutability
  return datasets.findOneAndUpdate({ ownerId, dataStoreId, key }, { $set: set }, { returnDocument: 'after' })
}

export const deleteDataset = async (ownerId: string, dataStoreId: ObjectId, key: string): Promise<boolean> =>
  (await datasets.deleteOne({ ownerId, dataStoreId, key })).deletedCount > 0

// --- grants -------------------------------------------------------------------------------

export interface GrantInput {
  subjectType: DataStoreGrant['subjectType']
  subjectId: ObjectId
  capabilities: DatabaseCapability[]
  effect?: 'allow' | 'deny'
  datasetKeys?: string[]
}

export async function putGrant(ownerId: string, dataStoreId: ObjectId, input: GrantInput, createdBy: string): Promise<DataStoreGrant> {
  const capacidades = (input.capabilities ?? []).filter((c) => DATABASE_CAPABILITIES.includes(c))
  if (capacidades.length === 0) throw new DataStoreError('escolha ao menos uma capacidade')
  const agora = new Date()
  const doc: DataStoreGrant = {
    _id: new ObjectId(),
    ownerId,
    dataStoreId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    capabilities: capacidades,
    effect: input.effect === 'deny' ? 'deny' : 'allow',
    datasetKeys: (input.datasetKeys ?? []).slice(0, 50),
    createdBy,
    createdAt: agora,
    updatedAt: agora,
  }
  await grants.updateOne(
    { ownerId, dataStoreId, subjectType: doc.subjectType, subjectId: doc.subjectId },
    { $set: { capabilities: doc.capabilities, effect: doc.effect, datasetKeys: doc.datasetKeys, updatedAt: agora }, $setOnInsert: { _id: doc._id, ownerId, dataStoreId, subjectType: doc.subjectType, subjectId: doc.subjectId, createdBy, createdAt: agora } },
    { upsert: true },
  )
  return (await grants.findOne({ ownerId, dataStoreId, subjectType: doc.subjectType, subjectId: doc.subjectId }))!
}

export const listGrants = (ownerId: string, dataStoreId: ObjectId) => grants.find({ ownerId, dataStoreId }).toArray()

export const deleteGrant = async (ownerId: string, grantId: ObjectId): Promise<boolean> =>
  (await grants.deleteOne({ _id: grantId, ownerId })).deletedCount > 0

/** Os grants que alcançam ESTE sujeito — dele e da hierarquia dele. */
export const grantsForSubject = (ownerId: string, dataStoreId: ObjectId, ids: ObjectId[]) =>
  grants.find({ ownerId, dataStoreId, subjectId: { $in: ids } }).toArray()

// --- telemetria -------------------------------------------------------------------------------

/** Nunca lança e nunca guarda conteúdo: store, dataset, quem, quanto e quanto tempo. */
export async function logQuery(entry: Omit<QueryLogEntry, 'at'>): Promise<void> {
  try {
    await queryLog.insertOne({ ...entry, at: new Date() })
  } catch {
    // Telemetria perdida não derruba a consulta que a produziu.
  }
}

export const recentQueries = (ownerId: string, limit = 100) =>
  queryLog.find({ ownerId }, { projection: { _id: 0 } }).sort({ at: -1 }).limit(Math.min(limit, 500)).toArray()
