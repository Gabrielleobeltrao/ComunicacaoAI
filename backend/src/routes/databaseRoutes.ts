import { Router } from 'express'
import { ObjectId } from 'mongodb'
import {
  DataStoreError,
  createDataset,
  createDataStore,
  deleteDataset,
  deleteDataStore,
  deleteGrant,
  getDataStore,
  listDatasets,
  listDataStores,
  listGrants,
  putGrant,
  updateDataset,
  updateDataStore,
} from '../databases/store.js'
import { resolveDatabaseAccess, assertMutationAllowed } from '../databases/access.js'
import { AdapterError, runInsert, runQuery } from '../databases/adapters.js'
import { QueryDslError } from '../databases/queryDsl.js'
import { DATABASE_CAPABILITIES } from '../databases/types.js'
import type { DatabaseCapability } from '../databases/types.js'
import { resolveSubject } from '../resources/scope.js'
import { notFound, oid } from './http.js'

// AS ROTAS de Database — humanas, com escopo de conta em toda consulta.
//
// A flag nega de verdade: `DATABASES_ENABLED=0` responde 404, e não esconde o botão. Uma
// flag cosmética deixa a rota aberta para quem souber o caminho, que é exatamente quem
// não deveria entrar.

export const databaseRouter = Router()

databaseRouter.use((_req, res, next) => {
  if (process.env.DATABASES_ENABLED === '0') {
    res.status(404).json({ code: 'not_found', message: 'not found' })
    return
  }
  next()
})

const recusa = (res: Parameters<typeof notFound>[0], erro: unknown): boolean => {
  if (erro instanceof DataStoreError) {
    res.status(erro.code === 'not_found' ? 404 : erro.code === 'quota_exceeded' ? 413 : 400).json({ code: erro.code, message: erro.message, error: erro.message })
    return true
  }
  if (erro instanceof QueryDslError) {
    res.status(400).json({ code: erro.code, message: erro.message, error: erro.message })
    return true
  }
  if (erro instanceof AdapterError) {
    res.status(erro.code === 'not_found' ? 404 : 400).json({ code: erro.code, message: erro.message, error: erro.message })
    return true
  }
  return false
}

databaseRouter.get('/', async (_req, res) => {
  const stores = await listDataStores(res.locals.userId)
  const comContagem = await Promise.all(
    stores.map(async (s) => ({
      id: s._id.toString(),
      name: s.name,
      description: s.description,
      adapterKind: s.adapterKind,
      status: s.status,
      retention: s.retention,
      owner: s.owner,
      datasets: (await listDatasets(res.locals.userId, s._id)).length,
      updatedAt: s.updatedAt,
    })),
  )
  res.json({ items: comContagem })
})

databaseRouter.post('/', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const store = await createDataStore(res.locals.userId, {
      name: String(body.name ?? ''),
      description: typeof body.description === 'string' ? body.description : '',
      adapterKind: body.adapterKind as never,
      adapterConfig: (body.adapterConfig ?? {}) as Record<string, unknown>,
      retention: body.retention as never,
    })
    res.status(201).json({ id: store._id.toString(), name: store.name, adapterKind: store.adapterKind, status: store.status })
  } catch (erro) {
    if (recusa(res, erro)) return
    next(erro as Error)
  }
})

databaseRouter.get('/:id', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  const store = await getDataStore(res.locals.userId, id)
  if (!store) return notFound(res)
  const datasets = await listDatasets(res.locals.userId, id)
  res.json({
    id: store._id.toString(),
    name: store.name,
    description: store.description,
    adapterKind: store.adapterKind,
    // A configuração vai junto porque ela é só referência — segredo é recusado na escrita.
    adapterConfig: store.adapterConfig,
    status: store.status,
    retention: store.retention,
    owner: store.owner,
    datasets: datasets.map((d) => ({ key: d.key, name: d.name, mutability: d.mutability, fields: Object.keys((d.schema.properties ?? {}) as object), schema: d.schema })),
    updatedAt: store.updatedAt,
  })
})

