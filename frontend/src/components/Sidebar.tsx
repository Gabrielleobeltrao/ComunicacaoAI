import type { ReactElement } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { signOut } from '../lib/auth-client'
import { ACTIVE, INACTIVE, ITEM_BASE, LABEL } from '../lib/sidebarStyles'
import { Brand } from '../ui'
import { AgentNav } from './AgentNav'
import { TeamNav } from './TeamNav'

type IconProps = { className?: string }

function DashboardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function AgentsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
      <path d="M12 8V5" strokeLinecap="round" />
      <circle cx="12" cy="3.5" r="1" fill="currentColor" stroke="none" />
      <rect x="5" y="8" width="14" height="10" rx="2" />
      <path d="M2 12h3M19 12h3" strokeLinecap="round" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function TeamsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
      <circle cx="8" cy="9" r="2.5" />
      <circle cx="16" cy="9" r="2.5" />
      <path d="M3.5 18a4.5 4.5 0 0 1 9 0M11.5 18a4.5 4.5 0 0 1 9 0" strokeLinecap="round" />
    </svg>
  )
}

function WidgetsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
      <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChatsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4v-4Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SettingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2M12 19.5v2M4.6 7.2l1.7 1M17.7 15.8l1.7 1M4.6 16.8l1.7-1M17.7 8.2l1.7-1M2.5 12h2M19.5 12h2" strokeLinecap="round" />
    </svg>
  )
}

function LogoutIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
      <path d="M15 5V4a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 5 4v16a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 15 20v-1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 12h11m0 0-3-3m3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface NavLink {
  to: string
  label: string
  Icon: (props: IconProps) => ReactElement
}

const NAV: NavLink[] = [
  { to: '/dashboard', label: 'Escritório', Icon: DashboardIcon },
  { to: '/agents', label: 'Agentes', Icon: AgentsIcon },
  { to: '/teams', label: 'Equipes', Icon: TeamsIcon },
  { to: '/widgets', label: 'Canais', Icon: WidgetsIcon },
  { to: '/chats', label: 'Conversas', Icon: ChatsIcon },
]

export function Sidebar({ current }: { current: string }) {
  const navigate = useNavigate()
  // On an agent/team page the middle nav swaps to that entity's own sections.
  const { agentId, teamId } = useParams()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <aside
      className="flex shrink-0 flex-col gap-4 overflow-y-auto border-r px-3.5 py-4"
      style={{ width: 'var(--rail-width)', background: 'var(--surface-rail)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="px-1.5 pt-1">
        <Brand size={18} />
      </div>

      {agentId ? (
        <AgentNav />
      ) : teamId ? (
        <TeamNav />
      ) : (
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} className={`${ITEM_BASE} ${item.to === current ? ACTIVE : INACTIVE}`}>
              <item.Icon className="h-5 w-5 shrink-0" />
              <span className={LABEL}>{item.label}</span>
            </Link>
          ))}
        </nav>
      )}

      <div className="mt-auto flex flex-col gap-1 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <Link to="/settings" className={`${ITEM_BASE} ${current === '/settings' ? ACTIVE : INACTIVE}`}>
          <SettingsIcon className="h-5 w-5 shrink-0" />
          <span className={LABEL}>Configurações</span>
        </Link>
        <button type="button" onClick={handleSignOut} className={`${ITEM_BASE} ${INACTIVE}`}>
          <LogoutIcon className="h-5 w-5 shrink-0" />
          <span className={LABEL}>Sair</span>
        </button>
      </div>
    </aside>
  )
}
