import { Router } from 'express'
import { ValidationError } from '../building.js'
import { explicarRecorder, limparCacheDeRecorders } from '../dataHistory/engine.js'
import { catalogoDeFontes } from '../dataHistory/sources.js'
import { adapterDe, destinosDisponiveis } from '../dataHistory/storage/index.js'
import { apagarRecorder, atualizarRecorder, criarRecorder, listarRecorders, normalizarRecorder, obterRecorder, usoDoRecorder } from '../dataHistory/recorders.js'
import { RECORD_KINDS, historyPublic, recorderPublic } from '../dataHistory/types.js'
import type { DataRecorderDefinition, RecordKind } from '../dataHistory/types.js'
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

/**
 * O catálogo de fontes desta conta.
 *
 * Existe para a tela não pedir que alguém copie um id de banco. As conexões são as
 * desta conta; os tipos de evento são do sistema e iguais para todo mundo.
 */
dataHistoryRouter.get('/sources', async (req, res) => {
  res.json(await catalogoDeFontes(res.locals.userId))
})

/**
 * Onde este servidor sabe guardar histórico.
 *
 * Hoje devolve um destino só. A tela lê desta lista mesmo assim: quando o segundo
 * aparecer, ela passa a oferecê-lo sem mudar uma linha.
 */
dataHistoryRouter.get('/storages', (_req, res) => {
  res.json(destinosDisponiveis())
})

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

    /**
     * A prévia usa um recorder DE VERDADE, e desligado.
     *
     * De verdade porque o motor conta cota no próprio documento: um id que não existe
     * no banco faria toda amostra responder "limite atingido", que é uma resposta
     * falsa. Desligado (`enabled: false`) porque o motor só considera regras ligadas —
     * então, mesmo que esta requisição morra no meio e o documento sobre, ele não grava
     * nada de ninguém. O `finally` abaixo o remove junto com o que ele produziu.
     */
    const falso: DataRecorderDefinition = {
      _id: new ObjectId(),
      ownerId: res.locals.userId,
      ...def,
      enabled: false,
      recordCount: 0,
      lastRecordAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const { recordersCollection } = await import('../dataHistory/store.js')
    await recordersCollection.insertOne(falso)
    const limpar = async (): Promise<void> => {
      const { recordsCollection, windowsCollection, recordersCollection: regras } = await import('../dataHistory/store.js')
      await recordsCollection.deleteMany({ recorderId: falso._id }).catch(() => undefined)
      await windowsCollection.deleteMany({ recorderId: falso._id }).catch(() => undefined)
      await regras.deleteOne({ _id: falso._id }).catch(() => undefined)
    }
    try {
    const decisoes: Record<string, unknown>[] = []
    const agora = new Date()
    for (const [index, amostra] of amostras.entries()) {
      const valor = (amostra ?? {}) as Record<string, unknown>
      const d = await explicarRecorder(falso, {
        ownerId: res.locals.userId,
        sourceKey: `${def.source.kind}:${def.source.ref}`,
        entityKey: null,
        occurredAt: agora,
        value: valor,
      }, agora).catch((error) => ({
        resultado: 'erro',
        motivo: String((error as Error).message ?? error).slice(0, 200),
        entityKey: null,
        occurredAt: agora.toISOString(),
        valor: null,
      }))
      decisoes.push({ index, ...d })
    }

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
      // A limpeza vem ANTES da resposta, e não depois: quem chamou continua assim que
      // ela sai, e um teste — ou uma tela — que consultasse em seguida ainda veria a
      // regra de mentira no banco. "Não deixa rastro" só é verdade se já não houver
      // rastro quando a resposta chega.
      await limpar()
      res.json({ decisions: decisoes, records: gravados.map(historyPublic), windows: janelas })
    } finally {
      // E de novo no caminho de erro. Apagar duas vezes é apagar uma.
      await limpar()
    }
  } catch (error) {
    recusar(res, error, next)
  }
})

// --- leitura do histórico ---------------------------------------------------------

dataHistoryRouter.get('/recorders/:id/keys', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const rec = await obterRecorder(res.locals.userId, id)
  if (!rec) return notFound(res)
  res.json(await adapterDe(rec).chaves(res.locals.userId, id))
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
  const rec = await obterRecorder(res.locals.userId, id)
  if (!rec) return notFound(res)
  const q = req.query as Record<string, unknown>
  const kind = RECORD_KINDS.includes(String(q.recordKind ?? '') as RecordKind) ? (String(q.recordKind) as RecordKind) : null
  const consulta = {
    recorderId: id,
    entityKey: q.entityKey ? String(q.entityKey) : null,
    ...periodo(q),
    recordKind: kind,
    limit: Number(q.limit ?? 100),
    skip: Number(q.skip ?? 0),
    order: q.order === 'asc' ? ('asc' as const) : ('desc' as const),
  }
  // A leitura sai pelo MESMO adapter que gravou: trocar o destino não pode mudar o que
  // a tela sabe perguntar.
  const armazem = adapterDe(rec)
  const [rs, total] = await Promise.all([armazem.listar(res.locals.userId, consulta), armazem.contar(res.locals.userId, consulta)])
  // `count` é o que veio nesta página; `total` é quanto existe. Sem os dois, a tela
  // não tem como dizer "mostrando 100 de 4.312".
  res.json({ count: rs.length, total, skip: consulta.skip, items: rs.map(historyPublic) })
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
    const kind = RECORD_KINDS.includes(String(q.recordKind ?? '') as RecordKind) ? (String(q.recordKind) as RecordKind) : null
    const r = await adapterDe(rec).agregar(
      res.locals.userId,
      { recorderId: id, entityKey: q.entityKey ? String(q.entityKey) : null, ...periodo(q), recordKind: kind },
      regras,
    )
    res.json({ result: r })
  } catch (error) {
    recusar(res, error, next)
  }
})
