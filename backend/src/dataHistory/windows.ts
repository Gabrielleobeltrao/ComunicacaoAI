import { ObjectId } from 'mongodb'
import { readPath } from '../automations/conditions.js'
import { windowsCollection as windows } from './store.js'
import type { AggregationRule, DataRecorderDefinition, OpenWindow } from './types.js'

/**
 * A agregação por janela — no banco, e não na memória.
 *
 * Cada fato é dobrado na janela com operadores atômicos do próprio Mongo (`$min`,
 * `$max`, `$inc`). Isso resolve três coisas de uma vez, e nenhuma delas por acaso:
 * dois workers dobrando o mesmo fato não brigam, um restart no meio não perde o
 * acumulado, e a ordem de chegada deixa de importar para mínimo, máximo e soma.
 *
 * `first` e `last` precisam de mais, porque dependem de QUANDO o fato aconteceu. Eles
 * são corrigidos por dois updates condicionais — `firstAt > t` e `lastAt <= t` —, que é
 * o que permite um fato atrasado consertar a abertura de uma janela que já tinha
 * começado com outro valor.
 */

/** O começo da janela que contém este instante. Sempre alinhada, sempre UTC. */
export const inicioDaJanela = (at: Date | number, intervalMs: number): number => {
  const t = typeof at === 'number' ? at : at.getTime()
  return Math.floor(t / intervalMs) * intervalMs
}

const numero = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** O que cada regra extrai deste fato. `count` não lê campo nenhum: ele conta. */
function leituras(valor: Record<string, unknown>, regras: readonly AggregationRule[]) {
  return regras.map((r) => ({ regra: r, lido: r.op === 'count' ? 1 : readPath(valor, r.from) }))
}

export interface FoldResult {
  window: OpenWindow
  /** O fato é anterior ao que abriu a janela — a abertura foi corrigida. */
  corrigiuAbertura: boolean
  /** A janela já estava fechada: o fato chegou tarde demais e foi recusado. */
  tardeDemais: boolean
}

/**
 * Dobra um fato na janela dele.
 *
 * Uma janela FECHADA não reabre. Um fato que a mudasse mudaria um número que alguém já
 * leu — e a janela fechada foi publicada como fato consumado. Ele é recusado, e quem
 * chamou fica sabendo.
 */
export async function dobrarNaJanela(
  recorder: DataRecorderDefinition,
  entityKey: string | null,
  occurredAt: Date,
  valor: Record<string, unknown>,
  agora = new Date(),
): Promise<FoldResult | null> {
  const intervalo = recorder.intervalMs
  if (!intervalo) return null
  const inicio = inicioDaJanela(occurredAt, intervalo)
  const t = occurredAt.getTime()
  const filtro = { recorderId: recorder._id, entityKey, windowStart: new Date(inicio) }

  const fechada = await windows.findOne({ ...filtro, closed: true }, { projection: { _id: 1 } })
  if (fechada) return { window: fechada as OpenWindow, corrigiuAbertura: false, tardeDemais: true }

  const lidos = leituras(valor, recorder.aggregations)
  const min: Record<string, number> = {}
  const max: Record<string, number> = {}
  const inc: Record<string, number> = {}
  const primeiros: Record<string, unknown> = {}
  const ultimos: Record<string, unknown> = {}

  for (const { regra, lido } of lidos) {
    const n = numero(lido)
    if (regra.op === 'min' && n !== null) min[`acc.${regra.to}.min`] = n
    else if (regra.op === 'max' && n !== null) max[`acc.${regra.to}.max`] = n
    else if (regra.op === 'sum' && n !== null) inc[`acc.${regra.to}.sum`] = n
    else if (regra.op === 'count') inc[`acc.${regra.to}.count`] = 1
    // A média não é acumulável sozinha: soma e contagem são, e a divisão acontece no
    // fechamento. Guardar uma média parcial e "atualizá-la" daria outro número.
    else if (regra.op === 'avg' && n !== null) {
      inc[`acc.${regra.to}.sum`] = n
      inc[`acc.${regra.to}.count`] = 1
    } else if (regra.op === 'first' && lido !== undefined) primeiros[regra.to] = lido
    else if (regra.op === 'last' && lido !== undefined) ultimos[regra.to] = lido
  }

  const r = await windows.findOneAndUpdate(
    filtro,
    {
      $setOnInsert: {
        ownerId: recorder.ownerId,
        ...filtro,
        windowEnd: new Date(inicio + intervalo),
        firsts: primeiros,
        lasts: ultimos,
        firstAt: t,
        lastAt: t,
        closed: false,
        closedAt: null,
        persistedAt: null,
        createdAt: agora,
      },
      ...(Object.keys(min).length ? { $min: min } : {}),
      ...(Object.keys(max).length ? { $max: max } : {}),
      $inc: { ...inc, count: 1 },
      $set: { updatedAt: agora },
    },
    { upsert: true, returnDocument: 'after' },
  )
  let janela = r as OpenWindow
  // Acabou de nascer com este fato: `first` e `last` já são ele.
  if (janela.firstAt === t && janela.lastAt === t && janela.count === 1) {
    return { window: janela, corrigiuAbertura: false, tardeDemais: false }
  }

  let corrigiu = false
  if (t < janela.firstAt && Object.keys(primeiros).length) {
    // ANTERIOR ao que abriu: a abertura estava errada. Mínimo, máximo e soma já
    // entraram certos — eles não dependem da ordem.
    const c = await windows.findOneAndUpdate(
      { _id: janela._id, closed: false, firstAt: { $gt: t } },
      { $set: { firsts: { ...janela.firsts, ...primeiros }, firstAt: t } },
      { returnDocument: 'after' },
    )
    if (c) {
      janela = c as OpenWindow
      corrigiu = true
    }
  }
  if (t >= janela.lastAt && Object.keys(ultimos).length) {
    const c = await windows.findOneAndUpdate(
      { _id: janela._id, closed: false, lastAt: { $lte: t } },
      { $set: { lasts: { ...janela.lasts, ...ultimos }, lastAt: t } },
      { returnDocument: 'after' },
    )
    if (c) janela = c as OpenWindow
  }
  return { window: janela, corrigiuAbertura: corrigiu, tardeDemais: false }
}

