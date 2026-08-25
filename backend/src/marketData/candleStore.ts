import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { AGGREGATES_TO, bucketIsOver, bucketStart } from './timeframes.js'
import type { StoredCandle, Timeframe, Trade } from './types.js'

// As velas. Uma coleção só, com o timeframe no documento: seis coleções seriam seis
// lugares para a mesma consulta divergir.
const candles = db.collection<StoredCandle>('market_candles')

/** Quanto tempo uma vela fechada fica guardada. */
export const CANDLE_RETENTION_DAYS = Number(process.env.CANDLE_RETENTION_DAYS ?? 30)

export async function ensureCandleIndexes(): Promise<void> {
  // A identidade da vela — e a garantia de que ela existe uma vez só, mesmo com dois
  // workers dobrando a mesma série ao mesmo tempo.
  await candles.createIndex(
    { ownerId: 1, provider: 1, installationId: 1, environment: 1, symbol: 1, timeframe: 1, bucketStart: 1 },
    { unique: true },
  )
  // A leitura de série: os últimos N fechados de um ativo num timeframe.
  await candles.createIndex({ ownerId: 1, symbol: 1, timeframe: 1, closed: 1, bucketStart: -1 })
  // A varredura do fechamento: o que está aberto e já passou da hora.
  await candles.createIndex({ closed: 1, bucketStart: 1 })
  await candles.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

export interface SeriesKey {
  ownerId: string
  provider: string
  installationId: string
  environment: string
  symbol: string
}

const chave = (k: SeriesKey, timeframe: Timeframe, bucket: number) => ({
  ownerId: k.ownerId,
  provider: k.provider,
  installationId: k.installationId,
  environment: k.environment,
  symbol: k.symbol,
  timeframe,
  bucketStart: bucket,
})

/**
 * Dobrar um negócio na vela do balde dele.
 *
 * Tudo num `findOneAndUpdate`: `$max`/`$min` para máxima e mínima, `$inc` para volume.
 * Fazer isso em memória e gravar depois seria perder um negócio toda vez que dois
 * chegassem juntos — e é exatamente quando chegam juntos que o preço está se mexendo.
 *
 * A ABERTURA é a parte que o banco não resolve sozinho: `$setOnInsert` grava a
 * primeira que chegar, que é a certa quando os negócios chegam em ordem. Um negócio
 * ATRASADO, anterior à abertura gravada, é corrigido no passo seguinte.
 */
export async function foldTrade(k: SeriesKey, trade: Trade, now = new Date()): Promise<{ candle: StoredCandle; late: boolean } | null> {
  const bucket = bucketStart(trade.at, '1m')
  const filtro = chave(k, '1m', bucket)

  // Uma vela FECHADA não reabre. Um negócio atrasado que a mudasse mudaria um número
  // que alguém já usou para decidir — e o candle fechado é publicado como fato.
  const fechada = await candles.findOne({ ...filtro, closed: true }, { projection: { _id: 1 } })
  if (fechada) return null

  const r = await candles.findOneAndUpdate(
    filtro,
    {
      $setOnInsert: { ...filtro, open: trade.price, openedFrom: trade.at.getTime(), createdAt: now, closedAt: null, expiresAt: null },
      $max: { high: trade.price },
      $min: { low: trade.price },
      $set: { close: trade.price, closed: false, updatedAt: now },
      $inc: { volume: trade.size, trades: 1 },
    },
    { upsert: true, returnDocument: 'after' },
  )
  const candle = r as StoredCandle

  // O negócio chegou fora de ordem e é ANTERIOR ao que abriu a vela: a abertura estava
  // errada, e é a única coisa que precisa de conserto — máxima, mínima e volume já
  // entraram certos, porque não dependem da ordem.
  const late = trade.at.getTime() < (candle.openedFrom ?? trade.at.getTime())
  if (!late) return { candle, late: false }
  const corrigido = await candles.findOneAndUpdate(
    { _id: candle._id, openedFrom: { $gt: trade.at.getTime() } },
    { $set: { open: trade.price, openedFrom: trade.at.getTime() } },
    { returnDocument: 'after' },
  )
  return { candle: (corrigido as StoredCandle) ?? candle, late: true }
}

/**
 * Fechar uma vela — no máximo uma vez.
 *
 * O filtro tem `closed: false`: dois workers varrendo ao mesmo tempo, só um recebe
 * documento de volta, e só ele publica. Não é otimismo, é o único jeito de "fechar
 * exatamente uma vez" sem um lock.
 */
export async function closeCandle(id: ObjectId, now = new Date()): Promise<StoredCandle | null> {
  const r = await candles.findOneAndUpdate(
    { _id: id, closed: false },
    {
      $set: {
        closed: true,
        closedAt: now,
        // Fechada e AINDA NÃO publicada. É esta marca que a varredura procura depois —
        // sem ela, uma queda entre fechar e publicar deixava a vela muda para sempre.
        publishedAt: null,
        foldedAt: null,
        expiresAt: new Date(now.getTime() + CANDLE_RETENTION_DAYS * 86_400_000),
        updatedAt: now,
      },
    },
    { returnDocument: 'after' },
  )
  return (r as StoredCandle) ?? null
}

/** O evento desta vela saiu. Idempotente: marcar duas vezes é marcar uma. */
export async function markPublished(id: ObjectId, now = new Date()): Promise<void> {
  await candles.updateOne({ _id: id }, { $set: { publishedAt: now, updatedAt: now } })
}

export async function markFolded(id: ObjectId, now = new Date()): Promise<void> {
  await candles.updateOne({ _id: id }, { $set: { foldedAt: now, updatedAt: now } })
}

/**
 * O que ficou pela metade: vela fechada sem evento, ou fechada sem ter subido.
 *
 * É a retomada. Uma execução que morre no meio não perde o trabalho — ela deixa uma
 * marca que a próxima varredura encontra.
 */
export function pendingCandles(limit = 200): Promise<StoredCandle[]> {
  return candles
    .find({ closed: true, $or: [{ publishedAt: null }, { foldedAt: null }] })
    .sort({ bucketStart: 1 })
    .limit(limit)
    .toArray()
}

/** As velas abertas cujo balde já acabou. É a varredura que fecha a última do dia. */
export function dueCandles(now = new Date(), limit = 200): Promise<StoredCandle[]> {
  // Sem `$expr` sobre o timeframe: o balde mais longo é 1D, então tudo que começou há
  // mais de um dia certamente acabou, e o resto é conferido em memória.
  return candles
    .find({ closed: false, bucketStart: { $lte: now.getTime() } })
    .sort({ bucketStart: 1 })
    .limit(limit)
    .toArray()
}

export const isDue = (c: StoredCandle, now = new Date()): boolean => bucketIsOver(c.bucketStart, c.timeframe, now)

/**
 * Dobrar uma vela fechada na vela maior que a contém.
 *
 * A abertura da vela-mãe é a da PRIMEIRA filha, e o fechamento é o da última — por
 * isso a abertura só é gravada na inserção e o fechamento é comparado por tempo, e não
 * sobrescrito às cegas: as filhas podem ser dobradas fora de ordem depois de um
 * restart.
 */
export async function foldChild(k: SeriesKey, child: StoredCandle, now = new Date()): Promise<StoredCandle[]> {
  const resultado: StoredCandle[] = []
  for (const alvo of AGGREGATES_TO[child.timeframe]) {
    const mae = await dobrarUma(k, alvo, child, now)
    if (mae) resultado.push(mae)
  }
  return resultado
}

/**
 * Dobrar UMA filha na vela maior, no máximo uma vez.
 *
 * O `$inc` do volume não é idempotente, e uma retomada depois de uma queda dobra de
 * novo por definição — era assim que o volume dobrava sozinho. A guarda é
 * `foldedChildren` no FILTRO: a filha que já entrou não casa, e nada é somado.
 *
 * Não dá para fazer isso com `upsert` no mesmo update: quando a mãe existe E já tem a
 * filha, o filtro não casa e o Mongo tenta INSERIR — batendo no índice único. O erro
 * que saía dali era de chave duplicada, que não tem nada a ver com o que aconteceu
 * (a filha já estava dobrada).
 */
async function dobrarUma(k: SeriesKey, alvo: Timeframe, child: StoredCandle, now: Date): Promise<StoredCandle | null> {
  const bucket = bucketStart(child.bucketStart, alvo)
  const filtro = chave(k, alvo, bucket)
  const atualizacao = {
    $max: { high: child.high, lastChildAt: child.bucketStart },
    $min: { low: child.low, openedFrom: child.bucketStart },
    $set: { closed: false, updatedAt: now },
    $inc: { volume: child.volume },
    $addToSet: { foldedChildren: child.bucketStart },
  }

  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const r = await candles.findOneAndUpdate({ ...filtro, foldedChildren: { $ne: child.bucketStart } }, atualizacao, { returnDocument: 'after' })
    if (r) return ajustarPontas(r as StoredCandle, child)

    const existente = await candles.findOne(filtro)
    // A mãe existe e já tem esta filha: nada a fazer, e nada a somar.
    if (existente) return existente as StoredCandle

    try {
      await candles.insertOne({
        ...filtro,
        open: child.open,
        high: child.high,
        low: child.low,
        close: child.close,
        volume: child.volume,
        trades: 0,
        closed: false,
        closedAt: null,
        expiresAt: null,
        publishedAt: null,
        foldedAt: null,
        foldedChildren: [child.bucketStart],
        openedFrom: child.bucketStart,
        lastChildAt: child.bucketStart,
        createdAt: now,
        updatedAt: now,
      } as StoredCandle)
      return candles.findOne(filtro) as Promise<StoredCandle>
    } catch (error) {
      // Outra dobra inseriu entre a nossa leitura e a nossa escrita. Volta e tenta o
      // update guardado, que agora vai encontrar documento.
      if ((error as { code?: number }).code !== 11000) throw error
    }
  }
  return candles.findOne(filtro) as Promise<StoredCandle | null>
}

