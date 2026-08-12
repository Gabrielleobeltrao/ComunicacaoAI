// Pure, deterministic office layout. This is the extraction of the calculation
// that used to live inline in OfficeFloor: for the same inputs it produces the
// same rooms, desks, seats and loose-agent positions. It also derives the extra
// data the simulation needs (per-seat facing / exit point / z-index and the
// static obstacle rects), without changing anything visual.
import type { Cenario } from './cenarios'
import type { OfficeDirection, OfficeObstacle, OfficePoint, OfficeSeat } from './officeTypes'
import { CELL_RES, cellsOf, dilate, shapeOf } from './roomShape'
import type { RoomShape } from './roomShape'

export const DESK_W = 3
export const DESK_DEPTH = 3
const SEAT_COLS = [52, 116] // monitor columns inside mesa-4-3x3 (56px per tile)
const PER_DESK = 4
const STRIDE_X = 4.5
const STRIDE_Y = 6
const DESK_ORIGIN_Y = 2 // top space inside a room for its label + far-agent heads
const ROOM_PAD_X = 1
export const MARGIN = 1.0 // hard safety edge — nothing crosses it
const GAP_RINGS = 2 // cells of empty space kept around every room (× CELL_RES = tiles); V2: moderate compaction (was 3)

const SLOTS = [
  { col: 0, top: true },
  { col: 1, top: true },
  { col: 0, top: false },
  { col: 1, top: false },
]

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
  deskCols: number
  deskCount: number
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
  desks: BuiltDesk[]
  decor: BuiltDecor[]
  amenityItems: BuiltAmenityItem[]
  loose: { agentId: string; point: OfficePoint }[]
  obstacles: OfficeObstacle[]
}

function bodyOf(memberCount: number, rng: () => number) {
  const k = memberCount
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
      deskCols: z.deskCols,
      deskCount: z.deskCount,
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
    const deskRows = Math.max(1, Math.ceil(b.deskCount / b.deskCols))
    const bw = (b.deskCols - 1) * STRIDE_X + DESK_W
    const bh = (deskRows - 1) * STRIDE_Y + DESK_DEPTH
    const padX = Math.max(ROOM_PAD_X, (body.w - bw) / 2)
    const padY = Math.max(DESK_ORIGIN_Y, (body.h - bh) / 2)
    const deskPos = (d: number) => ({ x: bx + padX + (d % b.deskCols) * STRIDE_X, y: by + padY + Math.floor(d / b.deskCols) * STRIDE_Y })
    for (let d = 0; d < b.deskCount; d++) {
      const dp = deskPos(d)
      desks.push({ roomKey: b.key, x: dp.x, y: dp.y })
      obstacles.push({ rect: { x: dp.x, y: dp.y, width: DESK_W, height: DESK_DEPTH }, kind: 'desk' })
    }
    b.room.memberIds.forEach((agentId, i) => {
      const desk = deskPos(Math.floor(i / PER_DESK))
      const slot = SLOTS[i % PER_DESK]
      const sx = desk.x + SEAT_COLS[slot.col] / 56 - 0.5
      const sy = slot.top ? desk.y - 0.78 : desk.y + DESK_DEPTH - 1.6
      const near = !slot.top
      const facing: OfficeDirection = near ? 'back' : 'front'
      // Exit point: a walkable cell just off the chair, into the room interior.
      const exit: OfficePoint = near ? { x: sx, y: sy + 2.4 } : { x: sx, y: sy - 1.3 }
      seats.push({
        id: `${b.key}:${i}`,
        agentId,
        seatedPoint: { x: sx, y: sy },
        exitPoint: exit,
        facing,
        zIndex: near ? 3 : 1,
        sectorId: b.key,
        chair: { near },
      })
    })
    if (b.shape.decor) {
      const dx = p.x + (b.shape.decor.x - b.offx)
      const dy = p.y + (b.shape.decor.y - b.offy)
      decor.push({ roomKey: b.key, x: dx, y: dy, art: b.decorArt })
      obstacles.push({ rect: { x: dx - 0.85, y: dy - 1.4, width: 1.7, height: 2 }, kind: 'object' })
    }
  }

  return { cols, rows, rooms: builtRooms, seats, desks, decor, amenityItems, loose: loosePos, obstacles }
}
