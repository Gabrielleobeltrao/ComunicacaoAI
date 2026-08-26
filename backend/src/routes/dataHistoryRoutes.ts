import { Router } from 'express'
import { ValidationError } from '../building.js'
import { aplicarRecorder, limparCacheDeRecorders } from '../dataHistory/engine.js'
import { agregarRegistros, chavesDoRecorder, listarRegistros } from '../dataHistory/store.js'
import { apagarRecorder, atualizarRecorder, criarRecorder, listarRecorders, normalizarRecorder, obterRecorder, usoDoRecorder } from '../dataHistory/recorders.js'
import { historyPublic, recorderPublic } from '../dataHistory/types.js'
import type { DataRecorderDefinition } from '../dataHistory/types.js'
import { auditEntity } from './auditMiddleware.js'
import { notFound, oid } from './http.js'
import { ObjectId } from 'mongodb'

/**
 * O histórico genérico, para a tela.
 *
 * Toda rota daqui é do DONO: o id vem do cliente, mas nunca é usado sem o dono no
 * filtro. O que sai é configuração e dado gravado — nunca credencial, porque uma
 * definição de histórico não tem nenhuma para dar.
 */
export const dataHistoryRouter = Router()

const recusar = (res: Parameters<typeof notFound>[0], error: unknown, next: (e?: unknown) => void): void => {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: 'invalid', message: error.message })
    return
  }
  next(error)
}

dataHistoryRouter.get('/recorders', async (req, res) => {
  const lista = await listarRecorders(res.locals.userId)
  res.json(lista.map(recorderPublic))
})

dataHistoryRouter.post('/recorders', async (req, res, next) => {
  try {
    const rec = await criarRecorder(res.locals.userId, (req.body ?? {}) as Record<string, unknown>)
    limparCacheDeRecorders()
    auditEntity(res, { id: rec._id.toString(), label: rec.name })
    res.status(201).json(recorderPublic(rec))
  } catch (error) {
    recusar(res, error, next)
  }
})

dataHistoryRouter.get('/recorders/:id', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const rec = await obterRecorder(res.locals.userId, id)
  if (!rec) return notFound(res)
  res.json({ ...recorderPublic(rec), storedRecords: await usoDoRecorder(res.locals.userId, id) })
})

dataHistoryRouter.patch('/recorders/:id', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const rec = await atualizarRecorder(res.locals.userId, id, (req.body ?? {}) as Record<string, unknown>)
    if (!rec) return notFound(res)
    limparCacheDeRecorders()
    auditEntity(res, { id: rec._id.toString(), label: rec.name })
    res.json(recorderPublic(rec))
  } catch (error) {
    recusar(res, error, next)
  }
})

dataHistoryRouter.delete('/recorders/:id', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const rec = await obterRecorder(res.locals.userId, id)
  if (!rec) return notFound(res)
  await apagarRecorder(res.locals.userId, id)
  limparCacheDeRecorders()
  auditEntity(res, { id, label: rec.name })
  res.status(204).end()
})

/**
 * A PRÉVIA: o que esta configuração faria com estes dados, sem gravar nada.
 *
 * Ela roda o motor de verdade — a mesma validação, os mesmos filtros, a mesma
 * agregação — contra um recorder que existe só na memória desta requisição. Uma prévia
 * que usasse outro caminho prometeria um resultado que o motor não daria.
 */
dataHistoryRouter.post('/preview', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { recorder?: Record<string, unknown>; samples?: unknown }
    const def = normalizarRecorder((body.recorder ?? {}) as Record<string, unknown>)
    const amostras = Array.isArray(body.samples) ? body.samples.slice(0, 50) : []
    if (!amostras.length) {
      res.status(400).json({ error: 'invalid', message: 'envie ao menos uma amostra para a prévia.' })
      return
    }

    const falso: DataRecorderDefinition = {
      _id: new ObjectId(),
      ownerId: res.locals.userId,
      ...def,
      recordCount: 0,
      lastRecordAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    // Um id que não existe no banco: nada é gravado, e as janelas de teste vivem e
    // morrem dentro desta requisição.
    const decisoes: { index: number; resultado: string }[] = []
    const agora = new Date()
    for (const [index, amostra] of amostras.entries()) {
      const valor = (amostra ?? {}) as Record<string, unknown>
      const resultado = await aplicarRecorder(falso, {
        ownerId: res.locals.userId,
        sourceKey: `${def.source.kind}:${def.source.ref}`,
        entityKey: null,
        occurredAt: agora,
        value: valor,
      }, agora).catch(() => 'erro')
      decisoes.push({ index, resultado })
    }

    // As janelas e registros de mentira saem junto: a prévia não deixa rastro.
    const { recordsCollection, windowsCollection } = await import('../dataHistory/store.js')
    const gravados = await recordsCollection.find({ recorderId: falso._id }).sort({ occurredAt: 1 }).toArray()
    const abertas = await windowsCollection.find({ recorderId: falso._id }).toArray()
    const { valorDaJanela } = await import('../dataHistory/windows.js')
    const janelas = abertas.map((j) => ({
      entityKey: j.entityKey,
      windowStart: j.windowStart.toISOString(),
      windowEnd: j.windowEnd.toISOString(),
      count: j.count,
      value: valorDaJanela(j, def.aggregations),
    }))
    await recordsCollection.deleteMany({ recorderId: falso._id })
    await windowsCollection.deleteMany({ recorderId: falso._id })

    res.json({ decisions: decisoes, records: gravados.map(historyPublic), windows: janelas })
  } catch (error) {
    recusar(res, error, next)
  }
})

// --- leitura do histórico ---------------------------------------------------------

dataHistoryRouter.get('/recorders/:id/keys', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  if (!(await obterRecorder(res.locals.userId, id))) return notFound(res)
  res.json(await chavesDoRecorder(res.locals.userId, id))
})

const periodo = (q: Record<string, unknown>) => {
  const ler = (v: unknown): Date | undefined => {
    if (!v) return undefined
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  return { from: ler(q.from), to: ler(q.to) }
}

dataHistoryRouter.get('/recorders/:id/records', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  if (!(await obterRecorder(res.locals.userId, id))) return notFound(res)
  const q = req.query as Record<string, unknown>
  const rs = await listarRegistros(res.locals.userId, {
    recorderId: id,
    entityKey: q.entityKey ? String(q.entityKey) : null,
    ...periodo(q),
    limit: Number(q.limit ?? 100),
    order: q.order === 'asc' ? 'asc' : 'desc',
  })
  res.json({ count: rs.length, items: rs.map(historyPublic) })
})

dataHistoryRouter.get('/recorders/:id/aggregate', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const rec = await obterRecorder(res.locals.userId, id)
  if (!rec) return notFound(res)
  try {
    const q = req.query as Record<string, unknown>
    // Sem regras na consulta, valem as do próprio recorder — é o que a tela quer
    // mostrar quando alguém abre um histórico agregado.
    const regras = rec.aggregations.length ? rec.aggregations : [{ from: '', op: 'count' as const, to: 'total' }]
    const r = await agregarRegistros(res.locals.userId, { recorderId: id, entityKey: q.entityKey ? String(q.entityKey) : null, ...periodo(q) }, regras)
    res.json({ result: r })
  } catch (error) {
    recusar(res, error, next)
  }
})
