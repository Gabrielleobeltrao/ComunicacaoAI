import { Router } from 'express'
import { appCatalogPublic, getApp, SYSTEM_APPS } from '../apps/registry.js'
import { installationPublic, listInstallations } from '../apps/installations.js'
import { buildNavigation, getNavigationPreferences, MAX_PINNED_APPS, resolveSurface, setPinnedApps } from '../apps/navigation.js'
import { fail, notFound } from './http.js'

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

// --- navegação ------------------------------------------------------------------
// Read-only for the catalog side; the pin preference is the only thing writable, and
// it is a shortcut, never an authorisation.

// Can this user open this App page, right now? The SAME decision the sidebar uses,
// asked by the route guard before it renders anything — so a direct URL cannot reach
// a page whose App is inactive or broken.
appCatalogRouter.get('/:appKey/surfaces/:surfaceKey/access', async (req, res) => {
  const decision = await resolveSurface(res.locals.userId, String(req.params.appKey), String(req.params.surfaceKey))
  if (decision.ok) {
    return res.json({ ok: true, appKey: decision.app.key, appName: decision.app.name, installations: decision.installations.length })
  }
  // Never a 404 that looks like a bug: the reason is what the UI needs to show the
  // right screen (reconnect vs activate).
  res.status(403).json({
    ok: false,
    reason: decision.reason,
    appName: getApp(String(req.params.appKey))?.name ?? null,
    activationRoute: getApp(String(req.params.appKey))?.activationRoute ?? null,
  })
})

appCatalogRouter.get('/navigation', async (_req, res) => {
  res.json(await buildNavigation(res.locals.userId, res.locals.userId))
})

export const navigationPreferencesRouter = Router()

navigationPreferencesRouter.get('/navigation-preferences', async (_req, res) => {
  const prefs = await getNavigationPreferences(res.locals.userId, res.locals.userId)
  res.json({ ...prefs, maxPinnedApps: MAX_PINNED_APPS })
})

navigationPreferencesRouter.patch('/navigation-preferences/pinned-apps', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { pinnedApps?: unknown }
    const prefs = await setPinnedApps(res.locals.userId, res.locals.userId, body.pinnedApps)
    res.json({ ...prefs, maxPinnedApps: MAX_PINNED_APPS })
  } catch (error) {
    fail(res, error, next)
  }
})
