import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { useBuildingContext } from '../contexts/BuildingContext'
import { getAutomation } from '../lib/automations'
import { Dashboard } from './Dashboard'

// Legacy-route redirects (UX reorg §4.2). URLs stay working; they resolve to the
// canonical floor-scoped route so bookmarks/links never break.

export function BuildingToDashboard() {
  return <Navigate to="/dashboard" replace />
}

// /dashboard is no longer a page of its own: the building overview was merged into
// the floor home. Send it to the active floor; only when there is no floor yet do
// we fall back to the building landing (KPIs + create-your-first-floor).
export function DashboardHome() {
  const { activeFloorId, loading } = useBuildingContext()
  if (loading) return null
  if (activeFloorId) return <Navigate to={`/floors/${activeFloorId}`} replace />
  return <Dashboard />
}

// A global module route (/automations, /agents, /setores, /runs) → the same
// module on the active floor. No active floor → onboarding on the dashboard.
export function LegacyModuleRedirect({ module }: { module: string }) {
  const { activeFloorId, loading } = useBuildingContext()
  if (loading) return null
  if (!activeFloorId) return <Navigate to="/dashboard" replace />
  return <Navigate to={`/floors/${activeFloorId}/${module}`} replace />
}

// /automations/:id → resolve the automation's real floor, then the canonical route.
export function AutomationDetailRedirect() {
  const { id } = useParams<{ id: string }>()
  const [target, setTarget] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!id) return
    let alive = true
    getAutomation(id)
      .then((a) => {
        if (alive) setTarget(`/floors/${a.floorId}/automations/${id}`)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [id])
  if (failed) return <Navigate to="/dashboard" replace />
  if (!target) return null
  return <Navigate to={target} replace />
}
