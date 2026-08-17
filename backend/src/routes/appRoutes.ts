import { Router } from 'express'
import { appCatalogPublic, getApp } from '../apps/registry.js'
import { listAppsForOwner, resolveAppForOwner } from '../apps/privateApps.js'
import { installationPublic, listInstallations } from '../apps/installations.js'
import { availabilityOf } from '../apps/types.js'
import { buildNavigation, getNavigationPreferences, MAX_PINNED_APPS, resolveSurface, setPinnedApps } from '../apps/navigation.js'
import { channelOverview } from '../apps/channelOverview.js'
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
  // System Apps plus this owner's own — resolved in one place, so the catalog cannot
  // show an App the installation route would then call unknown.
  const catalog = await listAppsForOwner(ownerId)
  res.json(
    catalog.filter((app) => app.status === 'published').map((app) => ({
      // Visível de propósito, mesmo quando não é ligável: é o "em breve" que diz ao
      // dono o que está vindo. A tela mostra o selo e desabilita as ações.
      availability: availabilityOf(app),
      ...appCatalogPublic(app),
      private: app.source !== 'system',
      installationCount: byApp.get(app.key) ?? 0,
      connected: (byApp.get(app.key) ?? 0) > 0,
    })),
  )
})

appCatalogRouter.get('/catalog/:appKey', async (req, res) => {
  const app = await resolveAppForOwner(res.locals.userId, String(req.params.appKey))
  if (!app) return notFound(res)
  const installations = await listInstallations(res.locals.userId, app.key)
  res.json({
    ...appCatalogPublic(app),
    private: app.source !== 'system',
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

// The channel App's overview. Guarded by the same surface decision, so it cannot
// serve an inactive App's numbers.
appCatalogRouter.get('/:appKey/overview', async (req, res) => {
  const appKey = String(req.params.appKey)
  if (appKey !== 'web_chat' && appKey !== 'whatsapp') return notFound(res)
  const decision = await resolveSurface(res.locals.userId, appKey, 'overview')
  if (!decision.ok) return res.status(403).json({ ok: false, reason: decision.reason })
  res.json(await channelOverview(res.locals.userId, appKey))
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
