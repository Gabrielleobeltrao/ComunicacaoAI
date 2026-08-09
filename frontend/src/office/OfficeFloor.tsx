import { useNavigate } from 'react-router'
import { accentFor, characterFor, statusFor } from '../lib/agentAvatar'
import type { AgentSummary, SectorSummary } from '../lib/types'
import { MapAgent } from './MapAgent'
import { MapObject } from './MapObject'
import { MapZone } from './MapZone'
import { OfficeMap } from './OfficeMap'

// The office is a floor plan: one room per sector (tinted with the sector's
// colour) holding that sector's agents at two-sided desks, plus a "Sem setor"
// area for orphan agents. Each desk (mesa-4-3x3) seats up to four — two on the
// far side facing the camera (frente) and two on the near side (costas). Paint
// order back-to-front: rooms -> far chairs -> top agents -> desks -> bottom
// agents -> near chairs. Clicking an agent opens its page.
const OBJ = '/illustrations/map/objects'

const DESK_W = 3
const DESK_DEPTH = 3
const SEAT_COLS = [52, 116] // monitor columns inside mesa-4-3x3 (56px per tile)
const PER_DESK = 4
const STRIDE_X = 4.5
const STRIDE_Y = 6
const DESKS_PER_ROOM_ROW = 2
const ROOM_PAD_X = 1
const DESK_ORIGIN_Y = 2 // top space inside a room for its label + far-agent heads
const ROOMS_PER_ROW = 2
const MAP_PAD = 0.6
const ROOM_GAP = 1.2

// Fill order per desk: two far seats (frente) first so faces show, then near.
const SLOTS = [
  { col: 0, top: true },
  { col: 1, top: true },
  { col: 0, top: false },
  { col: 1, top: false },
]

interface Room {
  key: string
  name: string
  color: string | null // null = "Sem setor" (neutral hall floor)
  agents: AgentSummary[]
}

function sizeOf(room: Room) {
  const k = room.agents.length
  const deskCount = k > 0 ? Math.ceil(k / PER_DESK) : 0
  const deskRows = deskCount > 0 ? Math.ceil(deskCount / DESKS_PER_ROOM_ROW) : 0
  const deskCols = Math.min(Math.max(deskCount, 1), DESKS_PER_ROOM_ROW)
  const innerW = deskCols * DESK_W + (deskCols - 1) * (STRIDE_X - DESK_W)
  const roomW = ROOM_PAD_X * 2 + Math.max(innerW, 3.5)
  const roomH = deskRows > 0 ? DESK_ORIGIN_Y + (deskRows - 1) * STRIDE_Y + 4 : 3
  return { roomW, roomH, deskCount }
}

