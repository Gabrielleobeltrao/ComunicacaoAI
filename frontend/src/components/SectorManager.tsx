import { useState } from 'react'
import { Link } from 'react-router'
import type { AgentSummary, SectorSummary } from '../lib/types'
import { Badge, Button, Card, Dialog } from '../ui'
import { SectorForm } from './SectorForm'

interface SectorManagerProps {
  sectors: SectorSummary[]
  loading: boolean
  agents: AgentSummary[]
  agentsLoading: boolean
  onChange: () => void | Promise<void>
}

export function SectorManager({ sectors, loading, agents, agentsLoading, onChange }: SectorManagerProps) {
  const [isCreating, setIsCreating] = useState(false)
  const agentNameById = new Map(agents.map((a) => [a._id, a.name]))

  return (
    <div className="space-y-4">
      <Button icon="plus" disabled={agentsLoading} onClick={() => setIsCreating(true)}>
        Novo setor
      </Button>

      {loading ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando setores...</p>
      ) : sectors.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 640 }}>
          Nenhum setor ainda. Um setor junta vários agentes especialistas — no modo adaptativo um
          orquestrador consulta os que fazem sentido em cada mensagem; no modo fluxo, o atendimento passa
          por etapas em sequência. Sempre com uma voz única para o visitante.
        </p>
      ) : (
        <ul className="space-y-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {sectors.map((sector) => {
            const defaultMember = sector.members.find((m) => m.isDefault)
            const defaultName = defaultMember ? agentNameById.get(defaultMember.agentId) : null
            const names = sector.members.map((m) => agentNameById.get(m.agentId) ?? 'removido')
            return (
              <li key={sector._id}>
                <Link to={`/setores/${sector._id}`} style={{ textDecoration: 'none' }}>
                  <Card interactive padding="16px" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate" style={{ fontWeight: 700, color: 'var(--text-heading)' }}>
                        {sector.name}
                      </p>
                      <Badge tone="brand">{sector.mode === 'pipeline' ? 'Fluxo' : 'Adaptativo'}</Badge>
                      <Badge tone="neutral">
                        {sector.members.length} {sector.members.length === 1 ? 'agente' : 'agentes'}
                      </Badge>
                    </div>
                    <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                      {sector.mode === 'pipeline' ? names.join(' → ') : names.join(', ')}
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

      <Dialog open={isCreating} onClose={() => setIsCreating(false)} title="Novo setor" width={680}>
        <SectorForm
          sector={null}
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