/**
 * Abertura e fechamento não acumulam: eles são de UMA filha cada.
 *
 * A abertura é da mais antiga já vista, o fechamento é da mais recente — por isso os
 * dois são conferidos contra as marcas, e não sobrescritos às cegas: depois de um
 * restart as filhas podem ser dobradas em qualquer ordem.
 */
async function ajustarPontas(mae: StoredCandle, child: StoredCandle): Promise<StoredCandle> {
  const set: Record<string, unknown> = {}
  if (mae.openedFrom === child.bucketStart) set.open = child.open
  if ((mae.lastChildAt ?? -1) === child.bucketStart) set.close = child.close
  if (!Object.keys(set).length) return mae
  const r = await candles.findOneAndUpdate({ _id: mae._id }, { $set: set }, { returnDocument: 'after' })
  return (r as StoredCandle) ?? mae
}

/** A série fechada, do mais antigo para o mais novo — a ordem que o analisador espera. */
export async function closedSeries(
  ownerId: string,
  q: { symbol: string; timeframe: Timeframe; provider?: string; installationId?: string; limit?: number },
): Promise<StoredCandle[]> {
  const filtro: Record<string, unknown> = { ownerId, symbol: q.symbol, timeframe: q.timeframe, closed: true }
  if (q.provider) filtro.provider = q.provider
  if (q.installationId) filtro.installationId = q.installationId
  const docs = await candles
    .find(filtro)
    .sort({ bucketStart: -1 })
    .limit(Math.min(q.limit ?? 100, 500))
    .toArray()
  return docs.reverse()
}

export const findCandle = (k: SeriesKey, timeframe: Timeframe, bucket: number): Promise<StoredCandle | null> =>
  candles.findOne(chave(k, timeframe, bucket))

export const candlesCollection = candles
