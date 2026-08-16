import { useMemo } from 'react'
import { buildCharacterResolver } from '../lib/agentAvatar'
import { SectorMapCrop } from '../office/SectorMapCrop'
import type { AgentSummary, SectorSummary } from '../lib/types'

// The sector page's hero (plan §6): the SAME live crop the card shows. The crop is
// decorative — the aria-label carries the same information for screen readers (§6.4).
export function SectorHero({ sector, agents, floorName }: { sector: SectorSummary; agents: AgentSummary[]; floorName: string }) {
  const chars = useMemo(() => buildCharacterResolver(agents.map((a) => a._id)), [agents])
  const count = sector.members.length
  const description = `Sala do setor ${sector.name} com ${count} ${count === 1 ? 'agente' : 'agentes'} no andar ${floorName}.`

  return (
    <div
      data-testid="sector-hero"
      style={{
        border: '1px solid var(--border-subtle)',
        borderTop: `3px solid ${sector.color}`,
        borderRadius: 14,
        overflow: 'hidden',
        background: 'var(--map-floor, #f3ecdc)',
        // Acompanha a altura da coluna ao lado: uma sala com um retângulo bege
        // sobrando embaixo não é mapa, é espaço vazio.
        height: '100%',
        minHeight: 'clamp(180px, 42vw, 260px)',
        display: 'flex',
      }}
      role="img"
      aria-label={description}
    >
      {/* Só a sala. Nome, andar, modo, número de agentes e prontidão vivem no
          cabeçalho da página — repetir aqui era ler a mesma frase duas vezes. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <SectorMapCrop sector={sector} agents={agents} chars={chars} />
      </div>
    </div>
  )
}

export function ReadinessBadge({ readiness }: { readiness: { ready: boolean; issues: { message: string }[] } }) {
  const ready = readiness.ready
  // The first blocking issue IS the label — "Configuração incompleta" alone never
  // told the user WHAT to do.
  const label = ready ? 'Pronto' : (readiness.issues[0]?.message ?? 'Configuração incompleta')
  return (
    <span
      data-testid="sector-readiness"
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
      {label}
    </span>
  )
}
