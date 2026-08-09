import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { accentFor, characterFor, statusFor } from '../lib/agentAvatar'
import type { AgentSummary, SectorSummary } from '../lib/types'
import { MapAgent } from './MapAgent'
import { MapObject } from './MapObject'
import { MapZone } from './MapZone'
import { NamePill } from './NamePill'
import { OfficeMap } from './OfficeMap'

// The office is an organic floor plan (not a grid): rooms come in varied sizes
// and shapes, placed on jittered "shelves" so they never line up, and agents
// without a sector stand loose, scattered anywhere the rooms leave free — above,
// below, beside and between them. Everything is derived from ids via a seeded
// PRNG, so the messy layout is random-looking yet stable across renders. The
// footprint follows the panel's aspect (a wide, short banner) and is shrink-
// wrapped to the real content, so the office fills the viewport with no dead
// space to zoom past.
const OBJ = '/illustrations/map/objects'

const DESK_W = 3
const DESK_DEPTH = 3
const SEAT_COLS = [52, 116] // monitor columns inside mesa-4-3x3 (56px per tile)
const PER_DESK = 4
const STRIDE_X = 4.5
const STRIDE_Y = 6
const DESK_ORIGIN_Y = 2 // top space inside a room for its label + far-agent heads
const ROOM_PAD_X = 1
const MARGIN = 1.0 // hard safety edge — nothing crosses it
const LABEL_OFFSET = 0.62
const VIEWPORT_H = 560 // map viewport height (px) — the floor's aspect follows the panel width

const SLOTS = [
  { col: 0, top: true },
  { col: 1, top: true },
  { col: 0, top: false },
  { col: 1, top: false },
]