export function OfficeFloor({ agents, sectors = [] }: { agents: AgentSummary[]; sectors?: SectorSummary[] }) {
  const navigate = useNavigate()

  // Group agents into rooms: one per sector (by membership) + a "Sem setor" room.
  const agentById = new Map(agents.map((a) => [a._id, a]))
  const used = new Set<string>()
  const rooms: Room[] = sectors.map((s) => {
    const members = s.members.map((m) => agentById.get(m.agentId)).filter((a): a is AgentSummary => Boolean(a))
    members.forEach((a) => used.add(a._id))
    return { key: s._id, name: s.name, color: s.color, agents: members }
  })
  const orphans = agents.filter((a) => !used.has(a._id))
  if (orphans.length > 0) rooms.push({ key: '__orphans', name: 'Sem setor', color: null, agents: orphans })

  // Pack rooms into rows; each room in a row shares that row's (max) height.
  const placed: { room: Room; x: number; y: number; w: number; h: number; deskCount: number }[] = []
  let cursorY = MAP_PAD
  let mapW = MAP_PAD * 2
  for (let r = 0; r < rooms.length; r += ROOMS_PER_ROW) {
    const rowRooms = rooms.slice(r, r + ROOMS_PER_ROW)
    const sizes = rowRooms.map(sizeOf)
    const rowH = Math.max(...sizes.map((s) => s.roomH))
    let cursorX = MAP_PAD
    rowRooms.forEach((room, i) => {
      placed.push({ room, x: cursorX, y: cursorY, w: sizes[i].roomW, h: rowH, deskCount: sizes[i].deskCount })
      cursorX += sizes[i].roomW + ROOM_GAP
    })
    mapW = Math.max(mapW, cursorX - ROOM_GAP + MAP_PAD)
    cursorY += rowH + ROOM_GAP
  }
  const cols = Math.max(6, Math.ceil(mapW))
  const totalRows = Math.max(6, Math.ceil(cursorY - ROOM_GAP + MAP_PAD))

  // Resolve every seated agent's on-screen position within its room's desks.
  const layouts = placed.map((p) => {
    const deskPos = (d: number) => ({
      x: p.x + ROOM_PAD_X + (d % DESKS_PER_ROOM_ROW) * STRIDE_X,
      y: p.y + DESK_ORIGIN_Y + Math.floor(d / DESKS_PER_ROOM_ROW) * STRIDE_Y,
    })
    const seats = p.room.agents.map((a, i) => {
      const desk = deskPos(Math.floor(i / PER_DESK))
      const slot = SLOTS[i % PER_DESK]
      return {
        a,
        top: slot.top,
        x: desk.x + SEAT_COLS[slot.col] / 56 - 0.5,
        y: slot.top ? desk.y - 0.78 : desk.y + DESK_DEPTH - 1.6,
      }
    })
    const desks = Array.from({ length: p.deskCount }, (_, d) => deskPos(d))
    return { p, seats, desks }
  })

  const topSeats = layouts.flatMap((l) => l.seats.filter((s) => s.top))
  const bottomSeats = layouts.flatMap((l) => l.seats.filter((s) => !s.top))

  const agentEl = (s: { a: AgentSummary; x: number; y: number }, facing: 'frente' | 'costas', zIndex: number) => {
    const status = statusFor(s.a._id)
    return (
      <MapAgent
        key={s.a._id}
        x={s.x}
        y={s.y}
        name={s.a.name.split(' ')[0]}
        status={status}
        agent={characterFor(s.a._id)}
        facing={facing}
        seated
        department={accentFor(s.a._id)}
        speaking={status === 'thinking'}
        hoverLift={false}
        style={{ zIndex }}
        onOpen={() => navigate(`/agents/${s.a._id}`)}
      />
    )
  }

  return (
    <OfficeMap cols={cols} rows={totalRows} tile={42} style={{ maxHeight: 600 }}>
      {/* Rooms (background) */}
      {placed.map((p) => (
        <MapZone
          key={p.room.key}
          x={p.x}
          y={p.y}
          w={p.w}
          h={p.h}
          tint={p.room.color ?? undefined}
          floor={p.room.color ? 'room' : 'hall'}
          walls={Boolean(p.room.color)}
          label={p.room.name}
        />
      ))}

      {/* Far chairs — behind the far row (z0) */}
      {topSeats.map((s) => (
        <MapObject
          key={`fc-${s.a._id}`}
          x={s.x}
          y={s.y + 0.5}
          w={1}
          h={1}
          art={`${OBJ}/cadeira-longe-1x1.svg`}
          label="Cadeira"
          style={{ zIndex: 0, pointerEvents: 'none' }}
        />
      ))}

      {/* Far-side agents — face the camera (frente), z1 */}
      {topSeats.map((s) => agentEl(s, 'frente', 1))}

      {/* Desks (z2) */}
      {layouts.flatMap((l) =>
        l.desks.map((d, i) => (
          <MapObject key={`desk-${l.p.room.key}-${i}`} x={d.x} y={d.y} w={DESK_W} h={DESK_DEPTH} art={`${OBJ}/mesa-4-3x3.svg`} label="Mesa" style={{ zIndex: 2 }} />
        )),
      )}

      {/* Near-side agents — backs to the camera (costas), z3 */}
      {bottomSeats.map((s) => agentEl(s, 'costas', 3))}

      {/* Near chairs — in front of the near row (z4) */}
      {bottomSeats.map((s) => (
        <MapObject
          key={`nc-${s.a._id}`}
          x={s.x - 0.075}
          y={s.y + 1}
          w={1.15}
          h={1.3}
          art={`${OBJ}/cadeira-perto-1x1.15.svg`}
          label="Cadeira"
          style={{ zIndex: 4, pointerEvents: 'none' }}
        />
      ))}
    </OfficeMap>
  )
}
