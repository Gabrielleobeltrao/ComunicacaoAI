import { useLocation } from 'react-router'
import { ABAS, WsPage } from './shared'
import { WebSocketOverview } from './Overview'
import { WebSocketMessages } from './Messages'
import { WebSocketSubscriptions } from './Subscriptions'
import { WebSocketLive } from './Live'
import { WebSocketLogs } from './Logs'

/**
 * O App inteiro numa casca só.
 *
 * As cinco páginas continuam tendo endereço próprio — link direto, favorito e o menu
 * lateral seguem funcionando —, mas as cinco rotas rendem ESTE componente. Como o tipo
 * do elemento é o mesmo em todas, o React reaproveita a árvore em vez de desmontá-la:
 * o layout, o cabeçalho e as abas ficam de pé, e só o painel troca.
 *
 * Antes daqui cada aba montava o próprio `AppLayout` e, pior, era um `<a href>` de
 * verdade — a tela inteira piscava porque o site inteiro recarregava.
 */
const PAINEL: Record<string, () => React.ReactElement> = {
  overview: WebSocketOverview,
  messages: WebSocketMessages,
  subscriptions: WebSocketSubscriptions,
  live: WebSocketLive,
  logs: WebSocketLogs,
}

export function WebSocketApp() {
  const { pathname } = useLocation()
  const aba = ABAS.find((a) => pathname.startsWith(a.path)) ?? ABAS[0]
  const Painel = PAINEL[aba.key]
  return (
    <WsPage current={aba.path} title={aba.title} subtitle={aba.subtitle}>
      <Painel />
    </WsPage>
  )
}
