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
  // "Automação" is not a product surface: scheduled work lives inside each agent
  // as Rotinas, so there is no standalone Automações nav entry.
  { to: '/agents', label: 'Agentes', icon: 'users-round' },
  { to: '/setores', label: 'Setores', icon: 'network' },
  { to: '/widgets', label: 'Canais', icon: 'share-2' },
  { to: '/chats', label: 'Conversas', icon: 'message-circle' },
]
