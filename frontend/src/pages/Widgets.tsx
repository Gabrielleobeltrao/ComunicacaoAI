import { useNavigate } from 'react-router'
import { ApiKeySettings } from '../components/ApiKeySettings'
import { AppNav } from '../components/AppNav'
import { WidgetManager } from '../components/WidgetManager'
import { signOut, useSession } from '../lib/auth-client'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'

export function Widgets() {
  const navigate = useNavigate()
  const { data: session } = useSession()
  const { widgets, widgetsLoading, loadWidgets, agents, handleAssignAgent } = useAgentsAndWidgets()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-semibold">Widgets</h1>
          <AppNav current="/widgets" />
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

      <main className="mx-auto max-w-5xl px-6 py-8">
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-2 font-medium">Widget de chat</h2>
          <p className="mb-4 text-sm text-slate-400">
            Crie um widget, escolha qual agente vai atendê-lo e cole o script abaixo no site do seu
            cliente.
          </p>
          <WidgetManager
            widgets={widgets}
            loading={widgetsLoading}
            agents={agents}
            onChange={loadWidgets}
            onAssignAgent={handleAssignAgent}
          />
        </section>
      </main>
    </div>
  )
}
