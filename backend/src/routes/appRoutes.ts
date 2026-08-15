import { Router } from 'express'
import { appCatalogPublic, getApp, SYSTEM_APPS } from '../apps/registry.js'
import { installationPublic, listInstallations } from '../apps/installations.js'
import { notFound } from './http.js'

// Read-only: what the owner may connect, and what is already connected. Everything
// here is a DTO — `encryptedConfig`, a decrypted value, an adapter name or a
// component path never leaves these routes.

// --- catálogo -------------------------------------------------------------------

export const appCatalogRouter = Router()

appCatalogRouter.get('/catalog', async (_req, res) => {
  const ownerId = res.locals.userId as string
  const installed = await listInstallations(ownerId)
  const byApp = new Map<string, number>()
  for (const i of installed) {
    if (i.status === 'revoked') continue
    byApp.set(i.appKey, (byApp.get(i.appKey) ?? 0) + 1)
  }
  res.json(
    SYSTEM_APPS.filter((app) => app.status === 'published').map((app) => ({
      ...appCatalogPublic(app),
      installationCount: byApp.get(app.key) ?? 0,
      connected: (byApp.get(app.key) ?? 0) > 0,
    })),
  )
})

appCatalogRouter.get('/catalog/:appKey', async (req, res) => {
  const app = getApp(req.params.appKey)
  if (!app) return notFound(res)
  const installations = await listInstallations(res.locals.userId, app.key)
  res.json({
    ...appCatalogPublic(app),
    installations: installations.map(installationPublic),
    connected: installations.some((i) => i.status === 'connected'),
  })
})
