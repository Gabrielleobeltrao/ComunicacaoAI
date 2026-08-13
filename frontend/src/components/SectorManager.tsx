import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { buildCharacterResolver } from '../lib/agentAvatar'
import type { AgentSummary, SectorSummary } from '../lib/types'
import { SectorMapCrop } from '../office/SectorMapCrop'
import { Button, Card, Dialog } from '../ui'
import { SectorForm } from './SectorForm'

interface SectorManagerProps {
  sectors: SectorSummary[]
  loading: boolean
  agents: AgentSummary[]
  agentsLoading: boolean
  floorId?: string
  onChange: () => void | Promise<void>
}

export function SectorManager({ sectors, loading, agents, agentsLoading, floorId, onChange }: SectorManagerProps) {
  const [isCreating, setIsCreating] = useState(false)
  // The card whose map crop is currently animated (hover brings the sector alive).
  const [liveId, setLiveId] = useState<string | null>(null)
  const agentNameById = useMemo(() => new Map(agents.map((a) => [a._id, a.name])), [agents])
  // Character faces for the crop sprites (same resolver as the map).
  const chars = useMemo(() => buildCharacterResolver(agents.map((a) => a._id)), [agents])

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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 14 }}>
          {sectors.map((sector) => {
            const defaultMember = sector.members.find((m) => m.isDefault)
            const defaultName = (defaultMember && agentNameById.get(defaultMember.agentId)) || null
            const names = sector.members.map((m) => agentNameById.get(m.agentId) ?? 'removido')
            const count = sector.members.length
            const modeLabel = sector.mode === 'pipeline' ? 'Fluxo' : 'Adaptativo'
            return (
              <Link
                key={sector._id}
                to={`/setores/${sector._id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
                onMouseEnter={() => setLiveId(sector._id)}
                onMouseLeave={() => setLiveId((id) => (id === sector._id ? null : id))}
              >
                <Card interactive accent={sector.color} padding="0" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {/* The "photo": a real crop of the office map where this sector sits.
                      Hovering the card animates its characters (confined to the room). */}
                  <div style={{ height: 150, background: 'var(--map-floor, #f3ecdc)', borderBottom: '1px solid var(--border-subtle)' }}>
                    <SectorMapCrop
                      key={liveId === sector._id ? 'live' : 'static'}
                      sector={sector}
                      agents={agents}
                      chars={chars}
                      live={liveId === sector._id}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
                    <p className="truncate" style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: 'var(--text-heading)' }}>
                      {sector.name}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        color: 'var(--text-muted)',
                        lineHeight: 1.45,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {count ? names.join(sector.mode === 'pipeline' ? ' → ' : ', ') : 'Sem agentes ainda'}
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
                      <Stat label="Agentes" value={String(count)} />
                      <Stat label="Modo" value={modeLabel} />
                      <Stat label="Padrão" value={defaultName ?? '—'} />
                    </div>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      <Dialog open={isCreating} onClose={() => setIsCreating(false)} title="Novo setor" width={680}>
        <SectorForm
          sector={null}
          agents={agents}
          floorId={floorId}
          onSaved={async () => {
            setIsCreating(false)
            await onChange()
          }}
        />
      </Dialog>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{label}</span>
      <span
        className="truncate"
        style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}
