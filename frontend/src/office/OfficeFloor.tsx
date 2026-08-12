import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { accentFor, buildCharacterResolver, statusFor } from '../lib/agentAvatar'
import { objectSrc } from '../lib/officeAssets'
import type { AgentSummary, SectorSummary } from '../lib/types'
import { cozinha, lounge, reuniao } from './cenarios'
import type { Cenario } from './cenarios'
import { DESK_DEPTH, DESK_W, buildOfficeLayout, hash32, mulberry32 } from './buildOfficeLayout'
import type { OfficeDirection, OfficeSeat } from './officeTypes'
import { MapAgent } from './MapAgent'
import { MapObject } from './MapObject'
import { NamePill } from './NamePill'
import { OfficeMap } from './OfficeMap'
import { roundedPath, traceOutline } from './roomShape'

// The office is an organic, tetris-like floor plan (see buildOfficeLayout for the
// geometry). Here we only turn the deterministic layout into DOM: room shapes,
// desks, chairs, seated + loose agents, décor and labels. The walking simulation
// is layered on separately.
const VIEWPORT_H = 560 // map viewport height (px) — the floor's aspect follows the panel width

const AMENITIES: Cenario[] = [reuniao, cozinha, lounge]
const AMEN_TINT: Record<string, string> = { reuniao: '#38B6F0', cozinha: '#FFB53D', lounge: '#8B5CF6' }
const DECOR = ['planta-grande-1.5x2', 'samambaia-1.5x1.5', 'estante-2x1', 'prateleira-pe-1.5x1.3', 'planta-1x1', 'vaso-1x1']

// Static pose (normal / phone) per agent — stable via the id hash. The simulation
// layer will later derive this from the agent's status instead.
function poseFor(id: string): 'parado' | 'ligacao' {
  return mulberry32(hash32(`${id}:pose`))() < 0.33 ? 'ligacao' : 'parado'
}
const facingSvg = (d: OfficeDirection): 'frente' | 'costas' => (d === 'back' ? 'costas' : 'frente')

