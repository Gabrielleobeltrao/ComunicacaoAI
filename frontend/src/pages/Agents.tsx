import { useMemo, useState } from 'react'
import { AgentCard } from '../components/AgentCard'
import { AgentForm } from '../components/AgentForm'
import { AppLayout } from '../components/AppLayout'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import { Button, Dialog, EmptyState } from '../ui'

export function Agents() {
  const { agents, agentsLoading, loadAgents, sectors } = useAgentsAndWidgets()
  const [isCreating, setIsCreating] = useState(false)

  // An agent belongs to at most one sector — map agentId -> sector name so each
  // card can show it (or "Sem setor" when orphan).
  const sectorByAgent = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of sectors) for (const m of s.members) map.set(m.agentId, s.name)
    return map
  }, [sectors])

  return (
    <AppLayout
      current="/agents"
      title="Agentes"
      subtitle="Seu time de agentes de IA"
      actions={
        <Button icon="plus" onClick={() => setIsCreating(true)}>
          Contratar agente
        </Button>
      }
    >
      {agentsLoading ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando agentes...</p>
      ) : agents.length === 0 ? (
        <EmptyState
          icon="users-round"
          title="Nenhum agente ainda"
          body="Contrate seu primeiro agente pra começar a montar seu time."
          action={
            <Button icon="plus" onClick={() => setIsCreating(true)}>
              Contratar agente
            </Button>
          }
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {agents.map((agent) => (
            <AgentCard key={agent._id} agent={agent} sectorName={sectorByAgent.get(agent._id) ?? null} />
          ))}
        </div>
      )}

      <Dialog open={isCreating} onClose={() => setIsCreating(false)} title="Novo agente" width={680}>
        <AgentForm
          agent={null}
          onSaved={async () => {
            setIsCreating(false)
            await loadAgents()
          }}
        />
      </Dialog>
    </AppLayout>
  )
}
