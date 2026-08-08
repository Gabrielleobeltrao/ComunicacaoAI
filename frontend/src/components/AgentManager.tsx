import { useState } from 'react'
import { Link } from 'react-router'
import type { AgentSummary } from '../lib/types'
import { Button, Card, Dialog } from '../ui'
import { AgentBadges } from './AgentBadges'
import { AgentForm } from './AgentForm'

interface AgentManagerProps {
  agents: AgentSummary[]
  loading: boolean
  onChange: () => void | Promise<void>
}

export function AgentManager({ agents, loading, onChange }: AgentManagerProps) {
  const [isCreating, setIsCreating] = useState(false)

  return (
    <div className="space-y-4">
      <Button icon="plus" onClick={() => setIsCreating(true)}>
        Contratar agente
      </Button>

      {loading ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando agentes...</p>
      ) : agents.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Nenhum agente contratado ainda.</p>
      ) : (
        <ul className="space-y-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {agents.map((agent) => (
            <li key={agent._id}>
              <Link to={`/agents/${agent._id}`} style={{ textDecoration: 'none' }}>
                <Card interactive padding="16px" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{ fontWeight: 700, color: 'var(--text-heading)' }}>{agent.name}</p>
                  {agent.objective && (
                    <p className="line-clamp-2" style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                      {agent.objective}
                    </p>
                  )}
                  <AgentBadges agent={agent} />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={isCreating} onClose={() => setIsCreating(false)} title="Novo agente" width={680}>
        <AgentForm
          agent={null}
          onSaved={async () => {
            setIsCreating(false)
            await onChange()
          }}
        />
      </Dialog>
    </div>
  )
}
