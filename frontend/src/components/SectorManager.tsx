import { useMemo } from 'react'
import { Link } from 'react-router'
import { buildCharacterResolver } from '../lib/agentAvatar'
import type { AgentSummary, SectorSummary } from '../lib/types'
import { useActiveFloorId } from '../contexts/BuildingContext'
import { floorSector } from '../lib/floorRoutes'
import { SECTOR_MODE_LABEL, normalizeSectorMode, sectorReadiness } from '../lib/sectors'
import { SectorMapCrop } from '../office/SectorMapCrop'
import { Card, Dialog } from '../ui'
import { SectorForm } from './SectorForm'

interface SectorManagerProps {
  sectors: SectorSummary[]
  loading: boolean
  agents: AgentSummary[]
  // Só o cabeçalho usa isto, para desabilitar "Nova equipe" enquanto carrega.
  agentsLoading?: boolean
  floorId?: string
  onChange: () => void | Promise<void>
  // Reload the agent roster after a contextual hire from inside the sector form.
  onAgentsChanged?: () => void | Promise<void>
  // O botão "Nova equipe" vive no cabeçalho da página, junto do título. O diálogo
  // continua aqui, então quem abre é de fora e o estado é do dono da página.
  creating: boolean
  onCreatingChange: (open: boolean) => void
}

export function SectorManager({ sectors, loading, agents, floorId, onChange, onAgentsChanged, creating, onCreatingChange }: SectorManagerProps) {
  const isCreating = creating
  const setIsCreating = onCreatingChange
  const fid = useActiveFloorId()
  const agentNameById = useMemo(() => new Map(agents.map((a) => [a._id, a.name])), [agents])
  // Character faces for the crop sprites (same resolver as the map).
  const chars = useMemo(() => buildCharacterResolver(agents.map((a) => a._id)), [agents])

  return (
    <div className="space-y-4">
      {loading ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando setores...</p>
      ) : sectors.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 640 }}>
          Nenhum setor ainda. Um setor é uma equipe: pode só organizar agentes no mapa, ter um gerente
          que coordena o time, ou executar um trabalho em etapas, uma depois da outra.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 14 }}>
          {sectors.map((sector) => {
            // Quem conduz a equipe. O coordenador escolhido manda; "padrão" é só o
            // substituto de quando ninguém foi escolhido — e mostrar os dois fazia
            // parecer que existe um agente privilegiado que responde por todos.
            const conduzId = sector.coordinatorAgentId ?? sector.members.find((m) => m.isDefault)?.agentId
            const conduzNome = (conduzId && agentNameById.get(conduzId)) || null
            const names = sector.members.map((m) => agentNameById.get(m.agentId) ?? 'removido')
            const count = sector.members.length
            const modeLabel = SECTOR_MODE_LABEL[normalizeSectorMode(sector.mode)].title
            // Same rule as the backend: the card says outright when the team cannot work yet.
            const ready = sectorReadiness({ mode: sector.mode, members: sector.members, coordinatorAgentId: sector.coordinatorAgentId, stages: sector.stages }).ready
            return (
              <Link key={sector._id} to={fid ? floorSector(fid, sector._id) : `/setores/${sector._id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <Card interactive accent={sector.color} padding="0" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {/* The "photo": a live crop of the office map for this sector — the
                      characters walk with the same logic as "Visão do andar", confined
                      to the sector's room. */}
                  <div style={{ height: 150, background: 'var(--map-floor, #f3ecdc)', borderBottom: '1px solid var(--border-subtle)' }}>
                    <SectorMapCrop sector={sector} agents={agents} chars={chars} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <p className="truncate" style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: 'var(--text-heading)' }}>
                        {sector.name}
                      </p>
                      {!ready && (
                        <span style={{ flexShrink: 0, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700, background: 'var(--mango-100, #fef3e6)', color: 'var(--mango-700, #b54708)' }} data-testid="sector-card-incomplete">
                          Incompleto
                        </span>
                      )}
                    </div>
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
                      <Stat label={normalizeSectorMode(sector.mode) === 'pipeline' ? 'Começa em' : 'Coordena'} value={conduzNome ?? '—'} />
                    </div>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      <Dialog open={isCreating} onClose={() => setIsCreating(false)} title="Nova equipe" width={680}>
        <SectorForm
          sector={null}
          agents={agents}
          sectors={sectors}
          floorId={floorId}
          onAgentsChanged={onAgentsChanged ?? onChange}
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
