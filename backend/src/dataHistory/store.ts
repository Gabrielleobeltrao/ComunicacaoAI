import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { MAX_QUERY_LIMIT, MAX_VALUE_BYTES, MAX_VALUE_DEPTH } from './types.js'
import type { AggregationOp, DataHistoryRecord, DataRecorderDefinition, OpenWindow } from './types.js'

/**
 * Onde o histórico mora.
 *
 * Três coleções, e cada uma com um trabalho: as DEFINIÇÕES (o que gravar), os
 * REGISTROS (o que foi gravado) e as JANELAS ABERTAS (o que está sendo acumulado). A
 * terceira existe no banco, e não na memória, porque é ela que precisa sobreviver a um
 * restart e a dois workers ao mesmo tempo.
 */
const recorders = db.collection<DataRecorderDefinition>('data_recorders')
const records = db.collection<DataHistoryRecord>('data_history_records')
const windows = db.collection<OpenWindow>('data_history_windows')

export const recordersCollection = recorders
export const recordsCollection = records
export const windowsCollection = windows

export async function ensureDataHistoryIndexes(): Promise<void> {
  await recorders.createIndex({ ownerId: 1, enabled: 1 })
  // A busca do motor a cada fato: quem grava ESTA fonte, deste dono.
  await recorders.createIndex({ ownerId: 1, 'source.kind': 1, 'source.ref': 1, enabled: 1 })

  // A consulta que todo mundo faz: a série de uma entidade num período.
  await records.createIndex({ ownerId: 1, recorderId: 1, entityKey: 1, occurredAt: -1 })
  // A identidade do registro. É ela que faz gravar duas vezes gravar uma — um evento
  // reentregue depois de um restart, uma janela fechada por dois workers.
  await records.createIndex({ dedupeKey: 1 }, { unique: true })
  // Retenção: o Mongo apaga sozinho quando `expiresAt` passa. Nulo nunca expira.
  await records.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })

  // A janela desta entidade neste instante — e a garantia de que existe uma só.
  await windows.createIndex({ recorderId: 1, entityKey: 1, windowStart: 1 }, { unique: true })
  // A varredura: o que já venceu e ainda não fechou, e o que fechou e não foi gravado.
  await windows.createIndex({ closed: 1, windowEnd: 1 })
  await windows.createIndex({ closed: 1, persistedAt: 1 })
}

/**
 * O valor, cortado no tamanho e na profundidade — e sem nada que mexa no protótipo.
 *
 * Um payload de fora não tem limite nenhum: um objeto aninhado cem níveis ou de dois
 * megabytes chegaria inteiro ao banco, e depois à tela de quem for consultar. O corte é
 * aqui, na entrada, e não em cada lugar que lê.
 */
const PROIBIDOS = new Set(['__proto__', 'constructor', 'prototype'])

export function sanearValor(bruto: unknown, profundidade = 0): unknown {
  if (profundidade > MAX_VALUE_DEPTH) return null
  if (bruto === null || bruto === undefined) return null
  const t = typeof bruto
  if (t === 'string' || t === 'number' || t === 'boolean') return bruto
  if (bruto instanceof Date) return bruto.toISOString()
  if (Array.isArray(bruto)) return bruto.slice(0, 200).map((v) => sanearValor(v, profundidade + 1))
  if (t !== 'object') return null
  const fora: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
    if (PROIBIDOS.has(k)) continue
    fora[k] = sanearValor(v, profundidade + 1)
  }
  return fora
}

/** Cabe? Um valor grande demais é recusado, e não cortado pela metade. */
export const cabeNoLimite = (valor: unknown): boolean => {
  try {
    return JSON.stringify(valor ?? null).length <= MAX_VALUE_BYTES
  } catch {
    // Ciclo, BigInt, função: não é dado, é acidente.
    return false
  }
}

/**
 * Grava um registro — no máximo uma vez.
 *
 * `insertOne` com índice único em `dedupeKey`: o segundo insert com a mesma chave falha
 * com E11000, e isso é resposta, não erro. É o que faz um evento reentregue, uma janela
 * fechada por dois workers e um restart no meio da gravação não criarem duplicata.
 */
