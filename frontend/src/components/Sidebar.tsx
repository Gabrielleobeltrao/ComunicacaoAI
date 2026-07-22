import { Link } from 'react-router'

type IconProps = { className?: string }

function DashboardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function AgentsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <path d="M12 8V5" strokeLinecap="round" />
      <circle cx="12" cy="3.5" r="1" fill="currentColor" stroke="none" />
      <rect x="5" y="8" width="14" height="10" rx="2" />
      <path d="M2 12h3M19 12h3" strokeLinecap="round" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function WidgetsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChatsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4v-4Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const LINKS = [
  { to: '/dashboard', label: 'Dashboard', Icon: DashboardIcon },
  { to: '/agents', label: 'Agentes', Icon: AgentsIcon },
  { to: '/widgets', label: 'Widgets', Icon: WidgetsIcon },
  { to: '/chats', label: 'Chats', Icon: ChatsIcon },
]

export function Sidebar({ current }: { current: string }) {
  return (
    <aside className="group flex w-16 shrink-0 flex-col overflow-hidden border-r border-slate-800 px-3 py-6 transition-[width] duration-200 hover:w-56">
      <div className="mb-6 flex items-center gap-2 px-1">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-bold text-slate-950">
          C
        </div>
        <span className="whitespace-nowrap text-base font-semibold opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          ComunicacaoAI
        </span>
      </div>
      <nav className="flex flex-col gap-1">
        {LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition ${
              link.to === current
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <link.Icon className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {link.label}
            </span>
          </Link>
        ))}
      </nav>
    </aside>
  )
}
