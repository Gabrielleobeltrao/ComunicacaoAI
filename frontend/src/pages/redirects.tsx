import { Navigate, useParams, useSearchParams } from 'react-router'
import { useBuildingContext } from '../contexts/BuildingContext'

// Legacy-route redirects (UX reorg §4.2). URLs stay working; they resolve to the
// canonical floor-scoped route so bookmarks/links never break.

// /dashboard is no longer a page of its own: the building overview was merged into
// the floor home. Send it to the active floor; sem andar nenhum, manda para a
// página do prédio — que é onde se cria o primeiro. Antes caía num dashboard sem
// nenhuma forma de sair dele.
export function DashboardHome() {
  const { activeFloorId, loading } = useBuildingContext()
  if (loading) return null
  if (activeFloorId) return <Navigate to={`/floors/${activeFloorId}`} replace />
  return <Navigate to="/building" replace />
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

// /widgets and /chats predate the App pages. They keep working and land on the
// canonical App route, preserving the query string — a bookmarked filter must not be
// lost by a redirect. `?channel=whatsapp` lands on the WhatsApp page.
export function LegacyChannelRedirect({ to, whatsappTo }: { to: string; whatsappTo: string }) {
  const [params] = useSearchParams()
  const channel = params.get('channel')
  const target = channel === 'whatsapp' ? whatsappTo : to
  const rest = new URLSearchParams(params)
  rest.delete('channel')
  const query = rest.toString()
  return <Navigate to={query ? `${target}?${query}` : target} replace />
}

/**
 * As rotas antigas do Arquiteto — e a query que elas carregam.
 *
 * `/architect/new` redirecionava com `<Navigate to="/architect">` fixo, o que DESCARTA a query.
 * Um favorito com `?objetivo=…` — que é exatamente o que o botão "Montar operação" do chat
 * produz — chegava do outro lado com o campo vazio, e a pessoa redigitava sem entender por quê.
 *
 * A rota canônica é `/architect`, que pertence ao Arquiteto e sempre pertenceu. O que muda aqui
 * é só isto: o que veio junto continua vindo.
 */
export function ArchitectLegacyRedirect() {
  const [params] = useSearchParams()
  const query = params.toString()
  return <Navigate to={query ? `/architect?${query}` : '/architect'} replace />
}
