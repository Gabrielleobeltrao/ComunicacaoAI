// Development overlay (?officeDebug=1). Draws the navigation structure and the
// live simulation on top of the floor so routes and collisions can be verified
// visually. It never intercepts clicks and is never shown in production unless
// the flag is set. Everything is in tile coordinates inside an SVG that scales
// with the map's zoom/pan automatically.
import { useEffect, useState } from 'react'
import type { NavGrid } from './buildNavigationGrid'
import { cellIndex, pointOfCell } from './buildNavigationGrid'
import type { BuiltOfficeLayout } from './buildOfficeLayout'
import type { ActivityEnvelope } from './buildActivityEnvelope'
import { footOf } from './officeSimCore'
import type { AgentModel, SimContext } from './officeSimCore'
import type { InteractionPoint } from './officeTypes'

interface DebugApi {
  models: () => Map<string, AgentModel>
  context: () => SimContext | null
}
interface Props {
  grid: NavGrid
  layout: BuiltOfficeLayout
  envelope?: ActivityEnvelope
  interactions: InteractionPoint[]
  debug: DebugApi
  live: boolean
}

const MOTION_COLOR: Record<string, string> = {
  seated: '#8b5cf6',
  'standing-up': '#f59e0b',
  walking: '#10b981',
  pausing: '#3b82f6',
  waiting: '#ef4444',
  returning: '#14b8a6',
  'sitting-down': '#f59e0b',
  socializing: '#ec4899',
}

