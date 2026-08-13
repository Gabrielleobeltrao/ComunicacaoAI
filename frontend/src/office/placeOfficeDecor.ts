// Deterministic room decoration (Phase 7) + interaction-point derivation (Phase 8).
//
// Given the built layout and its *base* navigation grid (walls + desks + doors,
// no decoration yet) this places a modest, themed set of extra objects, one
// sector at a time, validating every candidate against the full checklist —
// crucially it never breaks a chair→door or door→corridor route, because it
// re-floods a working copy of the grid after tentatively blocking each object.
//
// The result is stable: same layout + same catalog version → same decoration,
// regardless of re-renders, sprite frames, agent status, zoom or panel resize.
import type { BuiltAmenityItem, BuiltOfficeLayout } from './buildOfficeLayout'
import { hash32, mulberry32 } from './buildOfficeLayout'
import type { NavGrid } from './buildNavigationGrid'
import { buildNavigationGrid, cellIndex, cellOfPoint, inBounds, isWalkable } from './buildNavigationGrid'
import { FOOT_RADIUS } from './officeConfig'
import type { InteractionPoint, OfficeDirection, OfficeObstacle, OfficePoint } from './officeTypes'
import { CATALOG_VERSION, OFFICE_OBJECT_CATALOG, categoriesForFamily, isInteractiveFamily, themeForSector } from './officeCatalog'
import type { OfficeObjectDefinition } from './officeCatalog'

export interface PlacedDecor {
  key: string
  art: string
  x: number
  y: number
  w: number
  h: number
  label: string
}
// Non-blocking ambient detail (wall art) — never an obstacle, drawn below agents.
export interface AmbientDecor {
  key: string
  art: string
  x: number
  y: number
  w: number
  h: number
}
export interface OfficeDecorResult {
  items: PlacedDecor[]
  obstacles: OfficeObstacle[]
  interactionPoints: InteractionPoint[]
  ambient: AmbientDecor[]
}

export const EMPTY_DECOR: OfficeDecorResult = { items: [], obstacles: [], interactionPoints: [], ambient: [] }

// Parse the `-WxH` suffix of an object art name into tile dimensions.
function sizeOf(art: string): [number, number] {
  const m = art.match(/-(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/)
  return m ? [Number(m[1]), Number(m[2])] : [1, 1]
}

// Wall decorations per sector theme — non-blocking, mounted flat on the top wall.
const WALL_DECOR: Record<string, string[]> = {
  marketing: ['quadro-cavalete-1.2x1.5', 'mural-recados-1.5x1.4'],
  sales: ['relogio-parede-1x1.4', 'mural-recados-1.5x1.4'],
  support: ['mural-recados-1.5x1.4', 'relogio-parede-1x1.4'],
  finance: ['relogio-parede-1x1.4', 'quadro-cavalete-1.2x1.5'],
  work: ['mural-recados-1.5x1.4', 'relogio-parede-1x1.4'],
  meeting: ['quadro-cavalete-1.2x1.5', 'relogio-parede-1x1.4'],
  decoration: ['quadro-cavalete-1.2x1.5', 'relogio-parede-1x1.4'],
}

const LAYOUT_VERSION = 'office-layout-v2' // v2: interior spots + companion vignettes
const MAX_PER_SECTOR = 4 // anchor objects per sector (companions add to this)

// Mini-presets: after an anchor object lands, try to set a companion right next to
// it so the room reads as arranged vignettes (a plant beside a bench) rather than
// scattered props. Keyed by object family → companion families, in preference order.
// Keys and values are placeable catalog ids (OFFICE_OBJECT_CATALOG), so both the
// anchor and its companion are things the decorator actually places.
const COMPANIONS: Record<string, string[]> = {
  poltrona: ['luminaria', 'planta-grande', 'samambaia'],
  puff: ['planta', 'samambaia'],
  estante: ['planta', 'pilha-livros'],
  'estante-alta': ['planta'],
  arquivo: ['pilha-livros', 'planta'],
  bebedouro: ['planta', 'vaso'],
  prateleira: ['planta'],
  gaveteiro: ['pilha-livros'],
}

// --- grid working copy helpers -------------------------------------------------

function blockRect(work: Uint8Array, g: NavGrid, x: number, y: number, w: number, h: number): void {
  const x0 = x - FOOT_RADIUS
  const y0 = y - FOOT_RADIUS
  const x1 = x + w + FOOT_RADIUS
  const y1 = y + h + FOOT_RADIUS
  const i0 = Math.max(0, Math.floor(x0 / g.res))
  const j0 = Math.max(0, Math.floor(y0 / g.res))
  const i1 = Math.min(g.w - 1, Math.ceil(x1 / g.res))
  const j1 = Math.min(g.h - 1, Math.ceil(y1 / g.res))
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * g.res
      const cy = (j + 0.5) * g.res
      if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) work[cellIndex(g, i, j)] = 1
    }
}