/**
 * Fecha uma janela — no máximo uma vez.
 *
 * O `closed: false` no filtro é o fecho: dois workers varrendo juntos, só um recebe o
 * documento de volta, e só ele grava. Não é otimismo — é como se fecha exatamente uma
 * vez sem um lock.
 */
export async function fecharJanela(id: ObjectId, agora = new Date()): Promise<OpenWindow | null> {
  const r = await windows.findOneAndUpdate(
    { _id: id, closed: false },
    // `persistedAt: null` é a marca que a varredura procura depois: sem ela, uma queda
    // entre fechar e gravar deixaria a janela muda para sempre.
    { $set: { closed: true, closedAt: agora, persistedAt: null, updatedAt: agora } },
    { returnDocument: 'after' },
  )
  return (r as OpenWindow) ?? null
}

/** O registro desta janela saiu. Idempotente: marcar duas vezes é marcar uma. */
export const marcarPersistida = async (id: ObjectId, agora = new Date()): Promise<void> => {
  await windows.updateOne({ _id: id }, { $set: { persistedAt: agora, updatedAt: agora } })
}

/** O que já venceu e ainda não fechou. */
export const janelasVencidas = (agora = new Date(), limite = 200): Promise<OpenWindow[]> =>
  windows.find({ closed: false, windowEnd: { $lte: agora } }).limit(limite).toArray()

/** O que fechou e não chegou a virar registro — a recuperação depois de uma queda. */
export const janelasPendentes = (limite = 200): Promise<OpenWindow[]> =>
  windows.find({ closed: true, persistedAt: null }).limit(limite).toArray()

/**
 * O valor final da janela: o que cada regra produziu.
 *
 * É aqui que a média vira média. Determinístico e sem modelo: a mesma janela, com os
 * mesmos fatos, dá o mesmo objeto — em qualquer worker, em qualquer ordem de chegada.
 */
export function valorDaJanela(janela: OpenWindow, regras: readonly AggregationRule[]): Record<string, unknown> {
  const fora: Record<string, unknown> = {}
  for (const regra of regras) {
    const a = janela.acc?.[regra.to]
    if (regra.op === 'first') fora[regra.to] = janela.firsts?.[regra.to] ?? null
    else if (regra.op === 'last') fora[regra.to] = janela.lasts?.[regra.to] ?? null
    else if (regra.op === 'min') fora[regra.to] = a?.min ?? null
    else if (regra.op === 'max') fora[regra.to] = a?.max ?? null
    else if (regra.op === 'sum') fora[regra.to] = a?.sum ?? 0
    else if (regra.op === 'count') fora[regra.to] = a?.count ?? 0
    else if (regra.op === 'avg') fora[regra.to] = a?.count ? (a.sum ?? 0) / a.count : null
  }
  return fora
}

export const apagarJanelasDe = async (recorderId: ObjectId): Promise<void> => {
  await windows.deleteMany({ recorderId })
}
