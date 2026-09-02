import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { ensureDefaultBuilding } from '../building.js'
import type { DataSetDefinition, DataStore } from './types.js'

// MIGRAÇÃO 9.2 — os históricos que já existem, visíveis como Database.
//
// O que ela NÃO faz: mover registro. Os `data_history_records` continuam exatamente onde
// estão, com o mesmo `recorderId`, e o adapter os lê de lá. Mover milhões de linhas para
// que uma tela nova as encontre seria pagar um custo enorme para não ganhar nada — e uma
// migração que reescreve dado é a que não dá para repetir quando falha no meio.
//
// O que ela faz: cria UM Data Store por conta apontando para os recorders existentes, e um
// dataset por recorder. Idempotente pelo nome do store e pela chave do dataset, então
// rodar duas vezes depois de uma queda continua de onde parou.
//
// Dual-read é o efeito natural disso: Históricos continua sendo a regra de gravação e
// ninguém depende do Data Store para gravar. `retentionDays` não é tocado.

const stores = db.collection<DataStore>('data_stores')
const datasets = db.collection<DataSetDefinition>('dataset_definitions')
const recorders = db.collection<{ _id: ObjectId; ownerId: string; name: string; selectedFields: string[] | null; entityKeyPath: string | null; occurredAtPath: string | null }>('data_recorders')

/** O nome é a chave da idempotência: o índice único de `(ownerId, name)` decide. */
export const DEFAULT_STORE_NAME = 'Históricos'

export interface MigrationResult {
  ownerId: string
  storeId: string | null
  scanned: number
  created: number
  skipped: number
  /** O que aconteceria, quando `dryRun`. Nada é escrito. */
  planned: { recorderId: string; datasetKey: string; name: string }[]
}

/**
 * O schema do dataset, derivado do que o recorder GUARDA.
 *
 * Com `selectedFields`, a forma é conhecida e vira propriedades — é o que permite uma
 * condição de monitor conferir o nome do campo. Sem eles, o recorder guarda o valor
 * inteiro, e declarar uma forma que não existe seria pior do que dizer que não se sabe:
 * o schema fica aberto, e quem consulta descobre pelo dado.
 */
function schemaDoRecorder(campos: string[] | null): Record<string, unknown> {
  if (!campos?.length) return { type: 'object', additionalProperties: true }
  return {
    type: 'object',
    properties: Object.fromEntries(campos.map((c) => [c, {}])),
    additionalProperties: true,
  }
}

/**
 * O store padrão desta conta — criado se ainda não existe.
 *
 * Idempotente pelo índice único de `(ownerId, name)`: duas chamadas concorrentes acabam
 * no mesmo documento em vez de em dois stores com o mesmo nome.
 */
export async function ensureDefaultStore(ownerId: string): Promise<DataStore> {
  const existente = await stores.findOne({ ownerId, name: DEFAULT_STORE_NAME })
  if (existente) return existente
  const predio = await ensureDefaultBuilding(ownerId)
  const agora = new Date()
  const doc: DataStore = {
    _id: new ObjectId(),
    ownerId,
    buildingId: predio._id,
    name: DEFAULT_STORE_NAME,
    description: 'Os históricos que esta conta já gravava, agora visíveis como Database.',
    owner: { ownerType: 'building', ownerId: predio._id.toString() },
    adapterKind: 'data_history',
    // O recorder de cada dataset vem da CHAVE do dataset — um store para todos, em vez
    // de um store por recorder, que encheria a tela de caixas com uma coisa dentro.
    adapterConfig: {},
    status: 'active',
    retention: { mode: 'forever' },
    version: 1,
    createdAt: agora,
    updatedAt: agora,
  }
  try {
    await stores.insertOne(doc)
    return doc
  } catch (erro) {
    if ((erro as { code?: number }).code === 11000) return (await stores.findOne({ ownerId, name: DEFAULT_STORE_NAME }))!
    throw erro
  }
}

/**
 * O dataset de UM recorder — a mesma projeção da migração, para um recorder só.
 *
 * Existe porque um recorder criado depois da migração (o de uma fonte da Central, por
 * exemplo) precisa aparecer como dataset para ser observável por um monitor. Rodar a
 * migração inteira de novo funcionaria, mas varreria a conta toda para criar uma linha.
 */
