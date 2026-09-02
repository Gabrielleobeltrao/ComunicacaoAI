import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { getDataset, getDataStore, logQuery } from './store.js'
import { parseQuery, QueryDslError, toMongoFilter, toMongoProjection, toMongoSort } from './queryDsl.js'
import type { QuerySpec } from './queryDsl.js'
import type { DataSetDefinition, DataStore } from './types.js'

// OS ADAPTERS de armazenamento — cada um lendo onde o dado JÁ mora.
//
// Nenhum deles copia registro. `data_history` lê a coleção de registros que os recorders
// alimentam; `market_data` lê o engine de mercado e é somente leitura, porque candle e
// indicador vêm de um pipeline próprio que já sabe fechar janela e deduplicar. Duplicar
// qualquer um dos dois criaria duas séries com o mesmo nome e valores diferentes — e a
// que erra é sempre a cópia.

export interface QueryResult {
  rows: Record<string, unknown>[]
  total: number
  /** O dado é atual até quando? Uma série sem isto parece fresca para sempre. */
  freshness: Date | null
  truncated: boolean
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly code = 'adapter_error',
  ) {
    super(message)
  }
}

const records = db.collection('data_history_records')

/**
 * A consulta ao histórico.
 *
 * O escopo entra no filtro do BANCO — `ownerId` e `recorderId` primeiro, e o filtro do
 * usuário depois, sobre o prefixo `value.`. Um campo chamado `ownerId` no schema do
 * dataset vira `value.ownerId` e não alcança a raiz do documento: é a razão de o prefixo
 * ser do servidor e não do chamador.
 */
async function queryDataHistory(store: DataStore, dataset: DataSetDefinition, spec: QuerySpec): Promise<QueryResult> {
  const recorderId = String(store.adapterConfig.recorderId ?? dataset.key)
  if (!ObjectId.isValid(recorderId)) throw new AdapterError('este database não aponta para um histórico válido', 'bad_config')

  const escopo = { ownerId: store.ownerId, recorderId: new ObjectId(recorderId) }
  const filtro = { ...escopo, ...toMongoFilter(spec.filter) }
  const projecao = toMongoProjection(spec.fields)

  const [linhas, total, ultimo] = await Promise.all([
    records
      .find(filtro, { projection: projecao ? { ...projecao, occurredAt: 1, _id: 0 } : { value: 1, occurredAt: 1, _id: 0 } })
      .sort(Object.keys(toMongoSort(spec.sort)).length ? toMongoSort(spec.sort) : { occurredAt: -1 })
      .skip(spec.skip ?? 0)
      .limit(spec.limit ?? 50)
      .toArray(),
    records.countDocuments(filtro),
    records.find(escopo, { projection: { occurredAt: 1 } }).sort({ occurredAt: -1 }).limit(1).next(),
  ])

  return {
    rows: linhas.map((l) => ({ ...(l.value as Record<string, unknown>), occurredAt: l.occurredAt })),
    total,
    freshness: (ultimo?.occurredAt as Date) ?? null,
    truncated: total > (spec.skip ?? 0) + linhas.length,
  }
}

/**
 * A consulta a dados de mercado — VIRTUAL e somente leitura.
 *
 * Ela lê o mesmo armazenamento de candles que o engine de mercado alimenta. Não há cópia,
 * não há reimplementação de indicador: quem calcula RSI continua sendo quem já calculava.
 */
async function queryMarketData(store: DataStore, dataset: DataSetDefinition, spec: QuerySpec): Promise<QueryResult> {
  const candles = db.collection('market_candles')
  const symbol = String(store.adapterConfig.symbol ?? dataset.key).toUpperCase()
  const timeframe = String(store.adapterConfig.timeframe ?? '1d')

  const escopo: Record<string, unknown> = { ownerId: store.ownerId, symbol, timeframe }
  const filtro = { ...escopo, ...toMongoFilter(spec.filter, '') }

  const [linhas, total, ultimo] = await Promise.all([
    candles
      .find(filtro, { projection: { _id: 0, ownerId: 0 } })
      .sort(Object.keys(toMongoSort(spec.sort, '')).length ? toMongoSort(spec.sort, '') : { openTime: -1 })
      .skip(spec.skip ?? 0)
      .limit(spec.limit ?? 50)
      .toArray(),
    candles.countDocuments(filtro),
    candles.find(escopo, { projection: { openTime: 1 } }).sort({ openTime: -1 }).limit(1).next(),
  ])

  return {
    rows: linhas as Record<string, unknown>[],
    total,
    freshness: (ultimo?.openTime as Date) ?? null,
    truncated: total > (spec.skip ?? 0) + linhas.length,
  }
}

export interface RunQueryInput {
  accountId: string
  dataStoreId: ObjectId
  datasetKey: string
  query: unknown
  agentId?: ObjectId | null
}

