// Navigation grid: turns the layout's bounds, room walls, doors and obstacles
// into a grid of walkable / blocked cells. Rooms are enclosed by a one-cell wall
// ring with a single door opening; furniture is blocked and inflated by the
// walking footprint. Everything is in tile coordinates at NAV_RES resolution.
import type { BuiltOfficeLayout } from './buildOfficeLayout'
import { FOOT_RADIUS, NAV_RES } from './officeConfig'
import type { OfficeDoor, OfficePoint } from './officeTypes'

export interface NavGrid {
  res: number
  w: number // cells across
  h: number // cells down
  cols: number // office width in tiles
  rows: number // office height in tiles
  blocked: Uint8Array // 1 = blocked
  doors: OfficeDoor[]
}

export function cellIndex(g: NavGrid, i: number, j: number): number {
  return j * g.w + i
}
export function inBounds(g: NavGrid, i: number, j: number): boolean {
  return i >= 0 && j >= 0 && i < g.w && j < g.h
}
export function isWalkable(g: NavGrid, i: number, j: number): boolean {
  return inBounds(g, i, j) && g.blocked[cellIndex(g, i, j)] === 0
}
/** Grid cell that contains a tile point. */
export function cellOfPoint(g: NavGrid, p: OfficePoint): { i: number; j: number } {
  return { i: Math.floor(p.x / g.res), j: Math.floor(p.y / g.res) }
}
/** Centre tile point of a grid cell. */
export function pointOfCell(g: NavGrid, i: number, j: number): OfficePoint {
  return { x: (i + 0.5) * g.res, y: (j + 0.5) * g.res }
}

/** Nearest walkable cell to a point, searched outward up to `maxCells` rings. */
export function nearestWalkable(g: NavGrid, p: OfficePoint, maxCells = 4): { i: number; j: number } | null {
  const c = cellOfPoint(g, p)
  if (isWalkable(g, c.i, c.j)) return c
  for (let r = 1; r <= maxCells; r++) {
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
        if (isWalkable(g, c.i + di, c.j + dj)) return { i: c.i + di, j: c.j + dj }
      }
  }
  return null
}

const key = (i: number, j: number) => `${i},${j}`

