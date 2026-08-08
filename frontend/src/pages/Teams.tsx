import { AppLayout } from '../components/AppLayout'
import { TeamManager } from '../components/TeamManager'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'

export function Teams() {
  const { agents, agentsLoading, teams, teamsLoading, loadTeams } = useAgentsAndWidgets()

  return (
    <AppLayout current="/teams" title="Equipes" subtitle="Agentes que atendem juntos">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 680 }}>
          Junte vários agentes especialistas numa equipe. No modo <strong>adaptativo</strong>, um
          orquestrador consulta os que fazem sentido em cada mensagem. No modo <strong>fluxo</strong>, o
          atendimento passa por etapas em sequência. Nos dois casos, o visitante conversa com um assistente
          único. Vincule a equipe a um canal na página "Canais".
        </p>
        <TeamManager
          teams={teams}
          loading={teamsLoading}
          agents={agents}
          agentsLoading={agentsLoading}
          onChange={loadTeams}
        />
      </div>
    </AppLayout>
  )
}
