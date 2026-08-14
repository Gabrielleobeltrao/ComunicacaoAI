import { Navigate, useParams } from 'react-router'
import { useBuildingContext } from '../contexts/BuildingContext'
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

// A global module route (/agents, /setores, and the retired /automations, /runs)
// → the same module on the active floor. No active floor → onboarding on the
// dashboard. Automation routes pass module="agents" since scheduled work now lives
// inside agents (as Rotinas).
export function LegacyModuleRedirect({ module }: { module: string }) {
  const { activeFloorId, loading } = useBuildingContext()
  if (loading) return null
  if (!activeFloorId) return <Navigate to="/dashboard" replace />
  return <Navigate to={`/floors/${activeFloorId}/${module}`} replace />
}

// A floor-scoped route that no longer has its own page (the retired
// /floors/:floorId/automations and /runs) → another module on the SAME floor.
export function FloorModuleRedirect({ to }: { to: string }) {
  const { floorId } = useParams<{ floorId: string }>()
  return <Navigate to={floorId ? `/floors/${floorId}/${to}` : '/dashboard'} replace />
}
