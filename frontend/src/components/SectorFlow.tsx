import { Link } from 'react-router'
import { useActiveFloorId } from '../contexts/BuildingContext'
import { floorAgent } from '../lib/floorRoutes'
import { normalizeSectorMode } from '../lib/sectors'
import type { AgentSummary, SectorSummary } from '../lib/types'

// The team's flow, drawn: what comes in, who touches it, what comes out.
//   organization → Entrada is absent: the group does not execute.
//   orchestrated → Entrada → coordenador → membros → Saída
//   pipeline     → Entrada → etapa 1 → etapa 2 → … → Saída
// Boxes scroll horizontally on narrow screens instead of squeezing.

function Node({ title, subtitle, to, tone = 'plain' }: { title: string; subtitle?: string; to?: string; tone?: 'plain' | 'edge' | 'lead' }) {
  const body = (
    <>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)' }}>{title}</span>
      {subtitle ? <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</span> : null}
    </>
  )
  const style: React.CSSProperties = {
    display: 'block',
    minWidth: 132,
    maxWidth: 190,
    padding: '8px 12px',
    borderRadius: 10,
    textDecoration: 'none',
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

const Arrow = () => (
  <span aria-hidden style={{ color: 'var(--text-faint)', fontSize: 16, flexShrink: 0 }}>
    →
  </span>
)

export function SectorFlow({ sector, agents }: { sector: SectorSummary; agents: AgentSummary[] }) {
  const fid = useActiveFloorId()
  const byId = new Map(agents.map((a) => [a._id, a]))
  const href = (agentId: string) => (fid ? floorAgent(fid, agentId) : `/agents/${agentId}`)
  const nameOf = (agentId: string) => byId.get(agentId)?.name ?? 'Agente removido'
  const mode = normalizeSectorMode(sector.mode)

  if (mode === 'organization') {
    return (
      <div data-testid="sector-flow" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {sector.members.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Nenhum agente neste grupo ainda.</p>
        ) : (
          sector.members.map((m) => <Node key={m.agentId} title={nameOf(m.agentId)} to={href(m.agentId)} />)
        )}
      </div>
    )
  }

  const stages = sector.stages ?? []
  const nodes =
    mode === 'pipeline'
      ? stages.map((s, i) => ({ key: s.id || `s${i}`, title: `${i + 1}. ${s.name || 'Etapa'}`, subtitle: nameOf(s.agentId), to: s.agentId ? href(s.agentId) : undefined, tone: 'plain' as const }))
      : [
          ...(sector.coordinatorAgentId
            ? [{ key: 'coord', title: nameOf(sector.coordinatorAgentId), subtitle: 'coordena', to: href(sector.coordinatorAgentId), tone: 'lead' as const }]
            : []),
          ...sector.members
            .filter((m) => m.agentId !== sector.coordinatorAgentId)
            .map((m) => ({ key: m.agentId, title: nameOf(m.agentId), subtitle: m.routingDescription || undefined, to: href(m.agentId), tone: 'plain' as const })),
        ]

  return (
    <div data-testid="sector-flow" style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
      <Node title="Entrada" subtitle={sector.inputContract || 'o pedido que chega'} tone="edge" />
      <Arrow />
      {mode === 'orchestrated' && sector.coordinatorAgentId ? (
        // The coordinator receives, then reaches the members it needs — they are one
        // group behind it, not a chain.
        <>
          <Node title={nodes[0].title} subtitle={nodes[0].subtitle} to={nodes[0].to} tone={nodes[0].tone} />
          {nodes.length > 1 ? <Arrow /> : null}
          {nodes.length > 1 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {nodes.slice(1).map((n) => (
                <Node key={n.key} title={n.title} subtitle={n.subtitle} to={n.to} tone={n.tone} />
              ))}
            </div>
          ) : null}
        </>
      ) : nodes.length === 0 ? (
        <Node title="Sem etapas" subtitle="a equipe ainda não faz nada" />
      ) : (
        nodes.map((n, i) => (
          <span key={n.key} style={{ display: 'contents' }}>
            {i > 0 ? <Arrow /> : null}
            <Node title={n.title} subtitle={n.subtitle} to={n.to} tone={n.tone} />
          </span>
        ))
      )}
      <Arrow />
      <Node title="Saída" subtitle={sector.outputContract || 'o que a equipe entrega'} tone="edge" />
    </div>
  )
}
