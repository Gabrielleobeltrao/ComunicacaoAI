// Pure, deterministic office layout. This is the extraction of the calculation
// that used to live inline in OfficeFloor: for the same inputs it produces the
// same rooms, desks, seats and loose-agent positions. It also derives the extra
// data the simulation needs (per-seat facing / exit point / z-index and the
// static obstacle rects), without changing anything visual.
import type { Cenario } from './cenarios'
import type { OfficeDirection, OfficeObstacle, OfficePoint, OfficeSeat } from './officeTypes'
import { CELL_RES, cellsOf, dilate, shapeOf } from './roomShape'
import type { RoomShape } from './roomShape'

export const DESK_W = 3 // legacy default (kept for callers); real desks carry their own w/h
export const DESK_DEPTH = 3
const DESK_ORIGIN_Y = 2 // top space inside a room for its label + far-agent heads
const ROOM_PAD_X = 1
const GAP_V = 3 // vertical gap between stacked desks (old STRIDE_Y − depth)
export const MARGIN = 1.0 // hard safety edge — nothing crosses it
const GAP_RINGS = 2 // cells of empty space kept around every room (× CELL_RES = tiles); V2: moderate compaction (was 3)
const PX_PER_TILE = 56 // sprite viewBox scale (a 3×3 desk is 168×168)

// Worker-desk catalog. Each desk FULLY seats `seats.length` agents; a sector's
// members are packed into an exact combination of these (planDesks), so a desk is
// never partially filled. `mx` is a monitor's centre in px (measured from the SVG);
// a 'far' seat faces the camera (front, its monitor drawn as a grey back), a 'near'
// seat has its back to the camera (its monitor drawn as a blue screen).
interface DeskSeat {
  mx: number
  row: 'far' | 'near'
}
export interface DeskType {
  art: string
  w: number
  h: number
  seats: DeskSeat[]
}
const far = (mx: number): DeskSeat => ({ mx, row: 'far' })
const near = (mx: number): DeskSeat => ({ mx, row: 'near' })

const DESK_1_FRONT: DeskType = { art: 'mesa-1-frente-2x2', w: 2, h: 2, seats: [far(56)] }
const DESK_1_BACK: DeskType = { art: 'mesa-1-costas-2x2', w: 2, h: 2, seats: [near(56)] }
const DESK_2_FRONT: DeskType = { art: 'mesa-2-frente-3x2', w: 3, h: 2, seats: [far(48), far(120)] }
const DESK_2_BACK: DeskType = { art: 'mesa-2-3x2', w: 3, h: 2, seats: [near(48), near(120)] }
const DESK_4: DeskType = { art: 'mesa-4-3x3', w: 3, h: 3, seats: [far(52), far(116), near(52), near(116)] }
const DESK_6: DeskType = { art: 'mesa-6-4.5x3', w: 4.5, h: 3, seats: [far(50), far(126), far(202), near(50), near(126), near(202)] }
const DESK_10: DeskType = { art: 'mesa-10-7.5x3', w: 7.5, h: 3, seats: [far(58), far(134), far(210), far(286), far(362), near(58), near(134), near(210), near(286), near(362)] }

// Exact-fill packing: decompose k members into desks (largest first), so a sector
// always shows a desk sized to its team and COMBINES desks for the in-between
// counts (3,5,7,8,9) instead of leaving empty seats. Sectors cap at 10 members, so
// one desk usually suffices; k=1 randomly faces front or back for variety.
// Real teams aren't packed to the last seat: most desks have a spare spot or two
// (people out, a growing team). Size a sector's desks for a varied number of extra
// seats than it has members, so the map shows organic empty workstations instead of
// matching the headcount exactly. Deterministic per sector; capped at the 10 max.
function deskSlack(k: number, rng: () => number): number {
  if (k <= 0) return 0
  const r = rng()
  const s = r < 0.32 ? 0 : r < 0.7 ? 1 : 2 // ~68% get 1-2 empty seats
  return Math.max(0, Math.min(s, 10 - k))
}

