// Activity envelope (V2 Phase 2): the invisible area agents are allowed to walk
// in. It is the union of room interiors + the corridors between rooms + a
// controlled margin around the whole cluster, intersected with the walkable grid.
// Agents never pick destinations — nor let their feet land — outside it, so the
// office never sends anyone off into the empty far corners of the canvas.
import type { BuiltOfficeLayout } from './buildOfficeLayout'
import type { NavGrid } from './buildNavigationGrid'
import { cellIndex, cellOfPoint, inBounds, isWalkable } from './buildNavigationGrid'
import type { OfficePoint } from './officeTypes'

// Grid cells of margin to grow the room outline by (NAV_RES cells). ~4 cells = 2
// tiles: enough to include the corridors between compacted rooms plus a small rim.
export const ENVELOPE_MARGIN_CELLS = 4
// Hard outer blocker: the walkable area is clipped to the room+loose cluster's
// bounding box grown by this many cells (~1.5 tiles), so agents never wander off
// into the empty canvas beyond the sectors. Interior corridors are inside the box,
// so they stay connected — only the outer rim is trimmed.
const CLUSTER_MARGIN_CELLS = 3

export interface ActivityEnvelope {
  w: number
  h: number
  mask: Uint8Array // 1 = walkable AND within margin of the room cluster
}

/** Build the envelope mask over the navigation grid. */
export function buildActivityEnvelope(layout: BuiltOfficeLayout, grid: NavGrid, marginCells = ENVELOPE_MARGIN_CELLS): ActivityEnvelope {
  const { w, h } = grid
  const dist = new Int16Array(w * h).fill(-1)
  const queue: number[] = []

  // Bounding box of the seed cells (rooms + loose agents) — the cluster the walkable
  // area is later clipped to.
  let minI = w
  let maxI = 0
  let minJ = h
  let maxJ = 0
  const seed = (gi: number, gj: number) => {
    if (!inBounds(grid, gi, gj)) return
    const idx = cellIndex(grid, gi, gj)
    if (gi < minI) minI = gi
    if (gi > maxI) maxI = gi
    if (gj < minJ) minJ = gj
    if (gj > maxJ) maxJ = gj
    if (dist[idx] === -1) {
      dist[idx] = 0
      queue.push(idx)
    }
  }
  // Seeds: every room cell (global), distance 0.
  for (const r of layout.rooms) {
    const bi = Math.round(r.x / grid.res)
    const bj = Math.round(r.y / grid.res)
    for (const c of r.cells) {
      const [ci, cj] = c.split(',').map(Number)
      seed(bi + ci, bj + cj)
    }
  }
  // Seeds: where each deskless (loose) agent stands, so it is always inside the
  // envelope. Feet sit REF_DY below the draw reference (see officeSimCore).
  const REF_DX = 0.5
  const REF_DY = 1.5
  for (const o of layout.loose) {
    const c = cellOfPoint(grid, { x: o.point.x + REF_DX, y: o.point.y + REF_DY })
    seed(c.i, c.j)
  }

  // 8-connected BFS over the whole grid (walls included) up to marginCells, so the
  // margin wraps the room outline evenly and reaches across inter-room corridors.
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    const d = dist[cur]
    if (d >= marginCells) continue
    const i = cur % w
    const j = (cur - i) / w
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue
        const ni = i + di
        const nj = j + dj
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue
        const nIdx = nj * w + ni
        if (dist[nIdx] === -1) {
          dist[nIdx] = d + 1
          queue.push(nIdx)
        }
      }
  }

  // Allowed = reached within margin, actually walkable, AND inside the cluster's
  // bounding box grown by CLUSTER_MARGIN_CELLS — the outer blocker that keeps agents
  // off the empty canvas beyond the sectors.
  const cx0 = minI - CLUSTER_MARGIN_CELLS
  const cx1 = maxI + CLUSTER_MARGIN_CELLS
  const cy0 = minJ - CLUSTER_MARGIN_CELLS
  const cy1 = maxJ + CLUSTER_MARGIN_CELLS
  const mask = new Uint8Array(w * h)
  for (let idx = 0; idx < mask.length; idx++) {
    if (dist[idx] === -1) continue
    const i = idx % w
    const j = (idx - i) / w
    if (i < cx0 || i > cx1 || j < cy0 || j > cy1) continue
    if (isWalkable(grid, i, j)) mask[idx] = 1
  }
  return { w, h, mask }
}

export function inEnvelopeCell(env: ActivityEnvelope, i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= env.w || j >= env.h) return false
  return env.mask[j * env.w + i] === 1
}

export function inEnvelopePoint(env: ActivityEnvelope, grid: NavGrid, p: OfficePoint): boolean {
  const c = cellOfPoint(grid, p)
  return inEnvelopeCell(env, c.i, c.j)
}
