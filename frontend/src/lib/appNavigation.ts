import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { API_URL } from './api'

// The App pages this user can open, and which ones they pinned.
//
// A pin is a shortcut: pinning and unpinning here changes navigation and nothing
// else. The server enforces the same rule, so this cannot become a permission.

export interface NavigationSurface {
  key: string
  label: string
  description: string
  icon: string | null
  path: string
}

export interface NavigationApp {
  appKey: string
  name: string
  icon: string | null
  pinned: boolean
  order: number
  status: 'ready' | 'needs_reauth'
  defaultSurfaceKey: string | null
  surfaces: NavigationSurface[]
}

// ONE store for every consumer.
//
// The sidebar and the Apps page both ask for this. With per-component state, pinning
// on the Apps page refetched only that copy — the sidebar kept its own stale list
// until the page was reloaded. Here they read the same snapshot, so a pin lands
// everywhere at once.
let snapshot: { apps: NavigationApp[]; loading: boolean } = { apps: [], loading: true }
const listeners = new Set<() => void>()
let inFlight: Promise<void> | null = null

const publish = (next: typeof snapshot) => {
  snapshot = next
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

async function fetchNavigation(): Promise<void> {
  // Consumers mount together; one request serves all of them.
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/api/apps/navigation`, { credentials: 'include' })
      if (res.ok) {
        const body = (await res.json()) as { apps: NavigationApp[] }
        publish({ apps: body.apps ?? [], loading: false })
        return
      }
    } catch {
      // Navigation is a convenience: a failure must not blank the sidebar.
    }
    publish({ ...snapshot, loading: false })
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}

export function useAppNavigation() {
  const { apps, loading } = useSyncExternalStore(subscribe, () => snapshot, () => snapshot)

  const load = useCallback(async () => {
    await fetchNavigation()
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const setPinned = useCallback(
    async (appKeys: string[]) => {
      const res = await fetch(`${API_URL}/api/me/navigation-preferences/pinned-apps`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinnedApps: appKeys }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? 'Não foi possível salvar.')
      }
      await load()
    },
    [load],
  )

  const togglePin = useCallback(
    async (appKey: string) => {
      const current = apps.filter((a) => a.pinned).map((a) => a.appKey)
      const next = current.includes(appKey) ? current.filter((k) => k !== appKey) : [...current, appKey]
      await setPinned(next)
    },
    [apps, setPinned],
  )

  const pinned = apps.filter((a) => a.pinned)
  return { apps, pinned, loading, reload: load, setPinned, togglePin }
}

// The default page of an App — where clicking its name goes.
export const defaultPathFor = (app: NavigationApp): string =>
  app.surfaces.find((s) => s.key === app.defaultSurfaceKey)?.path ?? app.surfaces[0]?.path ?? '/apps'
