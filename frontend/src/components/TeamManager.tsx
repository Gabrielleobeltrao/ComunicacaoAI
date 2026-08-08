import { useState } from 'react'
import { Link } from 'react-router'
import type { AgentSummary, TeamSummary } from '../lib/types'
import { Badge, Button, Card, Dialog } from '../ui'
import { TeamForm } from './TeamForm'

interface TeamManagerProps {
  teams: TeamSummary[]
  loading: boolean
  agents: AgentSummary[]
  agentsLoading: boolean
  onChange: () => void | Promise<void>
}

export function TeamManager({ teams, loading, agents, agentsLoading, onChange }: TeamManagerProps) {
  const [isCreating, setIsCreating] = useState(false)
  const agentNameById = new Map(agents.map((a) => [a._id, a.name]))

  return (
    <div className="space-y-4">
      <Button icon="plus" disabled={agentsLoading} onClick={() => setIsCreating(true)}>
        Nova equipe
      </Button>

      {loading ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando equipes...</p>
      ) : teams.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 640 }}>
          Nenhuma equipe ainda. Uma equipe junta vários agentes especialistas — no modo adaptativo um
          orquestrador consulta os que fazem sentido em cada mensagem; no modo fluxo, o atendimento passa
          por etapas em sequência. Sempre com uma voz única para o visitante.
        </p>
      ) : (
        <ul className="space-y-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {teams.map((team) => {
            const defaultMember = team.members.find((m) => m.isDefault)
            const defaultName = defaultMember ? agentNameById.get(defaultMember.agentId) : null
            const names = team.members.map((m) => agentNameById.get(m.agentId) ?? 'removido')
            return (
              <li key={team._id}>
                <Link to={`/teams/${team._id}`} style={{ textDecoration: 'none' }}>
                  <Card interactive padding="16px" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate" style={{ fontWeight: 700, color: 'var(--text-heading)' }}>
                        {team.name}
                      </p>
                      <Badge tone="brand">{team.mode === 'pipeline' ? 'Fluxo' : 'Adaptativo'}</Badge>
                      <Badge tone="neutral">
                        {team.members.length} {team.members.length === 1 ? 'agente' : 'agentes'}
                      </Badge>
                    </div>
                    <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                      {team.mode === 'pipeline' ? names.join(' → ') : names.join(', ')}
                    </p>
                    {defaultName ? (
                      <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>Padrão: {defaultName}</p>
                    ) : null}
                  </Card>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={isCreating} onClose={() => setIsCreating(false)} title="Nova equipe" width={680}>
        <TeamForm
          team={null}
          agents={agents}
          onSaved={async () => {
            setIsCreating(false)
            await onChange()
          }}
        />
      </Dialog>
    </div>
  )
}
