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

/**
 * /community — o endereço que a Comunidade tinha quando ela era uma página.
 *
 * Ela deixou de ser um lugar: o que vem de terceiro aparece dentro de Apps e de
 * Ferramentas. O favorito de quem já tinha continua chegando, e a aba antiga é
 * traduzida: "instalados" e "catálogo" viram a prateleira de Apps; "ferramentas"
 * — que era onde as ferramentas compartilhadas estavam — vira a aba delas.
 */
export function CommunityRedirect() {
  const [params] = useSearchParams()
  const tab = params.get('tab')
  const rest = new URLSearchParams(params)
  rest.delete('tab')
  rest.set('tab', tab === 'mine' ? 'mine' : tab === 'tools' ? 'custom' : 'catalog')
  return <Navigate to={`/apps?${rest.toString()}`} replace />
}

/**
 * /resources — o inventário que era só um espelho.
 *
 * Ele listava documentos, Apps, databases e ferramentas sem deixar fazer nada com eles:
 * cada um já tem a sua tela, e é lá que se age. A pergunta que justificaria uma tela
 * própria — quem alcança isto, quem usou de verdade, o que quebra se eu tirar — nunca
 * chegou a ser desenhada, e uma lista que duplica quatro telas é um item de menu que
 * promete mais do que entrega.
 *
 * O favorito continua chegando, e chegando no lugar CERTO: o tipo que a pessoa estava
 * olhando decide o destino. Sem tipo, a prateleira de Apps, que é a mais próxima de um
 * "o que este escritório tem".
 */
export function ResourcesRedirect() {
  const [params] = useSearchParams()
  const { activeFloorId, loading } = useBuildingContext()
  if (loading) return null
  const kind = params.get('kind')
  if (kind === 'database') return <Navigate to="/databases" replace />
  if (kind === 'tool') return <Navigate to="/apps?tab=custom" replace />
  // Conhecimento vive no ANDAR: sem andar ativo não há mapa para abrir.
  if (kind === 'knowledge' && activeFloorId) return <Navigate to={`/floors/${activeFloorId}?view=knowledge`} replace />
  return <Navigate to="/apps" replace />
}