export function buildNavigationGrid(layout: BuiltOfficeLayout): NavGrid {
  const res = NAV_RES
  const w = Math.round(layout.cols / res)
  const h = Math.round(layout.rows / res)
  const blocked = new Uint8Array(w * h)
  const idx = (i: number, j: number) => j * w + i

  // 1. Outer margin — nothing walks off the floor edge.
  const border = 0.6 // tiles
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const cx = (i + 0.5) * res
      const cy = (j + 0.5) * res
      if (cx < border || cy < border || cx > layout.cols - border || cy > layout.rows - border) blocked[idx(i, j)] = 1
    }

  // 2. Room membership (global cells) — a room's normalized cell (ci,cj) sits at
  //    (round(x/res)+ci, round(y/res)+cj).
  const cellRoom = new Map<string, string>() // "i,j" -> roomKey
  const roomCells = new Map<string, Set<string>>()
  for (const r of layout.rooms) {
    const bi = Math.round(r.x / res)
    const bj = Math.round(r.y / res)
    const set = new Set<string>()
    for (const c of r.cells) {
      const [ci, cj] = c.split(',').map(Number)
      const gi = bi + ci
      const gj = bj + cj
      cellRoom.set(key(gi, gj), r.key)
      set.add(key(gi, gj))
    }
    roomCells.set(r.key, set)
  }

  // 3. Walls = room cells adjacent to a non-room cell (the room's edge). Collect
  //    the edge cells per room for door selection.
  const edges = new Map<string, { i: number; j: number; out: [number, number] }[]>()
  const NB: [number, number][] = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ]
  for (const r of layout.rooms) {
    const list: { i: number; j: number; out: [number, number] }[] = []
    for (const c of roomCells.get(r.key)!) {
      const [i, j] = c.split(',').map(Number)
      for (const [di, dj] of NB) {
        if (!cellRoom.has(key(i + di, j + dj))) {
          blocked[idx(i, j)] = 1 // wall
          list.push({ i, j, out: [di, dj] })
          break
        }
      }
    }
    edges.set(r.key, list)
  }

  // 4. Obstacles (desks, big furniture, décor) inflated by the foot radius.
  for (const o of layout.obstacles) {
    const x0 = o.rect.x - FOOT_RADIUS
    const y0 = o.rect.y - FOOT_RADIUS
    const x1 = o.rect.x + o.rect.width + FOOT_RADIUS
    const y1 = o.rect.y + o.rect.height + FOOT_RADIUS
    const i0 = Math.max(0, Math.floor(x0 / res))
    const j0 = Math.max(0, Math.floor(y0 / res))
    const i1 = Math.min(w - 1, Math.ceil(x1 / res))
    const j1 = Math.min(h - 1, Math.ceil(y1 / res))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * res
        const cy = (j + 0.5) * res
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) blocked[idx(i, j)] = 1
      }
  }

  // 5. Carve one door per room: an edge cell whose outward neighbour is walkable
  //    corridor and whose inward neighbour is walkable interior. Prefer the
  //    bottom side (agents step out toward the front), then top, then sides.
  const doors: OfficeDoor[] = []
  const sideScore = (out: [number, number]) => (out[1] > 0 ? 0 : out[1] < 0 ? 1 : 2)
  for (const r of layout.rooms) {
    const list = edges.get(r.key) ?? []
    const centreI = Math.round((r.x + r.w / 2) / res)
    let best: { i: number; j: number; out: [number, number] } | null = null
    let bestScore = Infinity
    for (const e of list) {
      const [di, dj] = e.out
      const oi = e.i + di
      const oj = e.j + dj
      const ii = e.i - di
      const ij = e.j - dj
      const outerIn = oi >= 0 && oj >= 0 && oi < w && oj < h
      const outerOk = outerIn && blocked[idx(oi, oj)] === 0 && !cellRoom.has(key(oi, oj))
      const innerOk = cellRoom.get(key(ii, ij)) === r.key && blocked[idx(ii, ij)] === 0
      if (!outerOk || !innerOk) continue
      const score = sideScore(e.out) * 1000 + Math.abs(e.i - centreI)
      if (score < bestScore) {
        bestScore = score
        best = e
      }
    }
    if (best) {
      blocked[idx(best.i, best.j)] = 0 // open the threshold
      doors.push({
        sectorId: r.key,
        inner: { x: (best.i - best.out[0] + 0.5) * res, y: (best.j - best.out[1] + 0.5) * res },
        outer: { x: (best.i + best.out[0] + 0.5) * res, y: (best.j + best.out[1] + 0.5) * res },
      })
    }
  }

  return { res, w, h, cols: layout.cols, rows: layout.rows, blocked, doors }
}

/** BFS reachability between two cells (4-connected). Used by tests. */
export function isReachable(g: NavGrid, from: { i: number; j: number }, to: { i: number; j: number }): boolean {
  if (!isWalkable(g, from.i, from.j) || !isWalkable(g, to.i, to.j)) return false
  const seen = new Uint8Array(g.w * g.h)
  const queue: number[] = [cellIndex(g, from.i, from.j)]
  seen[queue[0]] = 1
  const target = cellIndex(g, to.i, to.j)
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === target) return true
    const i = cur % g.w
    const j = Math.floor(cur / g.w)
    for (const [di, dj] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as [number, number][]) {
      const ni = i + di
      const nj = j + dj
      if (isWalkable(g, ni, nj)) {
        const ni2 = cellIndex(g, ni, nj)
        if (!seen[ni2]) {
          seen[ni2] = 1
          queue.push(ni2)
        }
      }
    }
  }
  return false
}
