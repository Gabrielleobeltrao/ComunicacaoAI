import { useNavigate } from 'react-router'
import type { AgentSummary } from '../lib/types'
import type { AgentStatus } from '../ui'
import { MapAgent } from './MapAgent'
import { MapObject } from './MapObject'
import { MapZone } from './MapZone'
import { OfficeMap } from './OfficeMap'

// The office is dynamic: real agents are auto-seated at two-sided desks. Each
// desk (mesa-4-3x3) seats up to four agents — two on the far/top side facing the
// camera (frente) and two on the near/bottom side with their backs to us
// (costas). Seated agents use the half-body sprite; the chair follows the side
// (cadeira-longe behind the top row, cadeira-perto in front of the bottom row).
// Paint order back-to-front: far chairs -> top agents -> desks -> bottom agents
// -> near chairs. Clicking an agent opens its page.
const CHARS = ['bruno', 'lia', 'nina', 'teo']
const DEPT_COLORS = [
  'var(--dept-vendas)',
  'var(--dept-suporte)',
  'var(--dept-marketing)',
  'var(--dept-financeiro)',
  'var(--dept-dev)',
  'var(--dept-rh)',
]
const OBJ = '/illustrations/map/objects'

const DESK_W = 3
const DESK_DEPTH = 3
const SEAT_COLS = [52, 116] // monitor columns inside mesa-4-3x3 (56px per tile)
const PER_DESK = 4
const PER_ROW = 3
const STRIDE_X = 4.5
const STRIDE_Y = 6
const MARGIN_X = 1.5
const TOP = 1.9

// Fill order per desk: two top seats (frente) first so faces show, then the two
// bottom seats (costas).
const SLOTS = [
  { col: 0, top: true },
  { col: 1, top: true },
  { col: 0, top: false },
  { col: 1, top: false },
]

const AMBIENT: AgentStatus[] = ['working', 'thinking', 'idle', 'working', 'break']

export function OfficeFloor({ agents }: { agents: AgentSummary[] }) {
  const navigate = useNavigate()

  const deskCount = Math.max(1, Math.ceil(agents.length / PER_DESK))
  const rows = Math.ceil(deskCount / PER_ROW)
  const perRowActual = Math.min(deskCount, PER_ROW)
  const cols = Math.round(MARGIN_X * 2 + perRowActual * DESK_W + (perRowActual - 1) * (STRIDE_X - DESK_W))
  const lastDeskY = TOP + (rows - 1) * STRIDE_Y
  const loungeY = lastDeskY + DESK_DEPTH + 1.4
  const totalRows = Math.ceil(loungeY + 3.2)

  const deskAt = (d: number) => ({
    x: MARGIN_X + (d % PER_ROW) * STRIDE_X,
    y: TOP + Math.floor(d / PER_ROW) * STRIDE_Y,
  })

  // Precompute every seated agent with its desk, side and screen position.
  const seats = agents.map((a, i) => {
    const slot = SLOTS[i % PER_DESK]
    const desk = deskAt(Math.floor(i / PER_DESK))
    const x = desk.x + SEAT_COLS[slot.col] / 56 - 0.5
    const y = slot.top ? desk.y - 0.78 : desk.y + DESK_DEPTH - 1.6
    return { a, i, x, y, top: slot.top }
  })

  const topSeats = seats.filter((s) => s.top)
  const bottomSeats = seats.filter((s) => !s.top)

  const agentEl = (s: (typeof seats)[number], facing: 'frente' | 'costas', zIndex: number) => (
    <MapAgent
      key={s.a._id}
      x={s.x}
      y={s.y}
      name={s.a.name.split(' ')[0]}
      status={AMBIENT[s.i % AMBIENT.length]}
      agent={CHARS[s.i % CHARS.length]}
      facing={facing}
      seated
      department={DEPT_COLORS[s.i % DEPT_COLORS.length]}
      speaking={AMBIENT[s.i % AMBIENT.length] === 'thinking'}
      hoverLift={false}
      style={{ zIndex }}
      onOpen={() => navigate(`/agents/${s.a._id}`)}
    />
  )

  return (
    <OfficeMap cols={cols} rows={totalRows} tile={44} style={{ maxHeight: 580 }}>
      <MapZone x={0.4} y={0.4} w={cols - 0.8} h={totalRows - 0.8} floor="hall" walls={false} />

      {/* Far chairs — behind the top row (z0) */}
      {topSeats.map((s) => (
        <MapObject
          key={`fc-${s.i}`}
          x={s.x}
          y={s.y + 0.5}
          w={1}
          h={1}
          art={`${OBJ}/cadeira-longe-1x1.svg`}
          label="Cadeira"
          style={{ zIndex: 0, pointerEvents: 'none' }}
        />
      ))}

      {/* Top-side agents — face the camera (frente), z1 (desk overlaps their lap) */}
      {topSeats.map((s) => agentEl(s, 'frente', 1))}

      {/* Desks (z2) */}
      {Array.from({ length: deskCount }, (_, d) => {
        const desk = deskAt(d)
        return <MapObject key={`desk-${d}`} x={desk.x} y={desk.y} w={DESK_W} h={DESK_DEPTH} art={`${OBJ}/mesa-4-3x3.svg`} label="Mesa" style={{ zIndex: 2 }} />
      })}

      {/* Bottom-side agents — backs to the camera (costas), z3 (in front of desk) */}
      {bottomSeats.map((s) => agentEl(s, 'costas', 3))}

      {/* Near chairs — in front of the bottom row (z4) */}
      {bottomSeats.map((s) => (
        <MapObject
          key={`nc-${s.i}`}
          x={s.x - 0.075}
          y={s.y + 1}
          w={1.15}
          h={1.3}
          art={`${OBJ}/cadeira-perto-1x1.15.svg`}
          label="Cadeira"
          style={{ zIndex: 4, pointerEvents: 'none' }}
        />
      ))}

      {/* Lounge décor */}
      <MapObject x={MARGIN_X} y={loungeY} w={2} h={1} art={`${OBJ}/sofa-2x1.svg`} label="Sofá" style={{ zIndex: 1 }} />
      <MapObject x={cols - 1.4} y={loungeY} w={1} h={1} art={`${OBJ}/planta-1x1.svg`} label="Planta" style={{ zIndex: 1 }} />
      <MapObject x={cols - 1.4} y={0.9} w={1} h={1} art={`${OBJ}/planta-1x1.svg`} label="Planta" style={{ zIndex: 1 }} />
    </OfficeMap>
  )
}
