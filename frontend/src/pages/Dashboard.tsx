import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AgentManager } from '../components/AgentManager'
import { ApiKeySettings } from '../components/ApiKeySettings'
import { WidgetManager } from '../components/WidgetManager'
import { API_URL } from '../lib/api'
import { signOut, useSession } from '../lib/auth-client'
import type { AgentSummary, WidgetSummary } from '../lib/types'

export function Dashboard() {
  const navigate = useNavigate()
  const { data: session } = useSession()
  const [widgets, setWidgets] = useState<WidgetSummary[]>([])
  const [widgetsLoading, setWidgetsLoading] = useState(true)
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)

  const loadWidgets = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/widgets`, { credentials: 'include' })
    if (res.ok) setWidgets(await res.json())
    setWidgetsLoading(false)
  }, [])

  const loadAgents = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/agents`, { credentials: 'include' })
    if (res.ok) setAgents(await res.json())
    setAgentsLoading(false)
  }, [])

  useEffect(() => {
    loadWidgets()
    loadAgents()
  }, [loadWidgets, loadAgents])

  async function handleAssignAgent(widgetId: string, agentId: string) {
    if (agentId) {
      await fetch(`${API_URL}/api/agents/${agentId}/widget`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgetId }),
      })
    } else {
      const current = agents.find((agent) => agent.widgetId === widgetId)
      if (!current) return
      await fetch(`${API_URL}/api/agents/${current._id}/widget`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgetId: null }),
      })
    }
    await loadAgents()
  }

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
          <ApiKeySettings />
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

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 md:col-span-2">
          <h2 className="mb-2 font-medium">Agentes</h2>
          <p className="mb-4 text-sm text-slate-400">
            Crie um agente aqui. Para vincular a um widget, use o seletor na
            seção "Widget de chat" abaixo.
          </p>
          <AgentManager
            agents={agents}
            loading={agentsLoading}
            widgets={widgets}
            onChange={loadAgents}
          />
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 md:col-span-2">
          <h2 className="mb-2 font-medium">Widget de chat</h2>
          <p className="mb-4 text-sm text-slate-400">
            Crie um widget, escolha qual agente vai atendê-lo e cole o script
            abaixo no site do seu cliente.
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
