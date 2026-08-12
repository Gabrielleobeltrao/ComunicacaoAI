import { useCallback, useEffect, useMemo, useState } from 'react'
import { getBuilding, listFloors, resolveActiveFloor } from './floors'
import type { Building, Floor } from './floors'

const STORAGE_KEY = 'ai.activeFloorId'

// Loads the owner's building + floors and tracks the active floor, persisted per
// browser with a safe fallback when the saved floor is archived/gone (plan §14.5).
export function useFloors() {
  const [building, setBuilding] = useState<Building | null>(null)
  const [floors, setFloors] = useState<Floor[]>([])
  const [activeFloorId, setActiveFloorId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [b, fs] = await Promise.all([getBuilding(), listFloors()])
      setBuilding(b)
      setFloors(fs)
      setActiveFloorId((prev) => resolveActiveFloor(fs, prev))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const selectFloor = useCallback((id: string) => {
    setActiveFloorId(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  }, [])

  const activeFloor = useMemo(() => floors.find((f) => f.id === activeFloorId) ?? null, [floors, activeFloorId])

  return { building, floors, activeFloorId, activeFloor, loading, error, reload, selectFloor }
}