export async function inserirRegistro(doc: Omit<DataHistoryRecord, '_id'>): Promise<'gravado' | 'repetido'> {
  try {
    await records.insertOne({ _id: new ObjectId(), ...doc } as DataHistoryRecord)
    return 'gravado'
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return 'repetido'
    throw error
  }
}

export const contarRegistros = (ownerId: string, recorderId: ObjectId): Promise<number> => records.countDocuments({ ownerId, recorderId })

// --- leitura ---------------------------------------------------------------------
// Tudo com o dono no filtro, sempre. Não existe consulta sem dono aqui.

export interface RangeQuery {
  recorderId: ObjectId
  entityKey?: string | null
  from?: Date
  to?: Date
  limit?: number
  order?: 'asc' | 'desc'
}

const filtroDe = (ownerId: string, q: RangeQuery): Record<string, unknown> => {
  const f: Record<string, unknown> = { ownerId, recorderId: q.recorderId }
  if (q.entityKey !== undefined && q.entityKey !== null) f.entityKey = q.entityKey
  if (q.from || q.to) {
    const janela: Record<string, Date> = {}
    if (q.from) janela.$gte = q.from
    if (q.to) janela.$lte = q.to
    f.occurredAt = janela
  }
  return f
}

export function listarRegistros(ownerId: string, q: RangeQuery): Promise<DataHistoryRecord[]> {
  const limite = Math.min(Math.max(1, q.limit ?? 100), MAX_QUERY_LIMIT)
  return records
    .find(filtroDe(ownerId, q))
    .sort({ occurredAt: q.order === 'asc' ? 1 : -1 })
    .limit(limite)
    .toArray()
}

export const ultimoRegistro = (ownerId: string, recorderId: ObjectId, entityKey: string | null): Promise<DataHistoryRecord | null> =>
  records.findOne({ ownerId, recorderId, ...(entityKey === null ? {} : { entityKey }) }, { sort: { occurredAt: -1 } })

/**
 * A agregação sobre o histórico JÁ GRAVADO — pelo próprio Mongo.
 *
 * Não é a mesma coisa que o agregador de janela: aquele acumula fato a fato enquanto a
 * janela está aberta; este responde "qual foi a média de janeiro" sobre o que já está
 * lá. Um pipeline do banco, sem trazer as linhas para cá — uma série de um ano não
 * cabe na memória do processo e não precisa caber.
 */
export async function agregarRegistros(
  ownerId: string,
  q: RangeQuery,
  regras: { from: string; op: AggregationOp; to: string }[],
): Promise<Record<string, unknown>> {
  if (!regras.length) return {}
  const grupo: Record<string, unknown> = { _id: null }
  for (const r of regras) {
    const campo = `$value.${r.from}`
    if (r.op === 'count') grupo[r.to] = { $sum: 1 }
    else if (r.op === 'sum') grupo[r.to] = { $sum: campo }
    else if (r.op === 'avg') grupo[r.to] = { $avg: campo }
    else if (r.op === 'min') grupo[r.to] = { $min: campo }
    else if (r.op === 'max') grupo[r.to] = { $max: campo }
    // `first` e `last` pelo tempo do FATO: o `$sort` abaixo é por `occurredAt`, então
    // o primeiro do grupo é o mais antigo e o último é o mais recente — e não o que
    // chegou primeiro ou por último até nós.
    else if (r.op === 'first') grupo[r.to] = { $first: campo }
    else if (r.op === 'last') grupo[r.to] = { $last: campo }
  }
  const [linha] = await records.aggregate([{ $match: filtroDe(ownerId, q) }, { $sort: { occurredAt: 1 } }, { $group: grupo }]).toArray()
  if (!linha) return {}
  const { _id, ...resto } = linha as Record<string, unknown>
  void _id
  return resto
}

/** As chaves que este recorder já viu. É o que a tela oferece para escolher. */
export const chavesDoRecorder = (ownerId: string, recorderId: ObjectId, limite = 200): Promise<unknown[]> =>
  records.distinct('entityKey', { ownerId, recorderId }).then((cs) => cs.slice(0, limite))

export const apagarHistoricoDe = async (ownerId: string, recorderId: ObjectId): Promise<void> => {
  await records.deleteMany({ ownerId, recorderId })
  await windows.deleteMany({ ownerId, recorderId })
}
