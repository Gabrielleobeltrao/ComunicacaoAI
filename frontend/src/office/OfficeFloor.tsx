import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { accentFor, buildCharacterResolver, statusFor } from '../lib/agentAvatar'
import { objectSrc } from '../lib/officeAssets'
import type { AgentSummary, SectorSummary } from '../lib/types'
import { cozinha, lounge, reuniao } from './cenarios'
import type { Cenario } from './cenarios'
import { MapAgent } from './MapAgent'
import { MapObject } from './MapObject'
import { NamePill } from './NamePill'
import { OfficeMap } from './OfficeMap'
import { CELL_RES, cellsOf, dilate, roundedPath, shapeOf, traceOutline } from './roomShape'
import type { RoomShape } from './roomShape'

// The office is an organic, tetris-like floor plan: each sector is an L / T / step
// piece (a desk body plus a décor annex) and the pieces interlock into each
// other's notches with a gap between them. A few ready-made amenity rooms
// (meeting, kitchen, lounge) are dropped in too, and agents without a sector
// stand loose in the space around the rooms. Everything is derived from ids via a
// seeded PRNG, so the messy plan is random-looking yet stable across renders.

const DESK_W = 3
const DESK_DEPTH = 3
const SEAT_COLS = [52, 116] // monitor columns inside mesa-4-3x3 (56px per tile)
const PER_DESK = 4
const STRIDE_X = 4.5
const STRIDE_Y = 6
const DESK_ORIGIN_Y = 2 // top space inside a room for its label + far-agent heads
const ROOM_PAD_X = 1
const MARGIN = 1.0 // hard safety edge — nothing crosses it
const VIEWPORT_H = 560 // map viewport height (px) — the floor's aspect follows the panel width

// Ready-made rooms dropped into the office alongside the sectors, each with its
// own coloured floor, so the floor reads like a real workplace.
const AMENITIES: Cenario[] = [reuniao, cozinha, lounge]
const AMEN_TINT: Record<string, string> = { reuniao: '#38B6F0', cozinha: '#FFB53D', lounge: '#8B5CF6' }
// Décor that fills a sector's annex bump so it reads as part of the room.
const DECOR = ['planta-grande-1.5x2', 'samambaia-1.5x1.5', 'estante-2x1', 'prateleira-pe-1.5x1.3', 'planta-1x1', 'vaso-1x1']

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

// Roughly a third of agents are on a call (phone pose), the rest idle — stable
// per agent, so the lively mix stays put across renders but differs per agent.
function poseFor(id: string): 'parado' | 'ligacao' {
  return mulberry32(hash32(`${id}:pose`))() < 0.33 ? 'ligacao' : 'parado'
}

interface Room {
  key: string
  name: string
  color: string
  agents: AgentSummary[]
}

type SectorBlock = {
  kind: 'sector'
  key: string
  room: Room
  shape: RoomShape
  cells: Set<string>
  offx: number
  offy: number
  w: number
  h: number
  deskCols: number
  deskCount: number
  decorArt: string
}
type AmenityBlock = { kind: 'amenity'; key: string; cenario: Cenario; cells: Set<string>; w: number; h: number }
type Block = SectorBlock | AmenityBlock

// The desk body of a sector — its size holds the desks; the tetris annex is added
// on top of this by shapeOf().
function bodyOf(room: Room, rng: () => number) {
  const k = room.agents.length
  const deskCount = k > 0 ? Math.ceil(k / PER_DESK) : 0
  let deskCols: number
  if (deskCount <= 1) deskCols = 1
  else if (deskCount === 2) deskCols = [1, 2, 2][Math.floor(rng() * 3)]
  else if (deskCount === 3) deskCols = [1, 2, 3][Math.floor(rng() * 3)]
  else deskCols = [2, 2, 3, 4][Math.floor(rng() * 4)]
  const deskRows = deskCount > 0 ? Math.ceil(deskCount / deskCols) : 0
  const innerW = deskCount > 0 ? deskCols * DESK_W + (deskCols - 1) * (STRIDE_X - DESK_W) : 3.5
  const bodyW = ROOM_PAD_X * 2 + Math.max(innerW, 3.5) + rng() * 0.6
  const bodyH = (deskRows > 0 ? DESK_ORIGIN_Y + (deskRows - 1) * STRIDE_Y + 4 : 3) + rng() * 0.6
  return { bodyW, bodyH, deskCols, deskCount }
}