databaseRouter.patch('/:id', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const store = await updateDataStore(res.locals.userId, id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      status: body.status as never,
      retention: body.retention as never,
    })
    if (!store) return notFound(res)
    res.json({ id: store._id.toString(), name: store.name, status: store.status })
  } catch (erro) {
    if (recusa(res, erro)) return
    next(erro as Error)
  }
})

databaseRouter.delete('/:id', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  if (!(await deleteDataStore(res.locals.userId, id))) return notFound(res)
  res.status(204).end()
})

// --- datasets ---------------------------------------------------------------------------

databaseRouter.get('/:id/datasets', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id || !(await getDataStore(res.locals.userId, id))) return notFound(res)
  const datasets = await listDatasets(res.locals.userId, id)
  res.json({ items: datasets.map((d) => ({ key: d.key, name: d.name, mutability: d.mutability, schema: d.schema, timeField: d.timeField ?? null })) })
})

databaseRouter.post('/:id/datasets', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const ds = await createDataset(res.locals.userId, id, {
      key: String(body.key ?? ''),
      name: String(body.name ?? ''),
      schema: (body.schema ?? {}) as Record<string, unknown>,
      primaryKey: Array.isArray(body.primaryKey) ? (body.primaryKey as string[]) : undefined,
      mutability: body.mutability as never,
      timeField: typeof body.timeField === 'string' ? body.timeField : undefined,
    })
    res.status(201).json({ key: ds.key, name: ds.name, mutability: ds.mutability })
  } catch (erro) {
    if (recusa(res, erro)) return
    next(erro as Error)
  }
})

databaseRouter.patch('/:id/datasets/:key', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const ds = await updateDataset(res.locals.userId, id, String(req.params.key), {
      name: typeof body.name === 'string' ? body.name : undefined,
      schema: body.schema as never,
      mutability: body.mutability as never,
    })
    if (!ds) return notFound(res)
    res.json({ key: ds.key, name: ds.name, mutability: ds.mutability })
  } catch (erro) {
    if (recusa(res, erro)) return
    next(erro as Error)
  }
})

databaseRouter.delete('/:id/datasets/:key', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id || !(await getDataStore(res.locals.userId, id))) return notFound(res)
  if (!(await deleteDataset(res.locals.userId, id, String(req.params.key)))) return notFound(res)
  res.status(204).end()
})

// --- consulta e escrita ----------------------------------------------------------------------

databaseRouter.post('/:id/datasets/:key/query', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  try {
    const r = await runQuery({ accountId: res.locals.userId, dataStoreId: id, datasetKey: String(req.params.key), query: req.body ?? {} })
    res.json({ rows: r.rows, total: r.total, returned: r.rows.length, truncated: r.truncated, freshness: r.freshness })
  } catch (erro) {
    if (recusa(res, erro)) return
    next(erro as Error)
  }
})

databaseRouter.post('/:id/datasets/:key/rows', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  const key = String(req.params.key)
  try {
    /**
     * A mutabilidade é conferida ANTES da permissão de escrita.
     *
     * São perguntas diferentes — "isto é possível neste dataset?" e "esta pessoa pode?" —
     * e a primeira não depende de grant nenhum: um dataset `append_only` recusa `update`
     * mesmo para quem administra a conta.
     */
    const permitido = await assertMutationAllowed(res.locals.userId, id, key, 'insert')
    if (!permitido.ok) {
      res.status(409).json({ code: 'immutable', message: permitido.reason, error: permitido.reason })
      return
    }
    const body = (req.body ?? {}) as { rows?: unknown }
    const rows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : []
    if (rows.length === 0) {
      res.status(400).json({ code: 'invalid', message: 'informe ao menos uma linha' })
      return
    }
    const r = await runInsert({ accountId: res.locals.userId, dataStoreId: id, datasetKey: key, query: {}, rows })
    res.status(201).json(r)
  } catch (erro) {
    if (recusa(res, erro)) return
    next(erro as Error)
  }
})

// --- grants ------------------------------------------------------------------------------------