export function OfficeFloor({ agents, sectors = [] }: { agents: AgentSummary[]; sectors?: SectorSummary[] }) {
  const navigate = useNavigate()
  // Round-robin faces across the whole team, so no character repeats until the
  // cast is exhausted (then the cycle restarts).
  const chars = useMemo(() => buildCharacterResolver(agents.map((a) => a._id)), [agents])

  // Measure the panel width so the office footprint matches its aspect ratio.
  const hostRef = useRef<HTMLDivElement>(null)
  const [hostW, setHostW] = useState(0)
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(false)
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const measure = () => setHostW((w) => (w === el.clientWidth ? w : el.clientWidth))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const aspect = Math.min(3.2, Math.max(1.4, (hostW || 1100) / VIEWPORT_H))

  const layout = useMemo(
    () =>
      buildOfficeLayout({
        agents: agents.map((a) => ({ _id: a._id })),
        sectors: sectors.map((s) => ({ _id: s._id, name: s.name, color: s.color, members: s.members })),
        aspect,
        amenities: AMENITIES,
        amenityTint: AMEN_TINT,
        decorArts: DECOR,
      }),
    [agents, sectors, aspect],
  )

  const { rooms, seats, desks, decor, amenityItems, loose, cols, rows } = layout
  const agentName = useMemo(() => new Map(agents.map((a) => [a._id, a.name])), [agents])
  const farSeats = seats.filter((s) => !s.chair.near)
  const nearSeats = seats.filter((s) => s.chair.near)

  const seatedAgentEl = (s: OfficeSeat, zIndex: number) => (
    <MapAgent
      key={s.agentId}
      x={s.seatedPoint.x}
      y={s.seatedPoint.y}
      name={(agentName.get(s.agentId) ?? '').split(' ')[0]}
      status={statusFor(s.agentId)}
      agent={chars.character(s.agentId)}
      facing={facingSvg(s.facing)}
      pose={poseFor(s.agentId)}
      seated
      department={accentFor(s.agentId)}
      hoverLift={false}
      style={{ zIndex }}
      onOpen={() => navigate(`/agents/${s.agentId}`)}
    />
  )

  return (
    <div ref={hostRef}>
      <OfficeMap cols={cols} rows={rows} tile={42} fitToView labelsShown={showLabels} onToggleLabels={() => setShowLabels((v) => !v)} style={{ height: VIEWPORT_H }}>
        {/* Room shapes — tetris outlines, drawn behind everything */}
        <svg
          viewBox={`0 0 ${cols} ${rows}`}
          preserveAspectRatio="none"
          style={{ position: 'absolute', left: 0, top: 0, width: `calc(var(--tile) * ${cols})`, height: `calc(var(--tile) * ${rows})`, overflow: 'visible', pointerEvents: 'none' }}
        >
          {rooms.flatMap((r) => {
            const d = roundedPath(traceOutline(r.cells), r.x, r.y, 0.45)
            const pct = r.kind === 'sector' ? 17 : 15
            const fill = `color-mix(in oklab, ${r.color ?? '#888'} ${pct}%, var(--paper-0))`
            return [
              <path key={`${r.key}-fill`} d={d} fill={fill} stroke="var(--map-wall)" strokeWidth={4.5} vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 2px 6px var(--map-shadow))' }} />,
              <path key={`${r.key}-edge`} d={d} fill="none" stroke="var(--map-wall-edge)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />,
            ]
          })}
        </svg>

        {/* Per-room hover zones — reveal the label only while the mouse is over the room. */}
        {rooms.map((r) => (
          <div
            key={`hover-${r.key}`}
            onMouseEnter={() => setHoveredRoom(r.key)}
            onMouseLeave={() => setHoveredRoom((h) => (h === r.key ? null : h))}
            style={{ position: 'absolute', left: `calc(var(--tile) * ${r.x})`, top: `calc(var(--tile) * ${r.y})`, width: `calc(var(--tile) * ${r.w})`, height: `calc(var(--tile) * ${r.h})`, zIndex: 1 }}
          />
        ))}

        {/* Amenity furniture (from the cenário presets) — array order is paint order */}
        {amenityItems.map((it) => (
          <MapObject key={`${it.roomKey}-obj-${it.index}`} x={it.x} y={it.y} w={it.w} h={it.h} art={objectSrc(it.art)} label={it.label} shadow={it.shadow} style={{ zIndex: 2, pointerEvents: 'none' }} />
        ))}

        {/* Sector décor (in the annex) */}
        {decor.map((dc) => (
          <MapObject key={`decor-${dc.roomKey}`} x={dc.x - 0.85} y={dc.y - 1.4} w={1.7} h={2} art={objectSrc(dc.art)} label="" style={{ zIndex: 2, pointerEvents: 'none' }} />
        ))}

        {/* Labels — the hovered room always, or every room when toggled on */}
        {rooms
          .filter((r) => showLabels || r.key === hoveredRoom)
          .map((r) => (
            <NamePill
              key={`lbl-${r.key}`}
              name={r.name}
              tone="light"
              style={{ position: 'absolute', left: `calc(var(--tile) * ${r.x + r.w / 2})`, top: `calc(var(--tile) * ${r.y} - 3px)`, transform: 'translate(-50%, -100%)', zIndex: 6, whiteSpace: 'nowrap', pointerEvents: 'none' }}
            />
          ))}

        {/* Far chairs (z0) */}
        {farSeats.map((s) => (
          <MapObject key={`fc-${s.agentId}`} x={s.seatedPoint.x} y={s.seatedPoint.y + 0.5} w={1} h={1} art={objectSrc('cadeira-longe-1x1')} label="Cadeira" style={{ zIndex: 0, pointerEvents: 'none' }} />
        ))}
        {/* Far-side agents (frente, z1) */}
        {farSeats.map((s) => seatedAgentEl(s, 1))}
        {/* Desks (z2) */}
        {desks.map((d, i) => (
          <MapObject key={`desk-${d.roomKey}-${i}`} x={d.x} y={d.y} w={DESK_W} h={DESK_DEPTH} art={objectSrc('mesa-4-3x3')} label="Mesa" style={{ zIndex: 2, pointerEvents: 'none' }} />
        ))}
        {/* Near-side agents (costas, z3) */}
        {nearSeats.map((s) => seatedAgentEl(s, 3))}
        {/* Near chairs (z4) */}
        {nearSeats.map((s) => (
          <MapObject key={`nc-${s.agentId}`} x={s.seatedPoint.x - 0.075} y={s.seatedPoint.y + 1} w={1.15} h={1.3} art={objectSrc('cadeira-perto-1x1.15')} label="Cadeira" style={{ zIndex: 4, pointerEvents: 'none' }} />
        ))}

        {/* Loose agents (no sector) — scattered full-body, some front, some back */}
        {loose.map((o) => {
          const facing = mulberry32(hash32(`${o.agentId}:facing`))() < 0.4 ? 'costas' : 'frente'
          return (
            <MapAgent
              key={o.agentId}
              x={o.point.x}
              y={o.point.y}
              name={(agentName.get(o.agentId) ?? '').split(' ')[0]}
              status={statusFor(o.agentId)}
              agent={chars.character(o.agentId)}
              facing={facing}
              pose={poseFor(o.agentId)}
              department={accentFor(o.agentId)}
              hoverLift={false}
              style={{ zIndex: 3 }}
              onOpen={() => navigate(`/agents/${o.agentId}`)}
            />
          )
        })}
      </OfficeMap>
    </div>
  )
}