export async function ensureDatasetForRecorder(
  ownerId: string,
  recorder: { _id: ObjectId; name: string; selectedFields?: string[] | null; occurredAtPath?: string | null },
): Promise<{ dataStoreId: ObjectId; datasetKey: string }> {
  const store = await ensureDefaultStore(ownerId)
  const key = recorder._id.toString()
  const jaExiste = await datasets.findOne({ ownerId, dataStoreId: store._id, key })
  if (jaExiste) return { dataStoreId: store._id, datasetKey: key }
  const agora = new Date()
  try {
    await datasets.insertOne({
      _id: new ObjectId(),
      ownerId,
      dataStoreId: store._id,
      key,
      name: recorder.name,
      schema: schemaDoRecorder(recorder.selectedFields ?? null),
      mutability: 'append_only',
      timeField: recorder.occurredAtPath || 'occurredAt',
      createdAt: agora,
      updatedAt: agora,
    } as DataSetDefinition)
  } catch (erro) {
    if ((erro as { code?: number }).code !== 11000) throw erro
  }
  return { dataStoreId: store._id, datasetKey: key }
}

export async function migrateHistoriesToDataStores(ownerId: string, opcoes: { dryRun?: boolean } = {}): Promise<MigrationResult> {
  const lista = await recorders.find({ ownerId }).toArray()
  const resultado: MigrationResult = { ownerId, storeId: null, scanned: lista.length, created: 0, skipped: 0, planned: [] }
  if (lista.length === 0) return resultado

  const existente = await stores.findOne({ ownerId, name: DEFAULT_STORE_NAME })
  if (opcoes.dryRun && !existente) {
    resultado.planned = lista.map((r) => ({ recorderId: r._id.toString(), datasetKey: r._id.toString(), name: r.name }))
    return resultado
  }

  const agora = new Date()
  const store = existente ?? (await ensureDefaultStore(ownerId))

  resultado.storeId = store._id.toString()

  for (const recorder of lista) {
    const key = recorder._id.toString()
    const jaExiste = await datasets.findOne({ ownerId, dataStoreId: store._id, key })
    if (jaExiste) {
      resultado.skipped += 1
      continue
    }
    resultado.planned.push({ recorderId: key, datasetKey: key, name: recorder.name })
    if (opcoes.dryRun) continue

    await datasets.insertOne({
      _id: new ObjectId(),
      ownerId,
      dataStoreId: store._id,
      key,
      name: recorder.name,
      schema: schemaDoRecorder(recorder.selectedFields),
      // Histórico é append-only por natureza: o que aconteceu não muda de opinião.
      mutability: 'append_only',
      ...(recorder.occurredAtPath ? { timeField: recorder.occurredAtPath } : { timeField: 'occurredAt' }),
      createdAt: agora,
      updatedAt: agora,
    } as DataSetDefinition)
    resultado.created += 1
  }
  return resultado
}

/**
 * O reverso — e ele existe porque uma migração sem volta é uma decisão sem saída.
 *
 * Apaga só o que a migração criou: o store padrão e os datasets cuja chave é um id de
 * recorder desta conta. Registro nenhum é tocado; eles nunca foram movidos.
 */
export async function rollbackHistoryMigration(ownerId: string): Promise<{ removedDatasets: number; removedStore: boolean }> {
  const store = await stores.findOne({ ownerId, name: DEFAULT_STORE_NAME, adapterKind: 'data_history' })
  if (!store) return { removedDatasets: 0, removedStore: false }

  const doStore = await datasets.find({ ownerId, dataStoreId: store._id }).toArray()
  const idsDeRecorder = new Set((await recorders.find({ ownerId }, { projection: { _id: 1 } }).toArray()).map((r) => r._id.toString()))
  // Um dataset criado à mão depois da migração NÃO é removido: ele não é dela.
  const daMigracao = doStore.filter((d) => idsDeRecorder.has(d.key))
  if (daMigracao.length) await datasets.deleteMany({ _id: { $in: daMigracao.map((d) => d._id) } })

  const sobrou = doStore.length - daMigracao.length
  if (sobrou === 0) await stores.deleteOne({ _id: store._id })
  return { removedDatasets: daMigracao.length, removedStore: sobrou === 0 }
}
