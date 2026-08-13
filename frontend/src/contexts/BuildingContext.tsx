import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { getBuilding, listFloors, resolveActiveFloor } from '../lib/floors'
import type { Building, Floor } from '../lib/floors'
import { floorHome, parseFloorPath, switchFloorPath } from '../lib/floorRoutes'

// Single global building/floor context (UX reorg §5.1). URL is the source of
// truth for the active floor; localStorage is only a fallback. Replaces the
// scattered useFloors() instances so the whole tree shares one selection.
export interface BuildingContextValue {
  building: Building | null
  floors: Floor[]
  activeFloor: Floor | null
  activeFloorId: string | null
  loading: boolean
  error: boolean
  selectFloor: (floorId: string, options?: { preserveSection?: boolean }) => void
  reloadFloors: () => Promise<void>
}

const STORAGE_KEY = 'ai.activeFloorId'
const Ctx = createContext<BuildingContextValue | null>(null)

export function BuildingProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [building, setBuilding] = useState<Building | null>(null)
  const [floors, setFloors] = useState<Floor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const reloadFloors = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [b, fs] = await Promise.all([getBuilding(), listFloors()])
      setBuilding(b)
      setFloors(fs)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reloadFloors()
  }, [reloadFloors])

  // Active floor: URL floorId (validated against loaded floors) → saved → first
  // active. The URL always wins so deep links and refresh are stable.
  const urlFloorId = parseFloorPath(location.pathname).floorId
  const activeFloorId = useMemo(() => {
    if (urlFloorId && floors.some((f) => f.id === urlFloorId)) return urlFloorId
    let saved: string | null = null
    try {
      saved = localStorage.getItem(STORAGE_KEY)
    } catch {
      saved = null
    }
    return resolveActiveFloor(floors, urlFloorId ?? saved)
  }, [urlFloorId, floors])

  // Persist the resolved floor (once validated) as the fallback for next time.
  useEffect(() => {
    if (activeFloorId) {
      try {
        localStorage.setItem(STORAGE_KEY, activeFloorId)
      } catch {
        /* storage unavailable */
      }
    }
  }, [activeFloorId])

  // Guard invalid floor URLs (§7.5): if the path names a floor that isn't in this
  // account (deleted, archived, or foreign), don't render another floor's data
  // under it — replace the URL with the resolved active floor, keeping the module.
  useEffect(() => {
    if (loading || !urlFloorId) return
    if (floors.some((f) => f.id === urlFloorId)) return
    if (activeFloorId && activeFloorId !== urlFloorId) navigate(switchFloorPath(location.pathname, activeFloorId), { replace: true })
  }, [loading, urlFloorId, floors, activeFloorId, location.pathname, navigate])

  const selectFloor = useCallback(
    (floorId: string, options?: { preserveSection?: boolean }) => {
      navigate(options?.preserveSection ? switchFloorPath(location.pathname, floorId) : floorHome(floorId))
    },
    [location.pathname, navigate],
  )

  const activeFloor = useMemo(() => floors.find((f) => f.id === activeFloorId) ?? null, [floors, activeFloorId])

  const value: BuildingContextValue = {
    building,
    floors,
    activeFloor,
    activeFloorId,
    loading,
    error,
    selectFloor,
    reloadFloors,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useBuildingContext(): BuildingContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useBuildingContext must be used within BuildingProvider')
  return ctx
}

// Safe variant for shared chrome (Sidebar/MobileNav) rendered in both nav modes:
// returns null when there is no provider (nav V1) instead of throwing.
export function useOptionalBuildingContext(): BuildingContextValue | null {
  return useContext(Ctx)
}

// The floor a screen/component should scope to: the URL floor (authoritative when
// inside a /floors/:floorId route) or, on a legacy flat route, the context's
// resolved active floor. Lets shared cards/details build canonical floor paths.
export function useActiveFloorId(): string | null {
  const { floorId } = useParams()
  const ctx = useContext(Ctx)
  return floorId ?? ctx?.activeFloorId ?? null
}
