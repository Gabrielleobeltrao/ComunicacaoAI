import { Link, useNavigate } from 'react-router'
import { ApiKeySettings } from '../components/ApiKeySettings'
import { AppNav } from '../components/AppNav'
import { signOut, useSession } from '../lib/auth-client'

const SECTIONS = [
  {
    to: '/agents',
    title: 'Agentes',
    description: 'Crie e configure os agentes de IA: objetivo, provedor/modelo e base de conhecimento.',
  },
  {
    to: '/widgets',
    title: 'Widgets',
    description: 'Crie widgets de chat, personalize a aparência e vincule cada um a um agente.',
  },
  {
    to: '/chats',
    title: 'Chats',
    description: 'Veja e responda as conversas dos visitantes em tempo real.',
  },
]

export function Dashboard() {
  const navigate = useNavigate()
  const { data: session } = useSession()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <AppNav current="/dashboard" />
        </div>
        <div className="flex items-center gap-4">
          <ApiKeySettings />
          <span className="text-sm text-slate-400">{session?.user.email}</span>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-8 md:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            className="rounded-xl border border-slate-800 bg-slate-900 p-6 transition hover:border-slate-600"
          >
            <h2 className="mb-2 font-medium">{section.title}</h2>
            <p className="text-sm text-slate-400">{section.description}</p>
          </Link>
        ))}
      </main>
    </div>
  )
}
