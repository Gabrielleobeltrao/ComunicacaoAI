import { Router } from 'express'
import * as service from '../connections/service.js'
import { CONNECTION_CATALOG } from '../connections/service.js'
import type { Connection } from '../connections/types.js'
import { fail, notFound, oid } from './http.js'
import { auditEntity } from './auditMiddleware.js'

// Mounted at /api/connections behind requireAuth. The API NEVER returns
// encryptedConfig or any decrypted secret — only publicMetadata.
export const connectionRouter = Router()

const toPublic = (c: Connection) => ({
  id: c._id,
  provider: c.provider,
  name: c.name,
  status: c.status,
  publicMetadata: c.publicMetadata,
  scopes: c.scopes,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
})

connectionRouter.get('/catalog', (_req, res) => {
  res.json(CONNECTION_CATALOG)
})

connectionRouter.get('/', async (_req, res) => {
  const list = await service.listConnections(res.locals.userId)
  res.json(list.map(toPublic))
})

connectionRouter.post('/', async (req, res, next) => {
  try {
    const created = await service.createConnection(res.locals.userId, req.body ?? {})
    // Identify the new row in the audit trail (id + name only).
    auditEntity(res, { id: created._id.toString(), label: created.name })
    res.status(201).json(toPublic(created))
  } catch (error) {
    fail(res, error, next)
  }
})

connectionRouter.get('/:id', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const c = await service.getConnection(res.locals.userId, id)
  if (!c) return notFound(res)
  res.json(toPublic(c))
})

connectionRouter.patch('/:id', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const c = await service.patchConnection(res.locals.userId, id, req.body ?? {})
    if (!c) return notFound(res)
    res.json(toPublic(c))
  } catch (error) {
    fail(res, error, next)
  }
})

connectionRouter.delete('/:id', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const ok = await service.deleteConnection(res.locals.userId, id)
  if (!ok) return notFound(res)
  res.json({ deleted: true })
})

// Basic (non-live) test: confirms the connection exists and its config decrypts.
// A live provider check (SMTP verify / Telegram getMe) is a later enhancement.
connectionRouter.post('/:id/test', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const c = await service.getConnection(res.locals.userId, id)
  if (!c) return notFound(res)
  try {
    service.decryptConfig(c)
    res.json({ ok: true, provider: c.provider })
  } catch {
    res.status(400).json({ ok: false, message: 'não foi possível ler a configuração' })
  }
})
