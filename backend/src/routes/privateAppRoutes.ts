import { Router } from 'express'
import { appCatalogPublic } from '../apps/registry.js'
import { createPrivateApp, deletePrivateApp, exportPrivateApp, getPrivateApp, listPrivateApps, updatePrivateApp } from '../apps/privateApps.js'
import { auditEntity } from './auditMiddleware.js'
import { fail, notFound } from './http.js'

// --- Apps privados ----------------------------------------------------------------
// A private App is a MANIFEST the owner writes: declarative HTTP actions only, no
// compiled adapter, no page, and no credential — the credential belongs to the
// installation, which is why the manifest can be exported and handed to someone else.

export const privateAppRouter = Router()

privateAppRouter.get('/', async (_req, res) => {
  const apps = await listPrivateApps(res.locals.userId)
  res.json(apps.map(appCatalogPublic))
})

privateAppRouter.post('/', async (req, res, next) => {
  try {
    const created = await createPrivateApp(res.locals.userId, req.body ?? {})
    auditEntity(res, { id: created.key, label: created.name })
    res.status(201).json(appCatalogPublic(created))
  } catch (error) {
    fail(res, error, next)
  }
})

privateAppRouter.get('/:appKey', async (req, res) => {
  const app = await getPrivateApp(res.locals.userId, String(req.params.appKey))
  if (!app) return notFound(res)
  res.json(appCatalogPublic(app))
})

// The export is the manifest itself — reimportable, and by construction free of any
// credential, since a manifest never held one.
privateAppRouter.get('/:appKey/export', async (req, res) => {
  const manifest = await exportPrivateApp(res.locals.userId, String(req.params.appKey))
  if (!manifest) return notFound(res)
  res.json(manifest)
})

privateAppRouter.patch('/:appKey', async (req, res, next) => {
  try {
    const updated = await updatePrivateApp(res.locals.userId, String(req.params.appKey), req.body ?? {})
    if (!updated) return notFound(res)
    auditEntity(res, { id: updated.key, label: updated.name })
    res.json(appCatalogPublic(updated))
  } catch (error) {
    fail(res, error, next)
  }
})

privateAppRouter.delete('/:appKey', async (req, res) => {
  const key = String(req.params.appKey)
  const existing = await getPrivateApp(res.locals.userId, key)
  if (!existing) return notFound(res)
  auditEntity(res, { id: key, label: existing.name })
  await deletePrivateApp(res.locals.userId, key)
  res.json({ deleted: true })
})

// Importing NEVER grants anything: it creates a draft App in this account, and the
// importer still has to connect it and authorise an agent.
privateAppRouter.post('/import', async (req, res, next) => {
  try {
    const created = await createPrivateApp(res.locals.userId, (req.body as { manifest?: unknown })?.manifest ?? req.body ?? {})
    auditEntity(res, { id: created.key, label: created.name })
    res.status(201).json(appCatalogPublic(created))
  } catch (error) {
    fail(res, error, next)
  }
})
