import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { buildCharacterResolver } from '../lib/agentAvatar'
import { sectorReadiness } from '../lib/sectors'
import { SectorMapCrop } from '../office/SectorMapCrop'
import type { AgentSummary, SectorSummary } from '../lib/types'

// The sector page's hero (plan §6): the SAME live crop the card shows, plus the
// sector's identity (name, floor, mode) and operational readiness. Two columns on
// desktop, stacked on mobile. The crop is decorative — an adjacent sentence carries
// the same information for screen readers (§6.4).
export function SectorHero({ sector, agents, floorName, actions }: { sector: SectorSummary; agents: AgentSummary[]; floorName: string; actions?: ReactNode }) {
  const chars = useMemo(() => buildCharacterResolver(agents.map((a) => a._id)), [agents])
  const readiness = sectorReadiness(sector.mode, sector.members)
  const modeLabel = sector.mode === 'pipeline' ? 'Fluxo' : 'Adaptativo'
  const count = sector.members.length
  const description = `Sala do setor ${sector.name} com ${count} ${count === 1 ? 'agente' : 'agentes'} no andar ${floorName}.`

  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderTop: `3px solid ${sector.color}`, borderRadius: 14, overflow: 'hidden', background: 'var(--surface-card)' }}>
      <div className="flex flex-col sm:flex-row">
        <div
          className="sm:w-1/2"
          role="img"
          aria-label={description}
          style={{ height: 'clamp(180px, 42vw, 260px)', background: 'var(--map-floor, #f3ecdc)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <SectorMapCrop sector={sector} agents={agents} chars={chars} />
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <p className="sr-only">{description}</p>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span style={{ width: 12, height: 12, borderRadius: 4, background: sector.color, flexShrink: 0 }} />
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: 'var(--text-heading)' }}>{sector.name}</h2>
            </div>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>
              {floorName} · {modeLabel} · {count} {count === 1 ? 'agente' : 'agentes'}
            </p>
            <ReadinessBadge readiness={readiness} />
          </div>
          {actions ? <div className="mt-auto flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
    </div>
  )
}

function ReadinessBadge({ readiness }: { readiness: 'ready' | 'incomplete' }) {
  const ready = readiness === 'ready'
  return (
    <span
      style={{
        alignSelf: 'flex-start',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 700,
        padding: '3px 10px',
        borderRadius: 999,
        color: ready ? 'var(--emerald-700, #067647)' : 'var(--mango-700, #b54708)',
        background: ready ? 'var(--emerald-100, #e6f7ee)' : 'var(--mango-100, #fef3e6)',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />
      {ready ? 'Pronto' : 'Configuração incompleta'}
    </span>
  )
}
