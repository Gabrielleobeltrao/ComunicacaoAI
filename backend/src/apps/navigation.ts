// Which App pages this user can actually open, and which of them they pinned.
//
// A pin is a SHORTCUT and nothing else: it never installs, connects, grants a scope,
// enables an action or changes an agent's permissions. That is why preferences live
// in their own collection, per user, separate from the shared installation and from
// the agent's grants — there is no code path from here to a permission.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { ValidationError } from '../building.js'
import { getApp, SYSTEM_APPS } from './registry.js'
import { listInstallations } from './installations.js'
import type { AppDefinition, AppInstallation } from './types.js'

export const MAX_PINNED_APPS = 6

export interface UserNavigationPreferences {
  _id: ObjectId
  ownerId: string
  userId: string
  pinnedApps: { appKey: string; order: number }[]
  updatedAt: Date
}

const preferences = db.collection<UserNavigationPreferences>('user_navigation_preferences')

export async function ensureNavigationIndexes(): Promise<void> {
  await preferences.createIndex({ ownerId: 1, userId: 1 }, { unique: true })
}

export async function getNavigationPreferences(ownerId: string, userId: string): Promise<{ pinnedApps: { appKey: string; order: number }[] }> {
  const doc = await preferences.findOne({ ownerId, userId })
  return { pinnedApps: (doc?.pinnedApps ?? []).slice().sort((a, b) => a.order - b.order) }
}

// A pin only survives while it points at something the user can open. Validation is
// here rather than at read time so a stale pin is cleaned up once, not filtered
// forever.
export async function setPinnedApps(ownerId: string, userId: string, appKeys: unknown): Promise<{ pinnedApps: { appKey: string; order: number }[] }> {
  if (!Array.isArray(appKeys)) throw new ValidationError('pinnedApps deve ser uma lista')
  const seen = new Set<string>()
  const keys: string[] = []
  for (const raw of appKeys) {
    const key = String(raw ?? '')
    const app = getApp(key)
    if (!app) throw new ValidationError(`App desconhecido: ${key}`)
    // One pin per App, however many connections it has.
    if (seen.has(app.key)) continue
    if (!app.sidebar?.pinnable) throw new ValidationError(`${app.name} não pode ser fixado`)
    seen.add(app.key)
    keys.push(app.key)
  }
  if (keys.length > MAX_PINNED_APPS) throw new ValidationError(`no máximo ${MAX_PINNED_APPS} Apps fixados`)

  // Only an App with a usable installation may be pinned: pinning must never be a
  // way to reach a page the account has not activated.
  const installations = await listInstallations(ownerId)
  const usable = new Set(installations.filter((i) => i.status !== 'revoked').map((i) => i.appKey))
  for (const key of keys) {
    if (!usable.has(key)) throw new ValidationError(`${getApp(key)?.name ?? key} precisa estar ativo para ser fixado`)
  }

  const pinnedApps = keys.map((appKey, order) => ({ appKey, order }))
  await preferences.updateOne(
    { ownerId, userId },
    { $set: { pinnedApps, updatedAt: new Date() }, $setOnInsert: { ownerId, userId } },
    { upsert: true },
  )
  return { pinnedApps }
}

// Idempotent cleanup after a connection is revoked or removed.
export async function dropPinsForApp(ownerId: string, appKey: string): Promise<void> {
  const docs = await preferences.find({ ownerId, 'pinnedApps.appKey': appKey }).toArray()
  for (const doc of docs) {
    const pinnedApps = doc.pinnedApps.filter((p) => p.appKey !== appKey).map((p, order) => ({ appKey: p.appKey, order }))
    await preferences.updateOne({ _id: doc._id }, { $set: { pinnedApps, updatedAt: new Date() } })
  }
}

export type NavigationAppStatus = 'ready' | 'needs_reauth'

export interface NavigationApp {
  appKey: string
  name: string
  icon: string | null
  pinned: boolean
  order: number
  status: NavigationAppStatus
  defaultSurfaceKey: string | null
  surfaces: { key: string; label: string; description: string; icon: string | null; path: string }[]
}

const surfacePath = (app: AppDefinition, segment: string): string => `/apps/${app.key.replace(/_/g, '-')}/${segment}`

// The navigation DTO: only Apps this user may actually open, with sanitized page
// descriptors. No component, no import, no module path — a route segment the
// frontend resolves against its own compiled registry.
export async function buildNavigation(ownerId: string, userId: string): Promise<{ apps: NavigationApp[]; pinned: string[] }> {
  const [installations, prefs] = await Promise.all([listInstallations(ownerId), getNavigationPreferences(ownerId, userId)])
  const byApp = new Map<string, AppInstallation[]>()
  for (const i of installations) {
    if (i.status === 'revoked') continue
    byApp.set(i.appKey, [...(byApp.get(i.appKey) ?? []), i])
  }

  const pinnedOrder = new Map(prefs.pinnedApps.map((p) => [p.appKey, p.order]))
  const apps: NavigationApp[] = []
  for (const app of SYSTEM_APPS) {
    if (app.status !== 'published') continue
    const surfaces = app.surfaces ?? []
    if (surfaces.length === 0) continue
    const active = byApp.get(app.key) ?? []
    // An App the account never activated has no pages to offer.
    if (active.length === 0) continue
    apps.push({
      appKey: app.key,
      name: app.name,
      icon: app.icon ?? null,
      pinned: pinnedOrder.has(app.key),
      order: pinnedOrder.get(app.key) ?? Number.MAX_SAFE_INTEGER,
      // Every connection needing attention keeps the entry visible with a CTA
      // instead of making the pages vanish.
      status: active.every((i) => i.status === 'needs_reauth') ? 'needs_reauth' : 'ready',
      defaultSurfaceKey: app.sidebar?.defaultSurfaceKey ?? surfaces[0]?.key ?? null,
      surfaces: surfaces.map((s) => ({
        key: s.key,
        label: s.label,
        description: s.description,
        icon: s.icon ?? null,
        path: surfacePath(app, s.routeSegment),
      })),
    })
  }

  apps.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  return { apps, pinned: apps.filter((a) => a.pinned).map((a) => a.appKey) }
}

// The surface guard, used before rendering a page and before its endpoints answer.
// Order matters: a known App, a known page, an activated account — and never a
// route segment that could be a path, a URL or a traversal.
export async function resolveSurface(
  ownerId: string,
  appKey: string,
  surfaceKey: string,
): Promise<{ ok: true; app: AppDefinition; installations: AppInstallation[] } | { ok: false; reason: 'unknown' | 'inactive' | 'needs_reauth' }> {
  const app = getApp(appKey)
  const surface = app?.surfaces?.find((s) => s.key === surfaceKey)
  if (!app || !surface) return { ok: false, reason: 'unknown' }
  const installations = (await listInstallations(ownerId, app.key)).filter((i) => i.status !== 'revoked')
  if (installations.length === 0) return { ok: false, reason: 'inactive' }
  if (installations.every((i) => i.status === 'needs_reauth')) return { ok: false, reason: 'needs_reauth' }
  return { ok: true, app, installations }
}
