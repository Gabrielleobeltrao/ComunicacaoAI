import { useNavigate } from 'react-router'
import { accentFor, portraitFor, statusFor } from '../lib/agentAvatar'
import type { AgentStat } from '../lib/agentAvatar'
import { useActiveFloorId } from '../contexts/BuildingContext'
import { floorAgent } from '../lib/floorRoutes'
import { roleLabelOf, skillsOf } from '../lib/agentPresentation'
import type { AgentSummary } from '../lib/types'
import { AgentAvatar, Card, Icon, StatusPill, Tag } from '../ui'

// A clickable agent card (design's AgentCard): avatar + name + role + status,
// its sector (or "Sem setor" when orphan), a short objective, skill tags and a
// small stats grid (real per-agent stats passed in via `stats`).
export function AgentCard({ agent, stats, sectorName, portrait }: { agent: AgentSummary; stats?: AgentStat[]; sectorName?: string | null; portrait?: string }) {
  const navigate = useNavigate()
  const fid = useActiveFloorId()
  const accent = accentFor(agent._id)
  const status = statusFor(agent._id)
  const skills = skillsOf(agent)
  const metrics = stats ?? []

  return (
    <Card interactive accent={accent} onClick={() => navigate(fid ? floorAgent(fid, agent._id) : `/agents/${agent._id}`)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <AgentAvatar name={agent.name} src={portrait ?? portraitFor(agent._id)} color={accent} size="lg" status={status} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: '-.015em',
              color: 'var(--text-heading)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {agent.name}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {roleLabelOf(agent)}
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              color: sectorName ? 'var(--text-muted)' : 'var(--text-faint)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <Icon name="network" size={12} color="currentColor" />
            {sectorName || 'Sem setor'}
          </span>
          <StatusPill status={status} style={{ marginTop: 4, alignSelf: 'flex-start' }} />
        </div>
      </div>

      {agent.objective ? (
        <p
          style={{
            margin: 0,
            fontSize: 13.5,
            color: 'var(--text-muted)',
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {agent.objective}
        </p>
      ) : null}

      {skills.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {skills.slice(0, 4).map((s) => (
            <Tag key={s} color={accent}>
              {s}
            </Tag>
          ))}
        </div>
      ) : null}

      {metrics.length ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${metrics.length}, 1fr)`,
            gap: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {metrics.map((m) => (
            <div key={m.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
                {m.label}
              </span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: 'var(--text-heading)' }}>{m.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  )
}
