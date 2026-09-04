// The primary navigation destinations, shared by the desktop rail (Sidebar) and
// the mobile navigation (bottom bar + drawer) so both stay in sync.
export interface NavLink {
  to: string
  label: string
  icon: string // Lucide glyph name (via the Icon component)
}

import { featureFlags } from '../featureFlags'

export const NAV: NavLink[] = [
  // AI-building pivot: the Prédio (Térreo) entry appears only when its flag is on.
  ...(featureFlags.aiBuilding ? [{ to: '/building', label: 'Prédio', icon: 'building-2' } as NavLink] : []),
  { to: '/dashboard', label: 'Escritório', icon: 'layout-dashboard' },
  // Sem "Montar operação" aqui, pelo mesmo motivo da navegação nova: ela é um modo de trabalho
  // do Arquiteto, não um módulo ao lado de Agentes e Setores. A porta é o botão dentro do chat.
  // "Automação" is not a product surface: scheduled work lives inside each agent
  // as Rotinas, so there is no standalone Automações nav entry.
  { to: '/agents', label: 'Agentes', icon: 'users-round' },
  { to: '/setores', label: 'Setores', icon: 'network' },
  { to: '/apps', label: 'Apps', icon: 'blocks' },
  { to: '/historicos', label: 'Históricos', icon: 'database' },
  { to: '/widgets', label: 'Canais', icon: 'share-2' },
  { to: '/chats', label: 'Conversas', icon: 'message-circle' },
  // Not a builder: one place to SEE the automatic work the agents already do.
  { to: '/executions', label: 'Execuções', icon: 'activity' },
  // Memória invisível é memória em que ninguém confia: o dono precisa poder ver o
  // que os gatilhos guardaram, procurar e apagar.
  { to: '/memories', label: 'Memória', icon: 'database' },
]
