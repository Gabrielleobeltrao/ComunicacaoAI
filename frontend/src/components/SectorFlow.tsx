import { Link } from 'react-router'
import { useActiveFloorId } from '../contexts/BuildingContext'
import { floorAgent } from '../lib/floorRoutes'
import { normalizeSectorMode } from '../lib/sectors'
import type { AgentSummary, SectorSummary } from '../lib/types'

// The team's flow, drawn: what comes in, who touches it, what comes out.
//   organization → no Entrada/Saída at all: the group does not execute.
//   orchestrated → Entrada ↓ coordenador ↓ grupo de especialistas ↓ Saída
//   pipeline     → Entrada ↓ etapa 1 ↓ etapa 2 ↓ … ↓ Saída
//
// It reads TOP DOWN. Growing sideways forced a horizontal scrollbar on anything
// longer than three steps and made the whole page scroll on a phone; a vertical
// column uses the width it is given and long names simply wrap.

function Node({
  title,
  subtitle,
  to,
  tone = 'plain',
}: {
  title: string
  subtitle?: string
  to?: string
  tone?: 'plain' | 'edge' | 'lead'
}) {
  const body = (
    <>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)', overflowWrap: 'anywhere' }}>{title}</span>
      {subtitle ? (
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, overflowWrap: 'anywhere' }}>{subtitle}</span>
      ) : null}
    </>
  )
  const style: React.CSSProperties = {
    display: 'block',
    // Full width on a phone; a readable ceiling on a wide screen.
    width: '100%',
    minWidth: 0,
    maxWidth: 420,
    padding: '10px 14px',
    borderRadius: 10,
    textDecoration: 'none',
    textAlign: 'left',
    border: `1px solid ${tone === 'lead' ? 'var(--intent-brand)' : 'var(--border-subtle)'}`,
    background: tone === 'edge' ? 'var(--surface-sunken)' : 'var(--surface-card)',
  }
  return to ? (
    <Link to={to} style={style}>
      {body}
    </Link>
  ) : (
    <div style={style}>{body}</div>
  )
}

// Decorative: the direction is already in the reading order, so a screen reader gets
// nothing useful from it.
const Arrow = () => (
  <span aria-hidden data-testid="flow-arrow" style={{ color: 'var(--text-faint)', fontSize: 16, lineHeight: 1 }}>
    ↓
  </span>
)

const column: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minWidth: 0,
}

export function SectorFlow({ sector, agents }: { sector: SectorSummary; agents: AgentSummary[] }) {
  const fid = useActiveFloorId()
  const byId = new Map(agents.map((a) => [a._id, a]))
  const href = (agentId: string) => (fid ? floorAgent(fid, agentId) : `/agents/${agentId}`)
  const nameOf = (agentId: string) => byId.get(agentId)?.name ?? 'Agente removido'
  const mode = normalizeSectorMode(sector.mode)

  // A group that does not execute gets no Entrada and no Saída — inventing them would
  // describe a flow that does not exist.
  if (mode === 'organization') {
    return (
      <div data-testid="sector-flow" style={column}>
        {sector.members.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Nenhum agente neste grupo ainda.</p>
        ) : (
          sector.members.map((m) => <Node key={m.agentId} title={nameOf(m.agentId)} to={href(m.agentId)} />)
        )}
      </div>
    )
  }

  const stages = sector.stages ?? []
  const coordinatorId = sector.coordinatorAgentId
  const specialists = sector.members.filter((m) => m.agentId !== coordinatorId)

  return (
    <div data-testid="sector-flow" style={column}>
      <Node title="Entrada" subtitle={sector.inputContract || 'o pedido que chega'} tone="edge" />
      <Arrow />

      {mode === 'pipeline' ? (
        stages.length === 0 ? (
          <Node title="Sem etapas" subtitle="a equipe ainda não faz nada" />
        ) : (
          stages.map((s, i) => (
            <span key={s.id || `s${i}`} style={{ display: 'contents' }}>
              {i > 0 ? <Arrow /> : null}
              <Node title={`${i + 1}. ${s.name || 'Etapa'}`} subtitle={nameOf(s.agentId)} to={s.agentId ? href(s.agentId) : undefined} />
            </span>
          ))
        )
      ) : coordinatorId ? (
        <>
          <Node title={nameOf(coordinatorId)} subtitle="coordena" to={href(coordinatorId)} tone="lead" />
          {specialists.length > 0 ? (
            <>
              <Arrow />
              {/* The specialists are a GROUP the coordinator reaches as needed. They
                  are drawn side by side, without arrows between them, so nobody reads
                  them as a mandatory sequence. */}
              <div style={{ width: '100%', maxWidth: 420, minWidth: 0 }}>
                <p style={{ margin: '0 0 6px', fontSize: 11.5, color: 'var(--text-muted)' }} data-testid="specialists-note">
                  Especialistas acionados conforme a necessidade
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {specialists.map((m) => (
                    <div key={m.agentId} style={{ flex: '1 1 180px', minWidth: 0 }}>
                      <Node title={nameOf(m.agentId)} subtitle={m.routingDescription || undefined} to={href(m.agentId)} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : (
        <Node title="Sem coordenador" subtitle="a equipe ainda não tem quem receba o pedido" />
      )}

      <Arrow />
      <Node title="Saída" subtitle={sector.outputContract || 'o que a equipe entrega'} tone="edge" />
    </div>
  )
}