function hash32(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Room {
  key: string
  name: string
  color: string
  agents: AgentSummary[]
}

function sizeOf(room: Room, rng: () => number) {
  const k = room.agents.length
  const deskCount = k > 0 ? Math.ceil(k / PER_DESK) : 0
  let deskCols: number
  if (deskCount <= 1) deskCols = 1
  else if (deskCount === 2) deskCols = rng() < 0.5 ? 1 : 2
  else deskCols = [2, 3][Math.floor(rng() * 2)]
  const deskRows = deskCount > 0 ? Math.ceil(deskCount / deskCols) : 0
  const innerW = deskCount > 0 ? deskCols * DESK_W + (deskCols - 1) * (STRIDE_X - DESK_W) : 3.5
  const roomW = ROOM_PAD_X * 2 + Math.max(innerW, 3.5) + rng() * 0.8 // small varied extra width
  const roomH = (deskRows > 0 ? DESK_ORIGIN_Y + (deskRows - 1) * STRIDE_Y + 4 : 3) + rng() * 0.5
  return { roomW, roomH, deskCols, deskCount }
}

export function OfficeFloor({ agents, sectors = [] }: { agents: AgentSummary[]; sectors?: SectorSummary[] }) {
  const navigate = useNavigate()

  // Measure the panel width so the office footprint matches its aspect ratio (a
  // wide, short banner) instead of coming out square and leaving big empty
  // margins when the whole office is zoomed to fit.
  const hostRef = useRef<HTMLDivElement>(null)
  const [hostW, setHostW] = useState(0)
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

  const agentById = new Map(agents.map((a) => [a._id, a]))
  const used = new Set<string>()
  const rooms: Room[] = sectors.map((s) => {
    const members = s.members.map((m) => agentById.get(m.agentId)).filter((a): a is AgentSummary => Boolean(a))
    members.forEach((a) => used.add(a._id))
    return { key: s._id, name: s.name, color: s.color, agents: members }
  })
  const loose = agents.filter((a) => !used.has(a._id))

  // Size every room first, then pick an office width that scales with how much
  // content there is (rooms + loose agents) AND matches the panel's aspect, so
  // the floor is wide-and-short like the viewport rather than square.
  const roomData = rooms.map((room) => {
    const rng = mulberry32(hash32(room.key))
    return { room, size: sizeOf(room, rng), rng }
  })
  const sumArea = roomData.reduce((acc, d) => acc + d.size.roomW * d.size.roomH, 0)
  const maxRoomW = roomData.reduce((m, d) => Math.max(m, d.size.roomW), 6)
  const targetW = Math.max(maxRoomW + 3, Math.sqrt((sumArea + loose.length * 6) * 2.6 * aspect))
  const perim = loose.length > 0 ? 2.2 : 0.6

  // Place rooms on lightly-jittered shelves — varied, no grid, with roomy gaps
  // (≈ a full-body agent wide) so loose agents can stand between the sectors.
  const placed: { room: Room; x: number; y: number; w: number; h: number; deskCols: number; deskCount: number }[] = []
  let shelfTop = MARGIN + perim
  let cursorX = MARGIN + perim
  let shelfBottom = shelfTop
  let roomMaxX = MARGIN + perim
  for (const { room, size: s, rng } of roomData) {
    const gap = 2.6 + rng() * 1.4
    if (cursorX > MARGIN + perim && cursorX + gap + s.roomW > MARGIN + perim + targetW) {
      shelfTop = shelfBottom + 2.6 + rng() * 1.4
      cursorX = MARGIN + perim
      shelfBottom = shelfTop
    }
    const x = cursorX === MARGIN + perim ? cursorX : cursorX + gap
    const y = shelfTop + rng() * 1.0 // vertical jitter within the shelf
    placed.push({ room, x, y, w: s.roomW, h: s.roomH, deskCols: s.deskCols, deskCount: s.deskCount })
    cursorX = x + s.roomW
    roomMaxX = Math.max(roomMaxX, x + s.roomW)
    shelfBottom = Math.max(shelfBottom, y + s.roomH)
  }
  const roomMaxY = placed.length > 0 ? shelfBottom : MARGIN + perim

  // Provisional bounds give loose agents room to breathe around the rooms.
  const scatterCols = Math.max(6, Math.ceil(roomMaxX + perim + MARGIN))
  const scatterRows = Math.max(6, Math.ceil(roomMaxY + perim + MARGIN))

  // Scatter loose agents in whatever space the rooms leave free (all sides + gaps).
  const roomRects = placed.map((p) => ({ x: p.x, y: p.y - LABEL_OFFSET - 0.5, x2: p.x + p.w, y2: p.y + p.h }))
  const ax0 = MARGIN + 0.7
  const ax1 = scatterCols - MARGIN - 0.7
  const ay0 = MARGIN + 0.7
  const ay1 = scatterRows - MARGIN - 1.6
  const loosePos: { a: AgentSummary; x: number; y: number }[] = []
  for (const a of loose) {
    const rng = mulberry32(hash32(a._id))
    let pos: { x: number; y: number } | null = null
    for (let tries = 0; tries < 80; tries++) {
      const ox = ax0 + rng() * (ax1 - ax0)
      const oy = ay0 + rng() * (ay1 - ay0)
      const hitsRoom = roomRects.some((r) => ox + 0.7 > r.x && ox - 0.7 < r.x2 && oy + 1.5 > r.y && oy - 0.5 < r.y2)
      if (hitsRoom) continue
      if (loosePos.some((o) => Math.hypot(o.x - ox, o.y - oy) < 1.9)) continue
      pos = { x: ox, y: oy }
      break
    }
    if (!pos) {
      const k = loosePos.length
      pos = { x: ax0 + ((k * 2.3) % Math.max(1, ax1 - ax0)), y: ay1 }
    }
    loosePos.push({ a, x: pos.x, y: pos.y })
  }

  // Shrink-wrap the floor to the actual content (rooms + where loose agents
  // ended up) so there's no dead space beyond it — the office area itself is
  // the zoom-out limit.
  let contentMaxX = roomMaxX
  let contentMaxY = roomMaxY
  for (const o of loosePos) {
    contentMaxX = Math.max(contentMaxX, o.x + 0.9)
    contentMaxY = Math.max(contentMaxY, o.y + 0.6)
  }
  const cols = Math.max(6, Math.ceil(contentMaxX + 1.2))
  const totalRows = Math.max(6, Math.ceil(contentMaxY + 1.2))

  // Seats within each room's (variable) desk grid.
  const layouts = placed.map((p) => {
    const deskPos = (d: number) => ({
      x: p.x + ROOM_PAD_X + (d % p.deskCols) * STRIDE_X,
      y: p.y + DESK_ORIGIN_Y + Math.floor(d / p.deskCols) * STRIDE_Y,
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

  const seatedAgentEl = (s: { a: AgentSummary; x: number; y: number }, facing: 'frente' | 'costas', zIndex: number) => {
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
        hoverLift={false}
        style={{ zIndex }}
        onOpen={() => navigate(`/agents/${s.a._id}`)}
      />
    )
  }

  return (
    <div ref={hostRef}>
      <OfficeMap cols={cols} rows={totalRows} tile={42} fitToView style={{ height: VIEWPORT_H }}>
        {/* Sector rooms (varied sizes/shapes) */}
        {placed.map((p) => (
          <MapZone key={p.room.key} x={p.x} y={p.y} w={p.w} h={p.h} tint={p.room.color} />
        ))}

        {/* Sector labels — above each room, outside it */}
        {placed.map((p) => (
          <NamePill
            key={`lbl-${p.room.key}`}
            name={p.room.name}
            tone="light"
            style={{
              position: 'absolute',
              left: `calc(var(--tile) * ${p.x + p.w / 2})`,
              // Anchor the pill by its BOTTOM, a little above the room's top edge,
              // so it sits fully outside the room (never over the border/agents).
              top: `calc(var(--tile) * ${p.y} - 3px)`,
              transform: 'translate(-50%, -100%)',
              zIndex: 6,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          />
        ))}

        {/* Far chairs (z0) */}
        {topSeats.map((s) => (
          <MapObject key={`fc-${s.a._id}`} x={s.x} y={s.y + 0.5} w={1} h={1} art={`${OBJ}/cadeira-longe-1x1.svg`} label="Cadeira" style={{ zIndex: 0, pointerEvents: 'none' }} />
        ))}
        {/* Far-side agents (frente, z1) */}
        {topSeats.map((s) => seatedAgentEl(s, 'frente', 1))}
        {/* Desks (z2) */}
        {layouts.flatMap((l) =>
          l.desks.map((d, i) => (
            <MapObject key={`desk-${l.p.room.key}-${i}`} x={d.x} y={d.y} w={DESK_W} h={DESK_DEPTH} art={`${OBJ}/mesa-4-3x3.svg`} label="Mesa" style={{ zIndex: 2 }} />
          )),
        )}
        {/* Near-side agents (costas, z3) */}
        {bottomSeats.map((s) => seatedAgentEl(s, 'costas', 3))}
        {/* Near chairs (z4) */}
        {bottomSeats.map((s) => (
          <MapObject key={`nc-${s.a._id}`} x={s.x - 0.075} y={s.y + 1} w={1.15} h={1.3} art={`${OBJ}/cadeira-perto-1x1.15.svg`} label="Cadeira" style={{ zIndex: 4, pointerEvents: 'none' }} />
        ))}

        {/* Loose agents (no sector) — scattered full-body around the office,
            some facing front and some with their backs turned, for variety. */}
        {loosePos.map((o) => {
          const status = statusFor(o.a._id)
          const facing = mulberry32(hash32(`${o.a._id}:facing`))() < 0.4 ? 'costas' : 'frente'
          return (
            <MapAgent
              key={o.a._id}
              x={o.x}
              y={o.y}
              name={o.a.name.split(' ')[0]}
              status={status}
              agent={characterFor(o.a._id)}
              facing={facing}
              department={accentFor(o.a._id)}
              hoverLift={false}
              style={{ zIndex: 3 }}
              onOpen={() => navigate(`/agents/${o.a._id}`)}
            />
          )
        })}
      </OfficeMap>
    </div>
  )
}