databaseRouter.get('/:id/grants', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id || !(await getDataStore(res.locals.userId, id))) return notFound(res)
  const grants = await listGrants(res.locals.userId, id)
  res.json({
    items: grants.map((g) => ({
      id: g._id.toString(),
      subjectType: g.subjectType,
      subjectId: g.subjectId.toString(),
      capabilities: g.capabilities,
      effect: g.effect,
      datasetKeys: g.datasetKeys,
      updatedAt: g.updatedAt,
    })),
  })
})

databaseRouter.put('/:id/grants', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id || !(await getDataStore(res.locals.userId, id))) return notFound(res)
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    // O SUJEITO é resolvido contra a conta: um id alheio não vira grant por ter sido enviado.
    const sujeito = await resolveSubject(res.locals.userId, { subjectType: body.subjectType as never, subjectId: String(body.subjectId ?? '') })
    if (!sujeito) return notFound(res)
    const capacidades = (Array.isArray(body.capabilities) ? body.capabilities : []).filter((c): c is DatabaseCapability =>
      DATABASE_CAPABILITIES.includes(c as DatabaseCapability),
    )
    const g = await putGrant(
      res.locals.userId,
      id,
      {
        subjectType: sujeito.subjectType,
        subjectId: sujeito.subjectId,
        capabilities: capacidades,
        effect: body.effect === 'deny' ? 'deny' : 'allow',
        datasetKeys: Array.isArray(body.datasetKeys) ? (body.datasetKeys as string[]) : [],
      },
      res.locals.userId,
    )
    res.json({ id: g._id.toString(), subjectType: g.subjectType, subjectId: g.subjectId.toString(), capabilities: g.capabilities, effect: g.effect })
  } catch (erro) {
    if (recusa(res, erro)) return
    next(erro as Error)
  }
})

databaseRouter.delete('/:id/grants/:grantId', async (req, res) => {
  const id = oid(String(req.params.id))
  const grantId = oid(String(req.params.grantId))
  if (!id || !grantId || !(await getDataStore(res.locals.userId, id))) return notFound(res)
  if (!(await deleteGrant(res.locals.userId, grantId))) return notFound(res)
  res.status(204).end()
})

/** "Este agente consegue?" — a decisão do servidor, com origem e motivo. */
databaseRouter.get('/:id/access', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id || !(await getDataStore(res.locals.userId, id))) return notFound(res)
  const agentId = req.query.agentId ? oid(String(req.query.agentId)) : null
  if (req.query.agentId && !agentId) return notFound(res)
  const d = await resolveDatabaseAccess({
    accountId: res.locals.userId,
    dataStoreId: id,
    agentId,
    datasetKey: typeof req.query.datasetKey === 'string' ? req.query.datasetKey : null,
    capability: (typeof req.query.capability === 'string' ? req.query.capability : null) as DatabaseCapability | null,
  })
  res.json(d)
})

databaseRouter.get('/:id/impact', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  const store = await getDataStore(res.locals.userId, id)
  if (!store) return notFound(res)
  const [datasets, grants] = await Promise.all([listDatasets(res.locals.userId, id), listGrants(res.locals.userId, id)])
  const { listAgents } = await import('../agents.js')
  const agentes = await listAgents(res.locals.userId)
  const comAcesso: { agentId: string; name: string; origin: string }[] = []
  for (const a of agentes) {
    const d = await resolveDatabaseAccess({ accountId: res.locals.userId, dataStoreId: id, agentId: a._id, capability: 'query' })
    if (d.allowed) comAcesso.push({ agentId: a._id.toString(), name: a.name, origin: d.origin })
  }
  res.json({
    dataStoreId: id.toString(),
    name: store.name,
    datasets: datasets.map((d) => ({ key: d.key, mutability: d.mutability })),
    grants: grants.length,
    // Quem PODE consultar. "Quem consultou" sai do log, que é outra pergunta.
    accessibleBy: comAcesso,
    recommendation: comAcesso.length > 0 || datasets.length > 0 ? 'prefer_archive' : 'safe_to_delete',
  })
})