export function OfficeFloor({ agents, sectors = [] }: { agents: AgentSummary[]; sectors?: SectorSummary[] }) {
  const navigate = useNavigate()
  // Round-robin faces across the whole team, so no character repeats until the
  // cast is exhausted (then the cycle restarts).
  const chars = useMemo(() => buildCharacterResolver(agents.map((a) => a._id)), [agents])

  // Measure the panel width so the office footprint matches its aspect ratio (a
  // wide, short banner) instead of coming out square.
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

  const layout = useMemo(() => {
    const agentById = new Map(agents.map((a) => [a._id, a]))
    const used = new Set<string>()
    const rooms: Room[] = sectors.map((s) => {
      const members = s.members.map((m) => agentById.get(m.agentId)).filter((a): a is AgentSummary => Boolean(a))
      members.forEach((a) => used.add(a._id))
      return { key: s._id, name: s.name, color: s.color, agents: members }
    })
    const loose = agents.filter((a) => !used.has(a._id))

    // Build the packable blocks: sectors (tetris shape) + amenity rectangles.
    const blocks: Block[] = []
    for (const room of rooms) {
      const rng = mulberry32(hash32(room.key))
      const z = bodyOf(room, rng)
      const shape = shapeOf(z.bodyW, z.bodyH, rng)
      const cc = cellsOf(shape.rects)
      blocks.push({
        kind: 'sector',
        key: room.key,
        room,
        shape,
        cells: cc.cells,
        offx: cc.offx,
        offy: cc.offy,
        w: cc.wc * CELL_RES,
        h: cc.hc * CELL_RES,
        deskCols: z.deskCols,
        deskCount: z.deskCount,
        decorArt: DECOR[hash32(room.key) % DECOR.length],
      })
    }
    for (const c of AMENITIES) {
      const cc = cellsOf([{ x: 0, y: 0, w: c.cols, h: c.rows }])
      blocks.push({ kind: 'amenity', key: `cenario-${c.id}`, cenario: c, cells: cc.cells, w: c.cols, h: c.rows })
    }

    // Office width scales with content AND matches the panel's aspect.
    const sumArea = blocks.reduce((acc, b) => acc + b.w * b.h, 0)
    const maxRoomW = blocks.reduce((m, b) => Math.max(m, b.w), 6)
    const targetW = Math.max(maxRoomW + 3, Math.sqrt((sumArea + loose.length * 6) * 2.9 * aspect))
    const perim = loose.length > 0 ? 2.0 : 0.6
    const OX = MARGIN + perim
    const OY = MARGIN + perim

    // Interlocking packing: place each block (largest first) at the lowest-then-
    // leftmost free spot in a dilated occupancy grid — the dilation is the gap
    // that keeps rooms from touching, while the concave notches still get filled.
    const GAP_RINGS = 3 // cells of empty space kept around every room (× CELL_RES = tiles)
    const laneCells = Math.max(4, Math.round(targetW / CELL_RES))
    const occ = new Set<string>()
    const order = [...blocks].sort((a, b) => b.cells.size - a.cells.size)
    const placed: { block: Block; x: number; y: number }[] = []
    for (const b of order) {
      let dc = b.cells
      for (let r = 0; r < GAP_RINGS; r++) dc = dilate(dc)
      const dil = [...dc].map((k) => k.split(',').map(Number))
      const wc = Math.max(...dil.map((c) => c[0])) + 1
      let best: { cx: number; cy: number } | null = null
      for (let cy = 0; cy < 600 && !best; cy++)
        for (let cx = 0; cx <= laneCells - wc; cx++) {
          let ok = true
          for (const [i, j] of dil)
            if (occ.has(`${cx + i},${cy + j}`)) {
              ok = false
              break
            }
          if (ok) {
            best = { cx, cy }
            break
          }
        }
      if (!best) best = { cx: 0, cy: 0 }
      for (const [i, j] of dil) occ.add(`${best.cx + i},${best.cy + j}`)
      // the room's own cells sit GAP_RINGS in from the dilated box corner
      placed.push({ block: b, x: OX + (best.cx + GAP_RINGS) * CELL_RES, y: OY + (best.cy + GAP_RINGS) * CELL_RES })
    }

    let roomMaxX = OX
    let roomMaxY = OY
    for (const p of placed) {
      roomMaxX = Math.max(roomMaxX, p.x + p.block.w)
      roomMaxY = Math.max(roomMaxY, p.y + p.block.h)
    }

    // Scatter loose agents around the rooms.
    const scatterCols = Math.max(6, Math.ceil(roomMaxX + perim + MARGIN))
    const scatterRows = Math.max(6, Math.ceil(roomMaxY + perim + MARGIN))
    const roomRects = placed.map((p) => ({ x: p.x, y: p.y - 1, x2: p.x + p.block.w, y2: p.y + p.block.h }))
    const ax0 = MARGIN + 0.7
    const ax1 = scatterCols - MARGIN - 0.7
    const ay0 = MARGIN + 0.7
    const ay1 = scatterRows - MARGIN - 1.6
    const loosePos: { a: AgentSummary; x: number; y: number }[] = []
    for (const a of loose) {
      const rng = mulberry32(hash32(a._id))
      let pos: { x: number; y: number } | null = null
      for (let tries = 0; tries < 120; tries++) {
        const ox = ax0 + rng() * (ax1 - ax0)
        const oy = ay0 + rng() * (ay1 - ay0)
        if (roomRects.some((r) => ox + 0.7 > r.x && ox - 0.7 < r.x2 && oy + 1.5 > r.y && oy - 0.5 < r.y2)) continue
        if (loosePos.some((o) => Math.hypot(o.x - ox, o.y - oy) < 1.9)) continue
        pos = { x: ox, y: oy }
        break
      }
      if (!pos) pos = { x: ax0 + ((loosePos.length * 2.3) % Math.max(1, ax1 - ax0)), y: ay1 }
      loosePos.push({ a, x: pos.x, y: pos.y })
    }

    let contentMaxX = roomMaxX
    let contentMaxY = roomMaxY
    for (const o of loosePos) {
      contentMaxX = Math.max(contentMaxX, o.x + 0.9)
      contentMaxY = Math.max(contentMaxY, o.y + 0.6)
    }
    const cols = Math.max(6, Math.ceil(contentMaxX + 1.2))
    const totalRows = Math.max(6, Math.ceil(contentMaxY + 1.2))

    // Desks centred in each sector's body; décor centred in its annex.
    const layouts = placed.flatMap((p) => {
      if (p.block.kind !== 'sector') return []
      const blk = p.block
      const body = blk.shape.rects[0]
      const bx = p.x + (body.x - blk.offx)
      const by = p.y + (body.y - blk.offy)
      const deskRows = Math.max(1, Math.ceil(blk.deskCount / blk.deskCols))
      const bw = (blk.deskCols - 1) * STRIDE_X + DESK_W
      const bh = (deskRows - 1) * STRIDE_Y + DESK_DEPTH
      const padX = Math.max(ROOM_PAD_X, (body.w - bw) / 2)
      const padY = Math.max(DESK_ORIGIN_Y, (body.h - bh) / 2)
      const deskPos = (d: number) => ({
        x: bx + padX + (d % blk.deskCols) * STRIDE_X,
        y: by + padY + Math.floor(d / blk.deskCols) * STRIDE_Y,
      })
      const seats = blk.room.agents.map((a, i) => {
        const desk = deskPos(Math.floor(i / PER_DESK))
        const slot = SLOTS[i % PER_DESK]
        return {
          a,
          top: slot.top,
          x: desk.x + SEAT_COLS[slot.col] / 56 - 0.5,
          y: slot.top ? desk.y - 0.78 : desk.y + DESK_DEPTH - 1.6,
        }
      })
      const desks = Array.from({ length: blk.deskCount }, (_, d) => deskPos(d))
      const decor = blk.shape.decor ? { art: blk.decorArt, x: p.x + (blk.shape.decor.x - blk.offx), y: p.y + (blk.shape.decor.y - blk.offy) } : null
      return [{ key: blk.key, seats, desks, decor }]
    })

    return { placed, layouts, loosePos, cols, totalRows }
  }, [agents, sectors, aspect])

  const { placed, layouts, loosePos, cols, totalRows } = layout
  const topSeats = layouts.flatMap((l) => l.seats.filter((s) => s.top))
  const bottomSeats = layouts.flatMap((l) => l.seats.filter((s) => !s.top))

  const seatedAgentEl = (s: { a: AgentSummary; x: number; y: number }, facing: 'frente' | 'costas', zIndex: number) => (
    <MapAgent
      key={s.a._id}
      x={s.x}
      y={s.y}
      name={s.a.name.split(' ')[0]}
      status={statusFor(s.a._id)}
      agent={chars.character(s.a._id)}
      facing={facing}
      pose={poseFor(s.a._id)}
      seated
      department={accentFor(s.a._id)}
      hoverLift={false}
      style={{ zIndex }}
      onOpen={() => navigate(`/agents/${s.a._id}`)}
    />
  )

  return (
    <div ref={hostRef}>
      <OfficeMap cols={cols} rows={totalRows} tile={42} fitToView labelsShown={showLabels} onToggleLabels={() => setShowLabels((v) => !v)} style={{ height: VIEWPORT_H }}>
        {/* Room shapes — tetris outlines, drawn behind everything */}
        <svg
          viewBox={`0 0 ${cols} ${totalRows}`}
          preserveAspectRatio="none"
          style={{ position: 'absolute', left: 0, top: 0, width: `calc(var(--tile) * ${cols})`, height: `calc(var(--tile) * ${totalRows})`, overflow: 'visible', pointerEvents: 'none' }}
        >
          {placed.flatMap((p) => {
            const d = roundedPath(traceOutline(p.block.cells), p.x, p.y, 0.45)
            const fill =
              p.block.kind === 'sector'
                ? `color-mix(in oklab, ${p.block.room.color} 17%, var(--paper-0))`
                : `color-mix(in oklab, ${AMEN_TINT[p.block.cenario.id] ?? '#888'} 15%, var(--paper-0))`
            // Two strokes = the design's wall: a light wall body plus the darker
            // edge line that defines it (like MapZone's border + inset edge).
            return [
              <path key={`${p.block.key}-fill`} d={d} fill={fill} stroke="var(--map-wall)" strokeWidth={4.5} vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 2px 6px var(--map-shadow))' }} />,
              <path key={`${p.block.key}-edge`} d={d} fill="none" stroke="var(--map-wall-edge)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />,
            ]
          })}
        </svg>

        {/* Per-room hover zones — reveal the label only while the mouse is over the
            room (furniture below has pointer-events off so it passes hover through;
            agents sit above and show their own name instead, like before). */}
        {placed.map((p) => (
          <div
            key={`hover-${p.block.key}`}
            onMouseEnter={() => setHoveredRoom(p.block.key)}
            onMouseLeave={() => setHoveredRoom((h) => (h === p.block.key ? null : h))}
            style={{
              position: 'absolute',
              left: `calc(var(--tile) * ${p.x})`,
              top: `calc(var(--tile) * ${p.y})`,
              width: `calc(var(--tile) * ${p.block.w})`,
              height: `calc(var(--tile) * ${p.block.h})`,
              zIndex: 1,
            }}
          />
        ))}

        {/* Amenity furniture (from the cenário presets) — array order is paint order */}
        {placed.flatMap((p) =>
          p.block.kind === 'amenity'
            ? p.block.cenario.itens.map((it, i) => (
                <MapObject key={`${p.block.key}-obj-${i}`} x={p.x + it.x} y={p.y + it.y} w={it.w} h={it.h} art={objectSrc(it.art)} label={it.label} shadow={it.shadow} style={{ zIndex: 2, pointerEvents: 'none' }} />
              ))
            : [],
        )}

        {/* Sector décor (in the annex) */}
        {layouts.map((l) =>
          l.decor ? <MapObject key={`decor-${l.key}`} x={l.decor.x - 0.85} y={l.decor.y - 1.4} w={1.7} h={2} art={objectSrc(l.decor.art)} label="" style={{ zIndex: 2, pointerEvents: 'none' }} /> : null,
        )}

        {/* Labels — the hovered room always, or every room when toggled on */}
        {placed
          .filter((p) => showLabels || p.block.key === hoveredRoom)
          .map((p) => (
            <NamePill
              key={`lbl-${p.block.key}`}
              name={p.block.kind === 'sector' ? p.block.room.name : p.block.cenario.nome}
              tone="light"
              style={{
                position: 'absolute',
                left: `calc(var(--tile) * ${p.x + p.block.w / 2})`,
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
          <MapObject key={`fc-${s.a._id}`} x={s.x} y={s.y + 0.5} w={1} h={1} art={objectSrc('cadeira-longe-1x1')} label="Cadeira" style={{ zIndex: 0, pointerEvents: 'none' }} />
        ))}
        {/* Far-side agents (frente, z1) */}
        {topSeats.map((s) => seatedAgentEl(s, 'frente', 1))}
        {/* Desks (z2) */}
        {layouts.flatMap((l) =>
          l.desks.map((d, i) => (
            <MapObject key={`desk-${l.key}-${i}`} x={d.x} y={d.y} w={DESK_W} h={DESK_DEPTH} art={objectSrc('mesa-4-3x3')} label="Mesa" style={{ zIndex: 2, pointerEvents: 'none' }} />
          )),
        )}
        {/* Near-side agents (costas, z3) */}
        {bottomSeats.map((s) => seatedAgentEl(s, 'costas', 3))}
        {/* Near chairs (z4) */}
        {bottomSeats.map((s) => (
          <MapObject key={`nc-${s.a._id}`} x={s.x - 0.075} y={s.y + 1} w={1.15} h={1.3} art={objectSrc('cadeira-perto-1x1.15')} label="Cadeira" style={{ zIndex: 4, pointerEvents: 'none' }} />
        ))}

        {/* Loose agents (no sector) — scattered full-body, some front, some back */}
        {loosePos.map((o) => {
          const facing = mulberry32(hash32(`${o.a._id}:facing`))() < 0.4 ? 'costas' : 'frente'
          return (
            <MapAgent
              key={o.a._id}
              x={o.x}
              y={o.y}
              name={o.a.name.split(' ')[0]}
              status={statusFor(o.a._id)}
              agent={chars.character(o.a._id)}
              facing={facing}
              pose={poseFor(o.a._id)}
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
