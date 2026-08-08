import { AgentManager } from '../components/AgentManager'
import { AppLayout } from '../components/AppLayout'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'

export function Agents() {
  const { agents, agentsLoading, loadAgents } = useAgentsAndWidgets()

  return (
    <AppLayout current="/agents" title="Agentes" subtitle="Seu time de agentes de IA">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 640 }}>
          Contrate um agente aqui. Para colocá-lo pra atender, use a página "Canais". Para juntar vários
          num atendimento único, use "Equipes".
        </p>
        <AgentManager agents={agents} loading={agentsLoading} onChange={loadAgents} />
      </div>
    </AppLayout>
  )
}