/**
 * A consulta, do pedido bruto ao resultado — com o log do que aconteceu.
 *
 * O log guarda store, dataset, quem, quantas linhas e quanto tempo. Nunca o conteúdo: uma
 * telemetria que copia a resposta é uma segunda base de dados sem dono e sem cota.
 */
export async function runQuery(input: RunQueryInput): Promise<QueryResult> {
  const inicio = Date.now()
  const store = await getDataStore(input.accountId, input.dataStoreId)
  if (!store) throw new AdapterError('database não encontrado', 'not_found')
  const dataset = await getDataset(input.accountId, input.dataStoreId, input.datasetKey)
  if (!dataset) throw new AdapterError('dataset não encontrado', 'not_found')

  let spec: QuerySpec
  try {
    spec = parseQuery(input.query, dataset.schema)
  } catch (erro) {
    await logQuery({
      ownerId: input.accountId,
      dataStoreId: input.dataStoreId,
      datasetKey: input.datasetKey,
      agentId: input.agentId ?? null,
      capability: 'query',
      durationMs: Date.now() - inicio,
      rows: 0,
      ok: false,
      errorCode: erro instanceof QueryDslError ? erro.code : 'invalid_query',
    })
    throw erro
  }

  const executar = store.adapterKind === 'market_data' ? queryMarketData : queryDataHistory
  if (store.adapterKind === 'external_app') {
    throw new AdapterError('consulta a App externo ainda não está disponível', 'not_implemented')
  }

  try {
    const r = await executar(store, dataset, spec)
    await logQuery({
      ownerId: input.accountId,
      dataStoreId: input.dataStoreId,
      datasetKey: input.datasetKey,
      agentId: input.agentId ?? null,
      capability: 'query',
      durationMs: Date.now() - inicio,
      rows: r.rows.length,
      ok: true,
    })
    return r
  } catch (erro) {
    await logQuery({
      ownerId: input.accountId,
      dataStoreId: input.dataStoreId,
      datasetKey: input.datasetKey,
      agentId: input.agentId ?? null,
      capability: 'query',
      durationMs: Date.now() - inicio,
      rows: 0,
      ok: false,
      errorCode: 'adapter_error',
    })
    throw erro
  }
}

/**
 * A inserção — validada contra o SCHEMA do dataset antes de qualquer escrita.
 *
 * Sem a validação, um registro com forma errada entra e só aparece como problema na
 * consulta seguinte, quando ninguém lembra de onde ele veio. E `data_history` é o único
 * destino de escrita: mercado é somente leitura por decisão de produto, não por omissão.
 */
export async function runInsert(input: RunQueryInput & { rows: Record<string, unknown>[] }): Promise<{ inserted: number }> {
  const store = await getDataStore(input.accountId, input.dataStoreId)
  if (!store) throw new AdapterError('database não encontrado', 'not_found')
  if (store.adapterKind !== 'data_history') throw new AdapterError('este database não aceita escrita', 'read_only')
  const dataset = await getDataset(input.accountId, input.dataStoreId, input.datasetKey)
  if (!dataset) throw new AdapterError('dataset não encontrado', 'not_found')

  const { validateAgainstSchema } = await import('./schemaValidation.js')
  const linhas = input.rows.slice(0, 100)
  for (const [i, linha] of linhas.entries()) {
    const erro = validateAgainstSchema(linha, dataset.schema)
    if (erro) throw new AdapterError(`linha ${i + 1}: ${erro}`, 'schema_violation')
  }

  const recorderId = String(store.adapterConfig.recorderId ?? '')
  if (!ObjectId.isValid(recorderId)) throw new AdapterError('este database não aponta para um histórico válido', 'bad_config')

  const agora = new Date()
  const docs = linhas.map((value, i) => ({
    _id: new ObjectId(),
    ownerId: input.accountId,
    recorderId: new ObjectId(recorderId),
    sourceKey: `datastore:${input.dataStoreId.toString()}`,
    entityKey: dataset.primaryKey?.length ? dataset.primaryKey.map((k) => String(value[k] ?? '')).join('|') : null,
    occurredAt: dataset.timeField && value[dataset.timeField] ? new Date(String(value[dataset.timeField])) : agora,
    recordedAt: agora,
    windowStart: null,
    windowEnd: null,
    recordKind: 'raw' as const,
    value,
    schemaVersion: 1,
    dedupeKey: `${input.dataStoreId.toString()}:${input.datasetKey}:${agora.getTime()}:${i}`,
    expiresAt: null,
  }))
  await records.insertMany(docs as never[], { ordered: false })
  await logQuery({
    ownerId: input.accountId,
    dataStoreId: input.dataStoreId,
    datasetKey: input.datasetKey,
    agentId: input.agentId ?? null,
    capability: 'insert',
    durationMs: 0,
    rows: docs.length,
    ok: true,
  })
  return { inserted: docs.length }
}
