// The primary navigation destinations, shared by the desktop rail (Sidebar) and
// the mobile navigation (bottom bar + drawer) so both stay in sync.
export interface NavLink {
  to: string
  label: string
  icon: string // Lucide glyph name (via the Icon component)
}

export const NAV: NavLink[] = [
  { to: '/dashboard', label: 'Escritório', icon: 'layout-dashboard' },
  { to: '/agents', label: 'Agentes', icon: 'users-round' },
  { to: '/setores', label: 'Setores', icon: 'network' },
  { to: '/widgets', label: 'Canais', icon: 'share-2' },
  { to: '/chats', label: 'Conversas', icon: 'message-circle' },
]