export function planDesks(k: number, rng: () => number): DeskType[] {
  const out: DeskType[] = []
  let rem = k
  // Per-sector desk "style" so two same-size teams don't get the identical layout:
  // sometimes one big shared bench, sometimes a mix, sometimes several small pods.
  const style = rng()
  const ladder = style < 0.4 ? [DESK_10, DESK_6, DESK_4] : style < 0.75 ? [DESK_6, DESK_4] : [DESK_4]
  for (const d of ladder) {
    while (rem >= d.seats.length) {
      out.push(d)
      rem -= d.seats.length
    }
  }
  // 2- and 1-seat desks face front or back by chance, so a floor of small sectors
  // isn't a wall of identical back-facing desks.
  while (rem >= 2) {
    out.push(rng() < 0.75 ? DESK_2_FRONT : DESK_2_BACK) // majority front — the back one looks worse en masse
    rem -= 2
  }
  while (rem >= 1) {
    out.push(rng() < 0.5 ? DESK_1_FRONT : DESK_1_BACK)
    rem -= 1
  }
  return out
}

export function hash32(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface LayoutAgent {
  _id: string
}
export interface LayoutSector {
  _id: string
  name: string
  color: string
  members: { agentId: string }[]
}
export interface LayoutInput {
  agents: LayoutAgent[]
  sectors: LayoutSector[]
  aspect: number
  amenities: Cenario[]
  amenityTint: Record<string, string>
  decorArts: string[]
}

interface Room {
  key: string
  name: string
  color: string
  memberIds: string[]
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
  plan: DeskType[]
  decorArt: string
}
type AmenityBlock = { kind: 'amenity'; key: string; cenario: Cenario; cells: Set<string>; w: number; h: number }
type Block = SectorBlock | AmenityBlock

export interface BuiltRoom {
  key: string
  kind: 'sector' | 'amenity'
  x: number
  y: number
  w: number
  h: number
  cells: Set<string>
  name: string
  color?: string // sector fill tint (hex) or amenity tint
  cenario?: Cenario
}
export interface BuiltDesk {
  roomKey: string
  x: number
  y: number
  w: number
  h: number
  art: string
}
// A desk seat with no agent (a present desk of someone who's out) — rendered as an
// empty chair so sectors look organic instead of packed to the last seat.
export interface BuiltEmptySeat {
  x: number
  y: number
  near: boolean
  sectorId: string
}
export interface BuiltDecor {
  roomKey: string
  x: number
  y: number
  art: string
}
export interface BuiltAmenityItem {
  roomKey: string
  index: number
  x: number
  y: number
  w: number
  h: number
  art: string
  label: string
  shadow?: boolean
}
export interface BuiltOfficeLayout {
  cols: number
  rows: number
  rooms: BuiltRoom[]
  seats: OfficeSeat[]
  emptySeats: BuiltEmptySeat[]
  desks: BuiltDesk[]
  decor: BuiltDecor[]
  amenityItems: BuiltAmenityItem[]
  loose: { agentId: string; point: OfficePoint }[]
  obstacles: OfficeObstacle[]
}

// Room body sized to the desk PLAN (stacked vertically), plus a varied amount of
// breathing room so sectors don't all look like the same rigid box. The extra
// space is filled by decor via shapeOf; desks stay centred inside it.
function bodyOf(memberCount: number, rng: () => number) {
  const capacity = memberCount > 0 ? memberCount + deskSlack(memberCount, rng) : 0
  const plan = planDesks(capacity, rng)
  if (plan.length === 0) {
    return { plan, bodyW: ROOM_PAD_X * 2 + 3.5 + rng() * 1.5, bodyH: 3 + rng() * 1.5 }
  }
  const maxDeskW = Math.max(...plan.map((d) => d.w))
  const spanH = plan.reduce((a, d) => a + d.h, 0) + GAP_V * (plan.length - 1)
  // Bias each room's proportions differently: some are wide, some deep, some snug —
  // so the floor isn't a row of same-shaped tall boxes.
  const shapeBias = rng()
  const extraW = 0.5 + rng() * (shapeBias < 0.38 ? 5.5 : 2) // sometimes a wide room
  const extraH = 0.5 + rng() * (shapeBias > 0.62 ? 3.5 : 1.5) // sometimes a deep one
  const bodyW = ROOM_PAD_X * 2 + Math.max(maxDeskW, 3.5) + extraW
  const bodyH = DESK_ORIGIN_Y + spanH + 1.5 + extraH
  return { plan, bodyW, bodyH }
}

/** Amenity furniture bigger than this (on either axis) blocks navigation. */
function amenityBlocks(w: number, h: number): boolean {
  return w >= 1.5 || h >= 1.5
}

export function buildOfficeLayout(input: LayoutInput): BuiltOfficeLayout {
  const { agents, sectors, aspect, amenities, decorArts } = input
  const used = new Set<string>()
  const memberSet = new Map<string, string[]>()
  const rooms: Room[] = sectors.map((s) => {
    const ids = new Set(agents.map((a) => a._id))
    const members = s.members.map((m) => m.agentId).filter((id) => ids.has(id))
    members.forEach((id) => used.add(id))
    memberSet.set(s._id, members)
    return { key: s._id, name: s.name, color: s.color, memberIds: members }
  })
  const loose = agents.filter((a) => !used.has(a._id))

  const blocks: Block[] = []
  for (const room of rooms) {
    const rng = mulberry32(hash32(room.key))
    const z = bodyOf(room.memberIds.length, rng)
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
      plan: z.plan,
      decorArt: decorArts[hash32(room.key) % decorArts.length],
    })
  }
  for (const c of amenities) {
    const cc = cellsOf([{ x: 0, y: 0, w: c.cols, h: c.rows }])
    blocks.push({ kind: 'amenity', key: `cenario-${c.id}`, cenario: c, cells: cc.cells, w: c.cols, h: c.rows })
  }

  const sumArea = blocks.reduce((acc, b) => acc + b.w * b.h, 0)
  const maxRoomW = blocks.reduce((m, b) => Math.max(m, b.w), 6)
  const targetW = Math.max(maxRoomW + 3, Math.sqrt((sumArea + loose.length * 6) * 2.9 * aspect))
  const perim = loose.length > 0 ? 2.0 : 0.6
  const OX = MARGIN + perim
  const OY = MARGIN + perim

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
    placed.push({ block: b, x: OX + (best.cx + GAP_RINGS) * CELL_RES, y: OY + (best.cy + GAP_RINGS) * CELL_RES })
  }

  let roomMaxX = OX
  let roomMaxY = OY
  for (const p of placed) {
    roomMaxX = Math.max(roomMaxX, p.x + p.block.w)
    roomMaxY = Math.max(roomMaxY, p.y + p.block.h)
  }

  const roomRects = placed.map((p) => ({ x: p.x, y: p.y - 1, x2: p.x + p.block.w, y2: p.y + p.block.h }))
  // V2 Phase 2: keep loose agents inside the activity envelope — the room cluster
  // expanded by a small margin — instead of scattering them across the whole map.
  const ENV_TILES = 2.0
  const ax0 = Math.max(MARGIN + 0.7, OX - ENV_TILES)
  const ax1 = roomMaxX + ENV_TILES
  const ay0 = Math.max(MARGIN + 0.7, OY - ENV_TILES)
  const ay1 = roomMaxY + ENV_TILES
  const loosePos: { agentId: string; point: OfficePoint }[] = []
  for (const a of loose) {
    const rng = mulberry32(hash32(a._id))
    let pos: OfficePoint | null = null
    for (let tries = 0; tries < 120; tries++) {
      const ox = ax0 + rng() * (ax1 - ax0)
      const oy = ay0 + rng() * (ay1 - ay0)
      if (roomRects.some((r) => ox + 0.7 > r.x && ox - 0.7 < r.x2 && oy + 1.5 > r.y && oy - 0.5 < r.y2)) continue
      if (loosePos.some((o) => Math.hypot(o.point.x - ox, o.point.y - oy) < 1.9)) continue
      pos = { x: ox, y: oy }
      break
    }
    if (!pos) pos = { x: ax0 + ((loosePos.length * 2.3) % Math.max(1, ax1 - ax0)), y: ay1 }
    loosePos.push({ agentId: a._id, point: pos })
  }

  let contentMaxX = roomMaxX
  let contentMaxY = roomMaxY
  for (const o of loosePos) {
    contentMaxX = Math.max(contentMaxX, o.point.x + 0.9)
    contentMaxY = Math.max(contentMaxY, o.point.y + 0.6)
  }
  const cols = Math.max(6, Math.ceil(contentMaxX + 1.2))
  const rows = Math.max(6, Math.ceil(contentMaxY + 1.2))

  // Rooms, desks, seats, decor, amenity items and obstacles.
  const builtRooms: BuiltRoom[] = []
  const desks: BuiltDesk[] = []
  const decor: BuiltDecor[] = []
  const amenityItems: BuiltAmenityItem[] = []
  const seats: OfficeSeat[] = []
  const emptySeats: BuiltEmptySeat[] = []
  const obstacles: OfficeObstacle[] = []

  for (const p of placed) {
    const b = p.block
    if (b.kind === 'amenity') {
      builtRooms.push({ key: b.key, kind: 'amenity', x: p.x, y: p.y, w: b.w, h: b.h, cells: b.cells, name: b.cenario.nome, color: input.amenityTint[b.cenario.id], cenario: b.cenario })
      b.cenario.itens.forEach((it, i) => {
        amenityItems.push({ roomKey: b.key, index: i, x: p.x + it.x, y: p.y + it.y, w: it.w, h: it.h, art: it.art, label: it.label, shadow: it.shadow })
        if (amenityBlocks(it.w, it.h)) obstacles.push({ rect: { x: p.x + it.x, y: p.y + it.y, width: it.w, height: it.h }, kind: 'object' })
      })
      continue
    }
    // sector
    builtRooms.push({ key: b.key, kind: 'sector', x: p.x, y: p.y, w: b.w, h: b.h, cells: b.cells, name: b.room.name, color: b.room.color })
    const body = b.shape.rects[0]
    const bx = p.x + (body.x - b.offx)
    const by = p.y + (body.y - b.offy)
    // Desks stacked vertically, the whole stack centred in the room body.
    const spanH = b.plan.reduce((a, d) => a + d.h, 0) + GAP_V * Math.max(0, b.plan.length - 1)
    const maxDeskW = b.plan.length ? Math.max(...b.plan.map((d) => d.w)) : 0
    const padX = Math.max(ROOM_PAD_X, (body.w - maxDeskW) / 2)
    const padY = Math.max(DESK_ORIGIN_Y, (body.h - spanH) / 2)
    let cy = padY
    let seatIdx = 0
    for (const d of b.plan) {
      const dx = bx + padX + (maxDeskW - d.w) / 2
      const dy = by + cy
      desks.push({ roomKey: b.key, x: dx, y: dy, w: d.w, h: d.h, art: d.art })
      obstacles.push({ rect: { x: dx, y: dy, width: d.w, height: d.h }, kind: 'desk' })
      for (const seat of d.seats) {
        const agentId = b.room.memberIds[seatIdx]
        const sx = dx + seat.mx / PX_PER_TILE - 0.5
        const isNear = seat.row === 'near'
        const sy = isNear ? dy + d.h - 1.6 : dy - 0.78
        if (agentId !== undefined) {
          const facing: OfficeDirection = isNear ? 'back' : 'front'
          // Exit point: a walkable cell just off the chair, into the room interior. A
          // front seat exits UP; clamp it below the top wall so a desk near the room's
          // top (small DESK_ORIGIN_Y) never puts the exit outside the room.
          const exit: OfficePoint = isNear ? { x: sx, y: sy + 2.4 } : { x: sx, y: Math.max(sy - 1.3, by + 0.7) }
          seats.push({
            id: `${b.key}:${seatIdx}`,
            agentId,
            seatedPoint: { x: sx, y: sy },
            exitPoint: exit,
            facing,
            zIndex: isNear ? 3 : 1,
            sectorId: b.key,
            chair: { near: isNear },
          })
        } else {
          // No member for this seat: an empty workstation (its chair still renders).
          emptySeats.push({ x: sx, y: sy, near: isNear, sectorId: b.key })
        }
        seatIdx++
      }
      cy += d.h + GAP_V
    }
    if (b.shape.decor) {
      const dx = p.x + (b.shape.decor.x - b.offx)
      const dy = p.y + (b.shape.decor.y - b.offy)
      decor.push({ roomKey: b.key, x: dx, y: dy, art: b.decorArt })
      obstacles.push({ rect: { x: dx - 0.85, y: dy - 1.4, width: 1.7, height: 2 }, kind: 'object' })
    }
  }

  return { cols, rows, rooms: builtRooms, seats, emptySeats, desks, decor, amenityItems, loose: loosePos, obstacles }
}
