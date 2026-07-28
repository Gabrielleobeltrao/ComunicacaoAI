import { AppLayout } from '../components/AppLayout'
import { TeamManager } from '../components/TeamManager'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'

export function Teams() {
  const { agents, agentsLoading, teams, teamsLoading, loadTeams } = useAgentsAndWidgets()

  return (
    <AppLayout current="/teams" title="Equipes">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-2 font-medium">Equipes</h2>
        <p className="mb-4 text-sm text-slate-400">
          Junte vários agentes especialistas numa equipe. No modo <strong>adaptativo</strong>, um
          orquestrador consulta os que fazem sentido em cada mensagem. No modo <strong>fluxo</strong>, o
          atendimento passa por etapas em sequência. Nos dois casos, o visitante conversa com um assistente
          único. Vincule a equipe a um widget na página "Widgets".
        </p>
        <TeamManager
          teams={teams}
          loading={teamsLoading}
          agents={agents}
          agentsLoading={agentsLoading}
          onChange={loadTeams}
        />
      </section>
    </AppLayout>
  )
}
