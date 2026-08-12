// Deterministic 4-direction A* over the navigation grid. No diagonals, so it can
// never cut a wall corner. A set of temporarily-reserved cells can be avoided
// (except the goal) so agents route around each other.
import { cellIndex, inBounds, isWalkable } from './buildNavigationGrid'
import type { NavGrid } from './buildNavigationGrid'
import { pointOfCell } from './buildNavigationGrid'
import type { OfficePoint } from './officeTypes'

export interface GridCell {
  i: number
  j: number
}

const DIRS: [number, number][] = [
  [0, 1], // front (y+)
  [0, -1], // back (y-)
  [1, 0], // right (x+)
  [-1, 0], // left (x-)
]

// Tiny binary min-heap keyed by f, tie-broken by h then index — fully deterministic.
class Heap {
  private a: { f: number; h: number; idx: number }[] = []
  get size() {
    return this.a.length
  }
  private less(x: { f: number; h: number; idx: number }, y: { f: number; h: number; idx: number }): boolean {
    if (x.f !== y.f) return x.f < y.f
    if (x.h !== y.h) return x.h < y.h
    return x.idx < y.idx
  }
  push(node: { f: number; h: number; idx: number }) {
    const a = this.a
    a.push(node)
    let c = a.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (this.less(a[c], a[p])) {
        ;[a[c], a[p]] = [a[p], a[c]]
        c = p
      } else break
    }
  }
  pop(): { f: number; h: number; idx: number } | undefined {
    const a = this.a
    if (a.length === 0) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let p = 0
      for (;;) {
        const l = 2 * p + 1
        const r = 2 * p + 2
        let s = p
        if (l < a.length && this.less(a[l], a[s])) s = l
        if (r < a.length && this.less(a[r], a[s])) s = r
        if (s === p) break
        ;[a[p], a[s]] = [a[s], a[p]]
        p = s
      }
    }
    return top
  }
}

export interface FindPathOptions {
  /** Cell keys ("i,j") that are temporarily reserved and should be avoided. */
  avoid?: ReadonlySet<string>
}

/** A* from start cell to goal cell. Returns the cell path (inclusive of both
 *  ends) or null if unreachable. */
export function findOfficePathCells(grid: NavGrid, start: GridCell, goal: GridCell, opts: FindPathOptions = {}): GridCell[] | null {
  if (!isWalkable(grid, start.i, start.j) || !isWalkable(grid, goal.i, goal.j)) return null
  const { w } = grid
  const goalIdx = cellIndex(grid, goal.i, goal.j)
  const avoid = opts.avoid
  const h = (i: number, j: number) => Math.abs(i - goal.i) + Math.abs(j - goal.j)

  const gScore = new Map<number, number>()
  const cameFrom = new Map<number, number>()
  const closed = new Uint8Array(grid.w * grid.h)
  const heap = new Heap()
  const startIdx = cellIndex(grid, start.i, start.j)
  gScore.set(startIdx, 0)
  heap.push({ f: h(start.i, start.j), h: h(start.i, start.j), idx: startIdx })

  while (heap.size) {
    const cur = heap.pop()!
    const idx = cur.idx
    if (idx === goalIdx) break
    if (closed[idx]) continue
    closed[idx] = 1
    const ci = idx % w
    const cj = Math.floor(idx / w)
    const cg = gScore.get(idx)!
    for (const [di, dj] of DIRS) {
      const ni = ci + di
      const nj = cj + dj
      if (!inBounds(grid, ni, nj) || !isWalkable(grid, ni, nj)) continue
      const nk = `${ni},${nj}`
      const nIdx = cellIndex(grid, ni, nj)
      if (avoid && nIdx !== goalIdx && avoid.has(nk)) continue
      if (closed[nIdx]) continue
      const tentative = cg + 1
      const known = gScore.get(nIdx)
      if (known === undefined || tentative < known) {
        gScore.set(nIdx, tentative)
        cameFrom.set(nIdx, idx)
        const hh = h(ni, nj)
        heap.push({ f: tentative + hh, h: hh, idx: nIdx })
      }
    }
  }

  if (!cameFrom.has(goalIdx) && startIdx !== goalIdx) return null
  const path: GridCell[] = []
  let cur = goalIdx
  path.push({ i: goal.i, j: goal.j })
  while (cur !== startIdx) {
    const prev = cameFrom.get(cur)
    if (prev === undefined) return startIdx === goalIdx ? [{ i: start.i, j: start.j }] : null
    cur = prev
    path.push({ i: cur % w, j: Math.floor(cur / w) })
  }
  path.reverse()
  return path
}

/** Same as findOfficePathCells but returns tile-centre points. */
export function findOfficePath(grid: NavGrid, start: GridCell, goal: GridCell, opts?: FindPathOptions): OfficePoint[] | null {
  const cells = findOfficePathCells(grid, start, goal, opts)
  return cells ? cells.map((c) => pointOfCell(grid, c.i, c.j)) : null
}
