import { useNavigate } from 'react-router'
import type { AgentSummary } from '../lib/types'
import type { AgentStatus } from '../ui'
import { MapAgent } from './MapAgent'
import { MapObject } from './MapObject'
import { MapZone } from './MapZone'
import { OfficeMap } from './OfficeMap'

// The office is dynamic: real agents are auto-seated at desks, each given one of
// the character sprites (cycled) and a light ambient status. Clicking an agent
// opens its page.
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
const DESK_DEPTH = 2
const SEAT_COLS = [48, 120] // monitor columns inside the desk art (56px per tile)
const PER_ROW = 3
const COL_GAP = 1.6
const ROW_GAP = 2.6
const MARGIN = 1.6

const AMBIENT: AgentStatus[] = ['working', 'thinking', 'idle', 'working', 'break']

export function OfficeFloor({ agents }: { agents: AgentSummary[] }) {
  const navigate = useNavigate()

  const deskCount = Math.max(1, Math.ceil(agents.length / 2))
  const rows = Math.ceil(deskCount / PER_ROW)
  const strideX = DESK_W + COL_GAP
  const strideY = DESK_DEPTH + ROW_GAP
  const cols = Math.round(MARGIN * 2 + PER_ROW * DESK_W + (PER_ROW - 1) * COL_GAP)
  const workBottom = MARGIN + rows * DESK_DEPTH + (rows - 1) * ROW_GAP
  const loungeY = workBottom + 0.6
  const totalRows = Math.ceil(loungeY + 3.4)

  const deskAt = (i: number) => {
    const r = Math.floor(i / PER_ROW)
    const c = i % PER_ROW
    return { x: MARGIN + c * strideX, y: MARGIN + r * strideY }
  }

  const seatOf = (index: number) => {
    const desk = deskAt(Math.floor(index / 2))
    const col = SEAT_COLS[index % 2]
    return { x: desk.x + col / 56 - 0.5, y: desk.y + DESK_DEPTH - 1.6 }
  }

  return (
    <OfficeMap cols={cols} rows={totalRows} tile={46} style={{ maxHeight: 560 }}>
      <MapZone x={0.4} y={0.4} w={cols - 0.8} h={totalRows - 0.8} floor="hall" walls={false} />

      {/* Desks (one per two agents) */}
      {Array.from({ length: deskCount }, (_, d) => {
        const desk = deskAt(d)
        return <MapObject key={`desk-${d}`} x={desk.x} y={desk.y} w={DESK_W} h={DESK_DEPTH} art={`${OBJ}/mesa-2-3x2.svg`} label="Mesa" style={{ zIndex: 1 }} />
      })}

      {/* Agents seated at their monitors */}
      {agents.map((a, i) => {
        const seat = seatOf(i)
        return (
          <MapAgent
            key={a._id}
            x={seat.x}
            y={seat.y}
            name={a.name.split(' ')[0]}
            status={AMBIENT[i % AMBIENT.length]}
            agent={CHARS[i % CHARS.length]}
            seated
            department={DEPT_COLORS[i % DEPT_COLORS.length]}
            speaking={AMBIENT[i % AMBIENT.length] === 'thinking'}
            hoverLift={false}
            style={{ zIndex: 3 }}
            onOpen={() => navigate(`/agents/${a._id}`)}
          />
        )
      })}

      {/* Lounge décor */}
      <MapObject x={MARGIN} y={loungeY + 0.4} w={2} h={1} art={`${OBJ}/sofa-2x1.svg`} label="Sofá" style={{ zIndex: 1 }} />
      <MapObject x={MARGIN + 2.4} y={loungeY + 0.2} w={1} h={1} art={`${OBJ}/planta-1x1.svg`} label="Planta" style={{ zIndex: 1 }} />
      <MapObject x={cols - 2} y={loungeY} w={1} h={1} art={`${OBJ}/planta-1x1.svg`} label="Planta" style={{ zIndex: 1 }} />
      <MapObject x={cols - 2.2} y={0.9} w={1} h={1} art={`${OBJ}/planta-1x1.svg`} label="Planta" style={{ zIndex: 1 }} />
    </OfficeMap>
  )
}
