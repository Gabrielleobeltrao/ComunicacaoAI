import { AgentManager } from '../components/AgentManager'
import { AppLayout } from '../components/AppLayout'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'

export function Agents() {
  const { agents, agentsLoading, loadAgents } = useAgentsAndWidgets()

  return (
    <AppLayout current="/agents" title="Agentes">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-2 font-medium">Agentes</h2>
        <p className="mb-4 text-sm text-slate-400">
          Crie um agente aqui. Para vincular a um widget, use o seletor na página "Widgets".
        </p>
        <AgentManager agents={agents} loading={agentsLoading} onChange={loadAgents} />
      </section>
    </AppLayout>
  )
}
