import { AgentManager } from '../components/AgentManager'
import { AppLayout } from '../components/AppLayout'
import { TeamManager } from '../components/TeamManager'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'

export function Agents() {
  const { agents, agentsLoading, loadAgents, teams, teamsLoading, loadTeams } = useAgentsAndWidgets()

  return (
    <AppLayout current="/agents" title="Agentes">
      <div className="space-y-6">
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-2 font-medium">Agentes</h2>
          <p className="mb-4 text-sm text-slate-400">
            Crie um agente aqui. Para vincular a um widget, use o seletor na página "Widgets".
          </p>
          <AgentManager agents={agents} loading={agentsLoading} onChange={loadAgents} />
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-2 font-medium">Equipes</h2>
          <p className="mb-4 text-sm text-slate-400">
            Junte vários agentes especialistas numa equipe; um roteador escolhe qual responde cada
            mensagem. Vincule a equipe a um widget na página "Widgets".
          </p>
          <TeamManager
            teams={teams}
            loading={teamsLoading}
            agents={agents}
            agentsLoading={agentsLoading}
            onChange={loadTeams}
          />
        </section>
      </div>
    </AppLayout>
  )
}
