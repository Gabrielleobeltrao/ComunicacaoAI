import { Link, useNavigate } from 'react-router'
import { WidgetManager } from '../components/WidgetManager'
import { signOut, useSession } from '../lib/auth-client'

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
          <h1 className="text-lg font-semibold">Agentes</h1>
          <Link to="/chats" className="text-sm text-slate-400 transition hover:text-white">
            Chats
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-400">
            {session?.user.email}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-8 md:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-2 font-medium">Objetivo</h2>
          <p className="text-sm text-slate-400">
            Defina o objetivo que os agentes devem alcançar na conversa.
          </p>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-2 font-medium">Agentes conectados</h2>
          <p className="text-sm text-slate-400">
            Nenhum agente configurado ainda.
          </p>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 md:col-span-2">
          <h2 className="mb-2 font-medium">Widget de chat</h2>
          <p className="mb-4 text-sm text-slate-400">
            Crie um widget e cole o script abaixo no site do seu cliente para
            abrir um chat flutuante conectado a este objetivo.
          </p>
          <WidgetManager />
        </section>
      </main>
    </div>
  )
}
