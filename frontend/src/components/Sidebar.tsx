import { Link } from 'react-router'

const LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/agents', label: 'Agentes' },
  { to: '/widgets', label: 'Widgets' },
  { to: '/chats', label: 'Chats' },
]

export function Sidebar({ current }: { current: string }) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 px-3 py-6">
      <span className="mb-6 px-3 text-base font-semibold">ComunicacaoAI</span>
      <nav className="flex flex-col gap-1">
        {LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={`rounded-lg px-3 py-2 text-sm transition ${
              link.to === current
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:bg-slate-900 hover:text-white'
            }`}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
