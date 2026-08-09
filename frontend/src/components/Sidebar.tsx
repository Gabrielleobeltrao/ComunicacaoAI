import { Link, useNavigate, useParams } from 'react-router'
import { signOut, useSession } from '../lib/auth-client'
import { ACTIVE, COLLAPSE_FADE, INACTIVE, ITEM_BASE, LABEL } from '../lib/sidebarStyles'
import { Brand, Icon, IconButton } from '../ui'
import { AgentNav } from './AgentNav'
import { TeamNav } from './TeamNav'

// Lucide glyph names (via the Icon component), matching the design's Rail.
interface NavLink {
  to: string
  label: string
  icon: string
}

const NAV: NavLink[] = [
  { to: '/dashboard', label: 'Escritório', icon: 'layout-dashboard' },
  { to: '/agents', label: 'Agentes', icon: 'users-round' },
  { to: '/teams', label: 'Equipes', icon: 'network' },
  { to: '/widgets', label: 'Canais', icon: 'share-2' },
  { to: '/chats', label: 'Conversas', icon: 'message-circle' },
]

export function Sidebar({ current }: { current: string }) {
  const navigate = useNavigate()
  // On an agent/team page the middle nav swaps to that entity's own sections.
  const { agentId, teamId } = useParams()
  const { data: session } = useSession()

  const user = session?.user
  const displayName = user?.name?.trim() || user?.email?.split('@')[0] || 'Você'
  const secondary = user?.email || 'Conta'
  const initial = displayName.charAt(0).toUpperCase()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    // A slim rail (icons only) that expands to the full width on hover. The
    // outer wrapper keeps reserving the collapsed width so the page never
    // reflows; the <aside> overlays the content when expanded.
    <div className="group relative shrink-0" style={{ width: 'var(--rail-width-collapsed)' }}>
      <aside
        className="absolute inset-y-0 left-0 z-30 flex w-(--rail-width-collapsed) flex-col gap-4 overflow-hidden border-r px-3 py-4 transition-[width,box-shadow] duration-200 ease-out group-hover:w-(--rail-width) group-hover:overflow-y-auto group-hover:shadow-[0_16px_40px_rgba(22,24,31,.16)]"
        style={{ background: 'var(--surface-rail)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center justify-center gap-0 overflow-hidden pt-1 group-hover:justify-start group-hover:gap-2.5 group-hover:px-1.5">
          <Brand size={18} word={false} />
          <span className={COLLAPSE_FADE} style={{ display: 'inline-flex' }}>
            <Brand size={18} mark={false} />
          </span>
        </div>

        {agentId ? (
          <AgentNav />
        ) : teamId ? (
          <TeamNav />
        ) : (
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => (
              <Link key={item.to} to={item.to} className={`${ITEM_BASE} ${item.to === current ? ACTIVE : INACTIVE}`}>
                <Icon name={item.icon} size={18} />
                <span className={LABEL}>{item.label}</span>
              </Link>
            ))}
          </nav>
        )}

        {/* User card — mirrors the design's Rail footer. Collapsed to the avatar
            until the rail expands. */}
        <div
          className="mt-auto flex items-center justify-center gap-0 overflow-hidden rounded-md p-1.5 group-hover:justify-start group-hover:gap-2.5"
          style={{ background: 'var(--surface-sunken)' }}
        >
          <span
            className="grid shrink-0 place-items-center rounded-full"
            style={{
              width: 32,
              height: 32,
              background: 'var(--intent-brand-soft)',
              color: 'var(--cobalt-700)',
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            {initial}
          </span>
          <div className={`flex min-w-0 flex-1 flex-col ${COLLAPSE_FADE}`}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {secondary}
            </span>
          </div>
          <div className={`flex items-center gap-0.5 ${COLLAPSE_FADE}`}>
            <IconButton icon="settings" label="Configurações" size="sm" onClick={() => navigate('/settings')} />
            <IconButton icon="log-out" label="Sair" size="sm" onClick={handleSignOut} />
          </div>
        </div>
      </aside>
    </div>
  )
}
