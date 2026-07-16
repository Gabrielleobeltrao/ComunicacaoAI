import { Link, useNavigate } from 'react-router'
import { ConversationsPanel } from '../components/ConversationsPanel'
import { signOut, useSession } from '../lib/auth-client'

export function Chats() {
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
          <h1 className="text-lg font-semibold">Chats</h1>
          <Link to="/dashboard" className="text-sm text-slate-400 transition hover:text-white">
            Dashboard
          </Link>
        </div>
        <div className="flex items-center gap-4">
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

      <main className="mx-auto max-w-5xl px-6 py-8">
        <ConversationsPanel />
      </main>
    </div>
  )
}