// Cells covered by an object's raw footprint (no inflation) — for "covers a seat".
function footprintCells(g: NavGrid, x: number, y: number, w: number, h: number): number[] {
  const out: number[] = []
  const i0 = Math.max(0, Math.floor(x / g.res))
  const j0 = Math.max(0, Math.floor(y / g.res))
  const i1 = Math.min(g.w - 1, Math.ceil((x + w) / g.res) - 1)
  const j1 = Math.min(g.h - 1, Math.ceil((y + h) / g.res) - 1)
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push(cellIndex(g, i, j))
  return out
}

// Flood-fill of the walkable cells reachable from `start` over a working grid.
function flood(work: Uint8Array, g: NavGrid, start: number): Uint8Array {
  const seen = new Uint8Array(g.w * g.h)
  if (work[start] === 1) return seen
  const q = [start]
  seen[start] = 1
  for (let head = 0; head < q.length; head++) {
    const cur = q[head]
    const i = cur % g.w
    const j = (cur - i) / g.w
    const nb = [cur - 1, cur + 1, cur - g.w, cur + g.w]
    const ok = [i > 0, i < g.w - 1, j > 0, j < g.h - 1]
    for (let d = 0; d < 4; d++) {
      if (!ok[d]) continue
      const n = nb[d]
      if (!seen[n] && work[n] === 0) {
        seen[n] = 1
        q.push(n)
      }
    }
  }
  return seen
}

function corridorAnchor(g: NavGrid): number | null {
  for (const d of g.doors) {
    const c = cellOfPoint(g, d.outer)
    if (isWalkable(g, c.i, c.j)) return cellIndex(g, c.i, c.j)
  }
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) if (g.blocked[cellIndex(g, i, j)] === 0) return cellIndex(g, i, j)
  return null
}

// --- interaction helpers -------------------------------------------------------

// A reachable stand-point in front of an object, plus the way the agent faces.
function approachFor(g: NavGrid, reach: Uint8Array, x: number, y: number, w: number, h: number): { point: OfficePoint; facing: OfficeDirection } | null {
  const cx = x + w / 2
  const cy = y + h / 2
  const cands: { point: OfficePoint; facing: OfficeDirection }[] = [
    { point: { x: cx, y: y + h + 0.7 }, facing: 'back' },
    { point: { x: cx, y: y - 0.7 }, facing: 'front' },
    { point: { x: x + w + 0.7, y: cy }, facing: 'left' },
    { point: { x: x - 0.7, y: cy }, facing: 'right' },
  ]
  for (const c of cands) {
    const cell = cellOfPoint(g, c.point)
    if (isWalkable(g, cell.i, cell.j) && reach[cellIndex(g, cell.i, cell.j)]) return c
  }
  return null
}

// --- main ----------------------------------------------------------------------

function pickWeighted(defs: OfficeObjectDefinition[], rng: () => number): OfficeObjectDefinition | null {
  const total = defs.reduce((s, d) => s + d.placementWeight, 0)
  if (total <= 0) return null
  let r = rng() * total
  for (const d of defs) {
    r -= d.placementWeight
    if (r <= 0) return d
  }
  return defs[defs.length - 1]
}

