import { Link } from 'react-router'

const LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/agents', label: 'Agentes' },
  { to: '/widgets', label: 'Widgets' },
  { to: '/chats', label: 'Chats' },
]

export function AppNav({ current }: { current: string }) {
  return (
    <nav className="flex items-center gap-6">
      {LINKS.filter((link) => link.to !== current).map((link) => (
        <Link key={link.to} to={link.to} className="text-sm text-slate-400 transition hover:text-white">
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
