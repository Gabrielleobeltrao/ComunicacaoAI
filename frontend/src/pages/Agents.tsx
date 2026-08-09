import { useEffect, useMemo, useState } from 'react'
import { AgentCard } from '../components/AgentCard'
import { AgentForm } from '../components/AgentForm'
import { AppLayout } from '../components/AppLayout'
import type { AgentStat } from '../lib/agentAvatar'
import { API_URL } from '../lib/api'
import type { AgentCardStats } from '../lib/types'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import { Button, Dialog, EmptyState } from '../ui'

const EMPTY_STATS: AgentCardStats = { conversations: 0, attendedConversations: 0, qualifiedLeads: 0 }

// Undefined stats (still loading) render as "—"; a loaded agent with no
// activity shows zeros.
function buildStats(s: AgentCardStats | undefined): AgentStat[] {
  const pct = s && s.conversations > 0 ? `${Math.round((s.attendedConversations / s.conversations) * 100)}%` : '—'
  return [
    { label: 'Conversas', value: s ? s.conversations.toLocaleString('pt-BR') : '—' },
    { label: 'Leads', value: s ? String(s.qualifiedLeads) : '—' },
    { label: 'Atend.', value: pct },
  ]
}

export function Agents() {
  const { agents, agentsLoading, loadAgents, sectors } = useAgentsAndWidgets()
  const [isCreating, setIsCreating] = useState(false)
  const [agentStats, setAgentStats] = useState<Record<string, AgentCardStats> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/api/agent-stats`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        if (!cancelled) setAgentStats(data)
      })
      .catch(() => {
        if (!cancelled) setAgentStats({})
      })
    return () => {
      cancelled = true
    }
  }, [])

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
            <AgentCard
              key={agent._id}
              agent={agent}
              sectorName={sectorByAgent.get(agent._id) ?? null}
              stats={buildStats(agentStats ? (agentStats[agent._id] ?? EMPTY_STATS) : undefined)}
            />
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