export function OfficeDebugOverlay({ grid, layout, envelope, interactions, debug, live }: Props) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!live) return
    let raf = 0
    let last = 0
    const loop = (ts: number) => {
      if (ts - last > 60) {
        last = ts
        setTick((t) => (t + 1) % 1_000_000)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [live])

  // Static collision map: blocked cells as translucent red squares.
  const blockedRects: React.ReactNode[] = []
  for (let j = 0; j < grid.h; j++)
    for (let i = 0; i < grid.w; i++)
      if (grid.blocked[cellIndex(grid, i, j)] === 1) blockedRects.push(<rect key={`b${i}-${j}`} x={i * grid.res} y={j * grid.res} width={grid.res} height={grid.res} fill="rgba(239,68,68,0.16)" />)

  const models = live ? debug.models() : new Map<string, AgentModel>()
  const ctx = live ? debug.context() : null

  return (
    <svg viewBox={`0 0 ${grid.cols} ${grid.rows}`} preserveAspectRatio="none" style={{ position: 'absolute', left: 0, top: 0, width: `calc(var(--tile) * ${grid.cols})`, height: `calc(var(--tile) * ${grid.rows})`, overflow: 'visible', pointerEvents: 'none', zIndex: 900 }}>
      {/* activity envelope (allowed walking area) */}
      {envelope && (
        <g opacity={0.5}>
          {(() => {
            const cells: React.ReactNode[] = []
            for (let j = 0; j < grid.h; j++)
              for (let i = 0; i < grid.w; i++)
                if (envelope.mask[j * grid.w + i] === 1) cells.push(<rect key={`e${i}-${j}`} x={i * grid.res} y={j * grid.res} width={grid.res} height={grid.res} fill="rgba(56,189,248,0.10)" />)
            return cells
          })()}
        </g>
      )}

      {/* walkable grid dots */}
      <g opacity={0.5}>{blockedRects}</g>

      {/* physically occupied cells (never expire) */}
      {ctx &&
        [...ctx.occupiedCells.entries()].map(([k, id]) => {
          const [i, j] = k.split(',').map(Number)
          return <rect key={`occ${k}`} x={i * grid.res} y={j * grid.res} width={grid.res} height={grid.res} fill="rgba(139,92,246,0.30)" stroke="rgba(139,92,246,0.6)" strokeWidth={0.02} data-agent={id} />
        })}

      {/* reserved next cells (expire) */}
      {ctx &&
        [...ctx.reservations.entries()].map(([k, r]) => {
          const [i, j] = k.split(',').map(Number)
          return <rect key={`res${k}`} x={i * grid.res} y={j * grid.res} width={grid.res} height={grid.res} fill="rgba(245,158,11,0.35)" data-agent={r.agentId} />
        })}

      {/* global mode banner (recall) */}
      {ctx?.recall && (
        <text x={0.4} y={0.7} fontSize={0.5} fill="#f59e0b" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
          RECALL
        </text>
      )}

      {/* doors */}
      {grid.doors.map((d) => (
        <g key={`door-${d.sectorId}`}>
          <line x1={d.inner.x} y1={d.inner.y} x2={d.outer.x} y2={d.outer.y} stroke="#22c55e" strokeWidth={0.08} />
          <circle cx={d.inner.x} cy={d.inner.y} r={0.16} fill="#22c55e" />
          <circle cx={d.outer.x} cy={d.outer.y} r={0.16} fill="#16a34a" />
        </g>
      ))}

      {/* seats + chair exits */}
      {layout.seats.map((s) => (
        <g key={`seat-${s.id}`}>
          <rect x={s.seatedPoint.x - 0.12} y={s.seatedPoint.y - 0.12} width={0.24} height={0.24} fill="#8b5cf6" />
          <circle cx={s.exitPoint.x} cy={s.exitPoint.y} r={0.13} fill="none" stroke="#8b5cf6" strokeWidth={0.05} />
        </g>
      ))}

      {/* interaction points + facing tick */}
      {interactions.map((it) => {
        const f = it.facing
        const ax = f === 'left' ? -0.3 : f === 'right' ? 0.3 : 0
        const ay = f === 'front' ? 0.3 : f === 'back' ? -0.3 : 0
        return (
          <g key={`ip-${it.id}`}>
            <path d={`M ${it.point.x} ${it.point.y - 0.2} L ${it.point.x + 0.2} ${it.point.y} L ${it.point.x} ${it.point.y + 0.2} L ${it.point.x - 0.2} ${it.point.y} Z`} fill="rgba(59,130,246,0.7)" />
            <line x1={it.point.x} y1={it.point.y} x2={it.point.x + ax} y2={it.point.y + ay} stroke="#3b82f6" strokeWidth={0.06} />
          </g>
        )
      })}

      {/* live agents: current route, foot point, motion label */}
      {[...models.values()].map((m) => {
        const foot = footOf(m.pos)
        const color = MOTION_COLOR[m.motion] ?? '#64748b'
        const routePts = m.route.slice(m.routeIdx).map((c) => pointOfCell(grid, c.i, c.j))
        // conversation link: a line to the partner's slot + the pair id
        let social: React.ReactNode = null
        if (m.social) {
          const partner = models.get(m.social.partnerId)
          if (partner) {
            const pf = footOf(partner.pos)
            social = (
              <>
                <line x1={foot.x} y1={foot.y} x2={pf.x} y2={pf.y} stroke="#ec4899" strokeWidth={0.05} strokeDasharray="0.1 0.1" />
                {m.social.talking && (
                  <text x={foot.x} y={foot.y + 0.4} fontSize={0.28} fill="#ec4899" style={{ fontFamily: 'monospace' }}>
                    {m.social.pairId}
                  </text>
                )}
              </>
            )
          }
        }
        return (
          <g key={`agent-${m.id}`}>
            {routePts.length > 1 && <polyline points={routePts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={0.06} strokeDasharray="0.2 0.15" opacity={0.9} />}
            {social}
            <circle cx={foot.x} cy={foot.y} r={0.16} fill={color} />
            <text x={foot.x + 0.2} y={foot.y - 0.2} fontSize={0.35} fill={color} style={{ fontFamily: 'monospace' }}>
              {m.motion === 'seated' ? '' : m.motion}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
