// Tetris-style room shapes: a body rectangle plus one annex bump, turned into a
// rounded outline path and a cell footprint for interlocking placement.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface RoomShape {
  rects: Rect[]
  decor: { x: number; y: number } | null
}

const RES = 0.5 // cell size in tiles

// Body rectangle plus 0, 1 or 2 annex bumps on distinct sides → a varied silhouette
// (plain rect, L, T, step, U…), so no two sectors read as the same shape. The first
// annex is where a piece of décor goes, so it reads as part of the room.
export function shapeOf(bodyW: number, bodyH: number, rng: () => number): RoomShape {
  const rects: Rect[] = [{ x: 0, y: 0, w: bodyW, h: bodyH }]
  const roll = rng()
  const annexCount = roll < 0.22 ? 0 : roll < 0.68 ? 1 : 2
  const used = new Set<string>()
  const sides = ['top', 'bottom', 'left', 'right']

  const addAnnex = (): { x: number; y: number } => {
    let side = sides[Math.floor(rng() * 4)]
    for (let g = 0; used.has(side) && g < 8; g++) side = sides[Math.floor(rng() * 4)]
    used.add(side)
    const depth = 2.2 + rng() * 1.8
    if (side === 'top' || side === 'bottom') {
      const len = Math.max(2.4, bodyW * (0.35 + rng() * 0.4))
      const pos = [0, (bodyW - len) / 2, bodyW - len][Math.floor(rng() * 3)]
      const y = side === 'top' ? -depth : bodyH
      rects.push({ x: pos, y, w: len, h: depth })
      return { x: pos + len / 2, y: y + depth / 2 }
    }
    const len = Math.max(2.4, bodyH * (0.35 + rng() * 0.35))
    const pos = [0, (bodyH - len) / 2, bodyH - len][Math.floor(rng() * 3)]
    const x = side === 'left' ? -depth : bodyW
    rects.push({ x, y: pos, w: depth, h: len })
    return { x: x + depth / 2, y: pos + len / 2 }
  }

  let decor: { x: number; y: number } | null = null
  for (let i = 0; i < annexCount; i++) {
    const d = addAnnex()
    if (i === 0) decor = d
  }
  return { rects, decor }
}

// Cells covered by the rects, normalized so the min cell is (0,0). `offx/offy` map
// a body-local coordinate to the normalized origin (rectX - offx).
export function cellsOf(rects: Rect[]) {
  const raw = new Set<string>()
  let minx = Infinity
  let miny = Infinity
  let maxx = -Infinity
  let maxy = -Infinity
  for (const r of rects) {
    const i0 = Math.round(r.x / RES)
    const j0 = Math.round(r.y / RES)
    const i1 = Math.round((r.x + r.w) / RES)
    const j1 = Math.round((r.y + r.h) / RES)
    for (let i = i0; i < i1; i++)
      for (let j = j0; j < j1; j++) {
        raw.add(`${i},${j}`)
        minx = Math.min(minx, i)
        miny = Math.min(miny, j)
        maxx = Math.max(maxx, i + 1)
        maxy = Math.max(maxy, j + 1)
      }
  }
  const cells = new Set<string>()
  for (const k of raw) {
    const [i, j] = k.split(',').map(Number)
    cells.add(`${i - minx},${j - miny}`)
  }
  return { cells, offx: minx * RES, offy: miny * RES, wc: maxx - minx, hc: maxy - miny }
}

// One-cell dilation — used for packing so rooms keep a gap between them.
export function dilate(cells: Set<string>): Set<string> {
  const out = new Set(cells)
  for (const k of cells) {
    const [i, j] = k.split(',').map(Number)
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.add(`${i + di},${j + dj}`)
  }
  return out
}

// Trace the outer boundary of a (simply-connected) cell set into a polygon of
// cell-unit vertices, dropping collinear points.
export function traceOutline(cells: Set<string>): [number, number][] {
  const has = (i: number, j: number) => cells.has(`${i},${j}`)
  const edges = new Map<string, [number, number]>()
  for (const k of cells) {
    const [i, j] = k.split(',').map(Number)
    if (!has(i, j - 1)) edges.set(`${i},${j}`, [i + 1, j])
    if (!has(i + 1, j)) edges.set(`${i + 1},${j}`, [i + 1, j + 1])
    if (!has(i, j + 1)) edges.set(`${i + 1},${j + 1}`, [i, j + 1])
    if (!has(i - 1, j)) edges.set(`${i},${j + 1}`, [i, j])
  }
  const startKey: string | undefined = edges.keys().next().value
  if (!startKey) return []
  const poly: [number, number][] = []
  let cur = startKey
  let guard = 0
  do {
    const [x, y] = cur.split(',').map(Number)
    poly.push([x, y])
    const n = edges.get(cur)
    if (!n) break
    cur = `${n[0]},${n[1]}`
  } while (cur !== startKey && ++guard < 100000)
  const out: [number, number][] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[(i - 1 + poly.length) % poly.length]
    const b = poly[i]
    const c = poly[(i + 1) % poly.length]
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (cross !== 0) out.push(b)
  }
  return out
}

// SVG path (in tile units) for a cell-polygon offset to (ox,oy) tiles, with small
// rounded corners (radius in tiles) — enough to soften, not enough to lose the
// tetris feel.
export function roundedPath(poly: [number, number][], ox: number, oy: number, radius: number): string {
  const P = poly.map(([x, y]) => [ox + x * RES, oy + y * RES] as [number, number])
  const n = P.length
  if (n < 3) return ''
  let d = ''
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n]
    const p1 = P[i]
    const p2 = P[(i + 1) % n]
    const v1 = [p1[0] - p0[0], p1[1] - p0[1]]
    const v2 = [p2[0] - p1[0], p2[1] - p1[1]]
    const l1 = Math.hypot(v1[0], v1[1]) || 1
    const l2 = Math.hypot(v2[0], v2[1]) || 1
    const rr = Math.min(radius, l1 / 2, l2 / 2)
    const a = [p1[0] - (v1[0] / l1) * rr, p1[1] - (v1[1] / l1) * rr]
    const b = [p1[0] + (v2[0] / l2) * rr, p1[1] + (v2[1] / l2) * rr]
    d += i === 0 ? `M${a[0].toFixed(3)} ${a[1].toFixed(3)}` : `L${a[0].toFixed(3)} ${a[1].toFixed(3)}`
    d += `Q${p1[0].toFixed(3)} ${p1[1].toFixed(3)} ${b[0].toFixed(3)} ${b[1].toFixed(3)}`
  }
  return `${d}Z`
}

export const CELL_RES = RES
