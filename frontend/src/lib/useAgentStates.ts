import { useEffect, useState } from 'react'
import { getAgentStates, listFloors } from './floors'

// Live-map overlay data source. Polls the backend for per-agent operational state
// (the backend is the source of truth — the map only reflects it, plan §15.1).
// A no-op when disabled, so the office map is untouched unless the flag is on.
export function useAgentStates(enabled: boolean): Record<string, string> {
  const [states, setStates] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!enabled) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let floorId: string | null = null

    async function tick() {
      try {
        if (!floorId) {
          const floors = await listFloors()
          floorId = floors.find((f) => f.status === 'active')?.id ?? null
        }
        if (floorId && alive) setStates(await getAgentStates(floorId))
      } catch {
        /* transient — retry next tick; polling reconciles missed realtime events */
      }
      if (alive) timer = setTimeout(tick, 5000)
    }
    void tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [enabled])

  return states
}
