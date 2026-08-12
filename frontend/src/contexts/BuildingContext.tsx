import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { getBuilding, listFloors, resolveActiveFloor } from '../lib/floors'
import type { Building, Floor } from '../lib/floors'

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

// Sections preservable across floors (§6.5). Detail ids don't carry over.
const FLOOR_SECTIONS = ['automations', 'agents', 'sectors', 'runs', 'artifacts']

// Parse /floors/:floorId[/section...] from the current path.
function parseFloorPath(pathname: string): { floorId: string | null; section: string | null } {
  const m = pathname.match(/^\/floors\/([^/]+)(?:\/([^/]+))?/)
  return { floorId: m?.[1] ?? null, section: m?.[2] ?? null }
}

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

  const selectFloor = useCallback(
    (floorId: string, options?: { preserveSection?: boolean }) => {
      const { section } = parseFloorPath(location.pathname)
      const keep = options?.preserveSection && section && FLOOR_SECTIONS.includes(section)
      navigate(keep ? `/floors/${floorId}/${section}` : `/floors/${floorId}`)
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
