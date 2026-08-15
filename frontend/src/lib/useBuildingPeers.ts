import { useEffect, useMemo, useState } from 'react'
import { API_URL } from './api'
import { useOptionalBuildingContext } from '../contexts/BuildingContext'
import { normalizeSectorMode } from './sectors'
import type { AgentSummary, SectorSummary } from './types'

// Collaboration is a BUILDING-wide decision, while the roster page lists one floor.
// This hook is the single place the UI asks "who else is in this building?", so the
// hiring wizard and the readiness preview stop disagreeing with the backend (which
// has always reasoned over the whole building).
//
// Owner scoping is the API's job (every request is owner-scoped); the building
// filter comes from the floors of the ACTIVE building, so another building can never
// leak in. Sectors that only group agents are dropped: they cannot execute.
export function useBuildingPeers(): { agents: AgentSummary[]; sectors: SectorSummary[]; loading: boolean } {
  const building = useOptionalBuildingContext()
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [sectors, setSectors] = useState<SectorSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API_URL}/api/agents`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_URL}/api/sectors`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([a, s]) => {
        if (cancelled) return
        setAgents(a)
        setSectors(s)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const floorIds = useMemo(() => new Set((building?.floors ?? []).map((f) => f.id)), [building?.floors])

  return useMemo(
    () => ({
      // No floors loaded yet → nothing is claimed as a peer (never "everything").
      agents: floorIds.size === 0 ? [] : agents.filter((a) => a.floorId && floorIds.has(a.floorId)),
      sectors: floorIds.size === 0 ? [] : sectors.filter((s) => s.floorId && floorIds.has(s.floorId)).filter((s) => normalizeSectorMode(s.mode) !== 'organization'),
      loading,
    }),
    [agents, sectors, floorIds, loading],
  )
}