export function placeOfficeDecor(layout: BuiltOfficeLayout, grid: NavGrid): OfficeDecorResult {
  const items: PlacedDecor[] = []
  const obstacles: OfficeObstacle[] = []
  const interactionPoints: InteractionPoint[] = []

  const anchor = corridorAnchor(grid)
  if (anchor == null) return { items, obstacles, interactionPoints, ambient: [] }

  // Working grid we mutate as we accept objects, so later ones see earlier ones.
  const work = new Uint8Array(grid.blocked)

  // Baseline routes that must survive: everything currently reachable from the
  // corridor that we care about (seat exits + door thresholds).
  const baseReach = flood(work, grid, anchor)
  const required: number[] = []
  const addRequired = (p: OfficePoint) => {
    const c = cellOfPoint(grid, p)
    if (inBounds(grid, c.i, c.j)) {
      const idx = cellIndex(grid, c.i, c.j)
      if (baseReach[idx]) required.push(idx)
    }
  }
  for (const s of layout.seats) addRequired(s.exitPoint)
  for (const d of grid.doors) {
    addRequired(d.inner)
    addRequired(d.outer)
  }
  // Cells we must never build on: door thresholds and their immediate neighbours,
  // plus every seat and chair-exit (an object must never cover an agent).
  const doorGuard = new Set<number>()
  for (const d of grid.doors)
    for (const p of [d.inner, d.outer]) {
      const c = cellOfPoint(grid, p)
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (inBounds(grid, c.i + di, c.j + dj)) doorGuard.add(cellIndex(grid, c.i + di, c.j + dj))
    }
  const seatGuard = new Set<number>()
  for (const s of layout.seats)
    for (const p of [s.seatedPoint, s.exitPoint]) {
      const c = cellOfPoint(grid, p)
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (inBounds(grid, c.i + di, c.j + dj)) seatGuard.add(cellIndex(grid, c.i + di, c.j + dj))
    }
  // Never drop an object on a loose agent standing in the open floor.
  for (const o of layout.loose) {
    const c = cellOfPoint(grid, o.point)
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (inBounds(grid, c.i + di, c.j + dj)) seatGuard.add(cellIndex(grid, c.i + di, c.j + dj))
  }
  // All room-interior/wall cells, so the corridor pass can tell floor from rooms.
  const roomCellSet = new Set<number>()
  for (const r of layout.rooms) {
    const bi = Math.round(r.x / grid.res)
    const bj = Math.round(r.y / grid.res)
    for (const c of r.cells) {
      const [ci, cj] = c.split(',').map(Number)
      if (inBounds(grid, bi + ci, bj + cj)) roomCellSet.add(cellIndex(grid, bi + ci, bj + cj))
    }
  }

  const stillConnected = (): boolean => {
    const r = flood(work, grid, anchor)
    for (const idx of required) if (!r[idx]) return false
    return true
  }

  // Try to place one object; commit into `work` + outputs on success.
  const tryPlace = (roomKey: string, def: OfficeObjectDefinition, x: number, y: number, label: string): boolean => {
    // 1. inside the floor with a visual margin
    if (x < 0.6 || y < 0.6 || x + def.width > grid.cols - 0.6 || y + def.height > grid.rows - 0.6) return false
    // 2. footprint currently walkable, not on a wall / desk / existing object / door guard / seat
    for (const idx of footprintCells(grid, x, y, def.width, def.height)) {
      if (grid.blocked[idx] === 1 || work[idx] === 1 || doorGuard.has(idx) || seatGuard.has(idx)) return false
    }
    // 3. tentatively block and require every critical route to survive
    const snapshot = work.slice()
    blockRect(work, grid, x, y, def.width, def.height)
    for (const idx of doorGuard) work[idx] = snapshot[idx] // never let inflation swallow a door
    if (!stillConnected()) {
      work.set(snapshot)
      return false
    }
    // accepted
    const key = `${roomKey}:${def.id}:${items.length}`
    items.push({ key, art: def.asset, x, y, w: def.width, h: def.height, label })
    if (def.blocksNavigation) obstacles.push({ rect: { x, y, width: def.width, height: def.height }, kind: 'object' })
    // interaction point (if reachable after placement)
    if (def.interactions.length) {
      const reach = flood(work, grid, anchor)
      const ap = approachFor(grid, reach, x, y, def.width, def.height)
      if (ap) interactionPoints.push({ id: `int:${key}`, point: ap.point, facing: ap.facing, categories: def.categories, capacity: def.interactions[0].capacity })
    }
    return true
  }

  // Open-floor candidate cells next to a room's outer wall: they read as that
  // sector's decoration but sit in the wide corridor, where blocking one small
  // cell almost never severs a route (unlike the tight room interiors).
  const openCandidatesNear = (room: (typeof layout.rooms)[number]): OfficePoint[] => {
    const bi = Math.round(room.x / grid.res)
    const bj = Math.round(room.y / grid.res)
    const seen = new Set<number>()
    const out: OfficePoint[] = []
    for (const c of room.cells) {
      const [ci, cj] = c.split(',').map(Number)
      const gi = bi + ci
      const gj = bj + cj
      for (const [di, dj] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
        const ni = gi + di
        const nj = gj + dj
        if (!inBounds(grid, ni, nj)) continue
        const idx = cellIndex(grid, ni, nj)
        if (seen.has(idx) || roomCellSet.has(idx) || !isWalkable(grid, ni, nj)) continue
        seen.add(idx)
        out.push({ x: (ni + 0.5) * grid.res, y: (nj + 0.5) * grid.res })
      }
    }
    return out
  }

  const placeFromPool = (key: string, seed: string, theme: string[], zone: 'room' | 'hall' | 'outdoor', spots: OfficePoint[], target: number) => {
    if (!spots.length || target <= 0) return
    const rng = mulberry32(hash32(seed))
    const eligible = OFFICE_OBJECT_CATALOG.filter((d) => d.allowedZones.includes(zone) && d.categories.some((c) => theme.includes(c)))
    const pool = (eligible.length ? eligible : OFFICE_OBJECT_CATALOG.filter((d) => d.allowedZones.includes(zone))).slice()
    const ordered = [...spots].sort((a, b) => mulberry32(hash32(`${seed}:${a.x},${a.y}`))() - mulberry32(hash32(`${seed}:${b.x},${b.y}`))())
    const perCount: Record<string, number> = {}
    // ~65% of the time, drop a small companion right beside a just-placed anchor so
    // it reads as an arranged vignette (a plant next to a bookshelf), not clutter.
    const tryCompanion = (anchor: OfficeObjectDefinition, ax: number, ay: number) => {
      const fams = COMPANIONS[anchor.id]
      if (!fams || rng() > 0.65) return
      for (const fam of fams) {
        const cdef = OFFICE_OBJECT_CATALOG.find((d) => d.id === fam)
        if (!cdef) continue
        const near: [number, number][] = [
          [ax + anchor.width + 0.15, ay + anchor.height - cdef.height],
          [ax - cdef.width - 0.15, ay + anchor.height - cdef.height],
          [ax + anchor.width - cdef.width, ay + anchor.height + 0.15],
          [ax, ay - cdef.height - 0.15],
        ]
        for (const [cx, cy] of near) if (tryPlace(key, cdef, cx, cy, cdef.id)) return
      }
    }
    let placed = 0
    let guard = 0
    while (placed < target && pool.length && guard++ < 40) {
      const def = pickWeighted(pool, rng)
      if (!def) break
      if ((perCount[def.id] ?? 0) >= def.maximumPerRoom) {
        pool.splice(pool.indexOf(def), 1)
        continue
      }
      let done = false
      const r = grid.res / 2
      for (const s of ordered) {
        // try centring, then hugging each side, so wide objects clear the wall
        const anchors: [number, number][] = [
          [s.x - def.width / 2, s.y - def.height / 2],
          [s.x - r, s.y - def.height / 2],
          [s.x - def.width + r, s.y - def.height / 2],
          [s.x - def.width / 2, s.y - r],
          [s.x - def.width / 2, s.y - def.height + r],
        ]
        for (const [ax, ay] of anchors) {
          if (tryPlace(key, def, ax, ay, def.id)) {
            perCount[def.id] = (perCount[def.id] ?? 0) + 1
            placed++
            done = true
            tryCompanion(def, ax, ay)
            break
          }
        }
        if (done) break
      }
      if (!done) pool.splice(pool.indexOf(def), 1)
    }
  }

  // Themed decoration: the sector's corridor-facing walls PLUS its own (now bigger)
  // interior floor, so the extra room space fills with props instead of reading
  // empty. tryPlace still guards seats/desks/routes, so nothing crowds an agent.
  for (const room of layout.rooms) {
    if (room.kind !== 'sector') continue
    const bi = Math.round(room.x / grid.res)
    const bj = Math.round(room.y / grid.res)
    const interior: OfficePoint[] = []
    for (const c of room.cells) {
      const [ci, cj] = c.split(',').map(Number)
      const gi = bi + ci
      const gj = bj + cj
      if (isWalkable(grid, gi, gj)) interior.push({ x: (gi + 0.5) * grid.res, y: (gj + 0.5) * grid.res })
    }
    const spots = [...openCandidatesNear(room), ...interior]
    const target = Math.min(MAX_PER_SECTOR, Math.max(2, Math.floor(spots.length / 7)))
    placeFromPool(room.key, `${LAYOUT_VERSION}:${room.key}:${CATALOG_VERSION}`, themeForSector(room.name), 'room', spots, target)
  }

  // A little greenery HUGGING the room cluster (not the empty canvas edges, which
  // read as "lost plants" on a squarer, compact map). Candidates are open cells one
  // ring outside a room; kept few so corners don't fill with scattered pots.
  const near = new Set<number>()
  for (const room of layout.rooms) {
    const bi = Math.round(room.x / grid.res)
    const bj = Math.round(room.y / grid.res)
    for (const c of room.cells) {
      const [ci, cj] = c.split(',').map(Number)
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) {
          const ni = bi + ci + di
          const nj = bj + cj + dj
          if (!inBounds(grid, ni, nj) || !isWalkable(grid, ni, nj)) continue
          const idx = cellIndex(grid, ni, nj)
          if (!roomCellSet.has(idx)) near.add(idx)
        }
    }
  }
  const border: OfficePoint[] = [...near].map((idx) => ({ x: ((idx % grid.w) + 0.5) * grid.res, y: (Math.floor(idx / grid.w) + 0.5) * grid.res }))
  placeFromPool('perimeter', `${LAYOUT_VERSION}:perimeter:${CATALOG_VERSION}`, ['outdoor', 'decoration'], 'outdoor', border, Math.min(3, Math.max(1, Math.floor(border.length / 40))))

  // Phase 8: also expose fitting existing amenity furniture as interaction points.
  const reachNow = flood(work, grid, anchor)
  const seenApproach = new Set<string>()
  for (const it of layout.amenityItems as BuiltAmenityItem[]) {
    if (!isInteractiveFamily(it.art)) continue
    const ap = approachFor(grid, reachNow, it.x, it.y, it.w, it.h)
    if (!ap) continue
    const key = `${Math.round(ap.point.x * 2)},${Math.round(ap.point.y * 2)}`
    if (seenApproach.has(key)) continue
    seenApproach.add(key)
    // One physical stand-point = capacity 1 (a >1 capacity would map two agents to
    // the same coordinate); multi-agent gatherings use distinct conversation slots.
    interactionPoints.push({ id: `int:amen:${it.roomKey}:${it.index}`, point: ap.point, facing: ap.facing, categories: categoriesForFamily(it.art), capacity: 1 })
  }

  // Final safety: validate every interaction point against the *merged* grid the
  // simulation actually navigates (walls + desks + this decoration). Drop any that
  // are not walkable/reachable there, so a point never sits inside an obstacle or
  // in a pocket the door does not reach (important once the map is compacted).
  const mergedGrid = buildNavigationGrid({ ...layout, obstacles: [...layout.obstacles, ...obstacles] })
  const mAnchor = corridorAnchor(mergedGrid)
  const mReach = mAnchor != null ? flood(new Uint8Array(mergedGrid.blocked), mergedGrid, mAnchor) : null
  const validInteractions = interactionPoints.filter((ip) => {
    const c = cellOfPoint(mergedGrid, ip.point)
    if (!isWalkable(mergedGrid, c.i, c.j)) return false
    return !mReach || mReach[cellIndex(mergedGrid, c.i, c.j)] === 1
  })

  // Phase 12: extra ambient detail — one non-blocking wall decoration per sector,
  // themed, mounted on the top wall. It is never an obstacle (routes untouched)
  // and draws below agents (never hides them). Deterministic per sector.
  const ambient: AmbientDecor[] = []
  for (const room of layout.rooms) {
    if (room.kind !== 'sector') continue
    const theme = themeForSector(room.name)
    const pool = WALL_DECOR[theme.find((t) => WALL_DECOR[t]) ?? 'decoration'] ?? WALL_DECOR.decoration
    const rng = mulberry32(hash32(`${LAYOUT_VERSION}:wall:${room.key}:${CATALOG_VERSION}`))
    const art = pool[Math.floor(rng() * pool.length)]
    const [w, h] = sizeOf(art)
    ambient.push({ key: `wall-${room.key}`, art, x: room.x + room.w / 2 - w / 2, y: room.y + 0.25, w, h })
  }

  return { items, obstacles, interactionPoints: validInteractions, ambient }
}
