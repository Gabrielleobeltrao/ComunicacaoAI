// Pure simulation core: the agent state machine and its helpers, with no React
// or timers, so it can be driven deterministically (by the hook's rAF, or by
// tests one dt at a time). Coordinates: FOOT points are nav/grid space; REF
// points are the MapAgent draw reference the renderer positions with.
import type { BuiltOfficeLayout } from './buildOfficeLayout'
import { hash32, mulberry32 } from './buildOfficeLayout'
import type { NavGrid } from './buildNavigationGrid'
import { cellOfPoint, isWalkable, nearestWalkable, pointOfCell } from './buildNavigationGrid'
import { buildActivityEnvelope, inEnvelopeCell, inEnvelopePoint } from './buildActivityEnvelope'
import type { ActivityEnvelope } from './buildActivityEnvelope'
import { findOfficePathCells } from './findOfficePath'
import type { GridCell } from './findOfficePath'
import { MAX_CONCURRENT_RATIO, OFFICE_TIMING } from './officeConfig'
import type { AgentMotionState, AgentVisualMode, InteractionPoint, OfficeDirection, OfficePoint } from './officeTypes'

export const REF_DX = 0.5
export const REF_DY = 1.5
export const refOf = (foot: OfficePoint): OfficePoint => ({ x: foot.x - REF_DX, y: foot.y - REF_DY })
export const footOf = (ref: OfficePoint): OfficePoint => ({ x: ref.x + REF_DX, y: ref.y + REF_DY })

interface Home {
  seatRef: OfficePoint
  exitFoot: OfficePoint
  exitRef: OfficePoint
  facing: OfficeDirection
}
export interface AgentModel {
  id: string
  kind: 'seated' | 'loose'
  mode: AgentVisualMode
  motion: AgentMotionState
  resume: AgentMotionState
  direction: OfficeDirection
  frame: number
  frameTimer: number
  pos: OfficePoint // REF space
  home: Home | null
  baseRef: OfficePoint
  route: GridCell[]
  routeIdx: number
  seg: { from: OfficePoint; to: OfficePoint; t: number; dur: number } | null
  reservedNext: string | null // future cell reserved during a step (may expire)
  occupiedCell: string | null // cell the feet physically hold — never expires while standing
  destInteractionId: string | null // interaction-point slot currently held
  destFacing: OfficeDirection | null // facing to assume on arrival
  timer: number
  visits: number
  attempts: number
  rng: () => number
}

export interface SimContext {
  grid: NavGrid
  envelope: ActivityEnvelope // invisible activity area — no foot/destination leaves it
  waypoints: OfficePoint[]
  interactions: InteractionPoint[]
  occupancy: Map<string, number> // interactionId -> agents currently holding it
  occupiedCells: Map<string, string> // cellKey -> agentId physically standing there (never expires)
  reservations: Map<string, { agentId: string; until: number }> // future cells (expire)
  moving: { count: number }
  cap: number
}

const rand = (rng: () => number, [a, b]: [number, number]) => a + rng() * (b - a)
const keyOf = (c: GridCell) => `${c.i},${c.j}`
export function stepDir(from: GridCell, to: GridCell): OfficeDirection {
  if (to.i > from.i) return 'right'
  if (to.i < from.i) return 'left'
  if (to.j < from.j) return 'back'
  return 'front'
}

export function corridorWaypoints(grid: NavGrid, layout: BuiltOfficeLayout, envelope: ActivityEnvelope): OfficePoint[] {
  const inRoom = new Set<string>()
  for (const r of layout.rooms) {
    const bi = Math.round(r.x / grid.res)
    const bj = Math.round(r.y / grid.res)
    for (const c of r.cells) {
      const [ci, cj] = c.split(',').map(Number)
      inRoom.add(`${bi + ci},${bj + cj}`)
    }
  }
  const pts: OfficePoint[] = []
  const rng = mulberry32(hash32('office-waypoints'))
  let guard = 0
  // Corridor waypoints are walkable, outside rooms, and inside the activity
  // envelope — never a far empty corner of the canvas.
  while (pts.length < 24 && guard++ < 6000) {
    const i = 1 + Math.floor(rng() * (grid.w - 2))
    const j = 1 + Math.floor(rng() * (grid.h - 2))
    if (isWalkable(grid, i, j) && inEnvelopeCell(envelope, i, j) && !inRoom.has(`${i},${j}`)) pts.push(pointOfCell(grid, i, j))
  }
  for (const d of grid.doors) pts.push(d.outer)
  return pts
}

export function createModels(layout: BuiltOfficeLayout, modeFor: (id: string) => AgentVisualMode): Map<string, AgentModel> {
  const out = new Map<string, AgentModel>()
  for (const s of layout.seats) {
    const rng = mulberry32(hash32(`${s.agentId}:sim0`))
    out.set(s.agentId, {
      id: s.agentId,
      kind: 'seated',
      mode: modeFor(s.agentId),
      motion: 'seated',
      resume: 'walking',
      direction: s.facing,
      frame: 0,
      frameTimer: 0,
      pos: { ...s.seatedPoint },
      home: { seatRef: { ...s.seatedPoint }, exitFoot: { ...s.exitPoint }, exitRef: refOf(s.exitPoint), facing: s.facing },
      baseRef: { ...s.seatedPoint },
      route: [],
      routeIdx: 0,
      seg: null,
      reservedNext: null,
      occupiedCell: null,
      destInteractionId: null,
      destFacing: null,
      timer: rand(rng, OFFICE_TIMING.staggerMs) + rand(rng, OFFICE_TIMING.seatedPause),
      visits: 0,
      attempts: 0,
      rng,
    })
  }
  for (const o of layout.loose) {
    const rng = mulberry32(hash32(`${o.agentId}:sim0`))
    out.set(o.agentId, {
      id: o.agentId,
      kind: 'loose',
      mode: modeFor(o.agentId),
      motion: 'pausing',
      resume: 'walking',
      direction: 'front',
      frame: 0,
      frameTimer: 0,
      pos: { ...o.point },
      home: null,
      baseRef: { ...o.point },
      route: [],
      routeIdx: 0,
      seg: null,
      reservedNext: null,
      occupiedCell: null,
      destInteractionId: null,
      destFacing: null,
      timer: rand(rng, OFFICE_TIMING.staggerMs) + rand(rng, OFFICE_TIMING.destinationPause),
      visits: 0,
      attempts: 0,
      rng,
    })
  }
  return out
}

// Nearest walkable cell that is also inside the envelope, searched outward.
function nearestEnvelopeCell(ctx: SimContext, p: OfficePoint, maxRings = 6): GridCell | null {
  const c = cellOfPoint(ctx.grid, p)
  if (isWalkable(ctx.grid, c.i, c.j) && inEnvelopeCell(ctx.envelope, c.i, c.j)) return c
  for (let r = 1; r <= maxRings; r++)
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
        const i = c.i + di
        const j = c.j + dj
        if (isWalkable(ctx.grid, i, j) && inEnvelopeCell(ctx.envelope, i, j)) return { i, j }
      }
  return null
}

/** Normalize each agent's start once, before the first paint (init only):
 *  - seated: snap the chair-exit to a walkable envelope cell so standing up lands
 *    the feet on a real, in-envelope cell (never inside a wall/desk inflation);
 *  - loose: snap the start position onto a valid envelope cell. */
export function settleStartPositions(ctx: SimContext, models: Map<string, AgentModel>): void {
  for (const m of models.values()) {
    if (m.home) {
      const snapped = nearestEnvelopeCell(ctx, m.home.exitFoot, 4)
      if (snapped) {
        const foot = pointOfCell(ctx.grid, snapped.i, snapped.j)
        m.home.exitFoot = foot
        m.home.exitRef = refOf(foot)
      }
      continue
    }
    if (m.motion === 'seated') continue
    const foot = footOf(m.pos)
    const c = cellOfPoint(ctx.grid, foot)
    if (isWalkable(ctx.grid, c.i, c.j) && inEnvelopeCell(ctx.envelope, c.i, c.j)) continue
    const snapped = nearestEnvelopeCell(ctx, foot, 8)
    if (snapped) {
      m.pos = refOf(pointOfCell(ctx.grid, snapped.i, snapped.j))
      m.baseRef = { ...m.pos }
    }
  }
}

export function createContext(layout: BuiltOfficeLayout, grid: NavGrid, totalAgents: number, interactions: InteractionPoint[] = [], envelope: ActivityEnvelope = buildActivityEnvelope(layout, grid)): SimContext {
  return {
    grid,
    envelope,
    waypoints: corridorWaypoints(grid, layout, envelope),
    interactions,
    occupancy: new Map(),
    occupiedCells: new Map(),
    reservations: new Map(),
    moving: { count: 0 },
    cap: Math.max(1, Math.floor(totalAgents * MAX_CONCURRENT_RATIO)),
  }
}

// Physical occupancy — the feet's cell. Never expires; released only when the
// agent leaves the cell (moves on) or sits down.
function occupy(ctx: SimContext, m: AgentModel, k: string) {
  if (m.occupiedCell === k) return
  if (m.occupiedCell && ctx.occupiedCells.get(m.occupiedCell) === m.id) ctx.occupiedCells.delete(m.occupiedCell)
  ctx.occupiedCells.set(k, m.id)
  m.occupiedCell = k
}
function unoccupy(ctx: SimContext, m: AgentModel) {
  if (m.occupiedCell && ctx.occupiedCells.get(m.occupiedCell) === m.id) ctx.occupiedCells.delete(m.occupiedCell)
  m.occupiedCell = null
}
function cellFree(ctx: SimContext, k: string, id: string, now: number): boolean {
  const occ = ctx.occupiedCells.get(k)
  if (occ && occ !== id) return false
  const held = ctx.reservations.get(k)
  if (held && held.until > now && held.agentId !== id) return false
  return true
}
// Reserve the next cell of a step. Fails if another agent occupies or reserves it.
function reserveNext(ctx: SimContext, m: AgentModel, k: string, now: number): boolean {
  if (!cellFree(ctx, k, m.id, now)) return false
  ctx.reservations.set(k, { agentId: m.id, until: now + OFFICE_TIMING.reservationMs })
  m.reservedNext = k
  return true
}
function releaseNext(ctx: SimContext, m: AgentModel) {
  if (m.reservedNext && ctx.reservations.get(m.reservedNext)?.agentId === m.id) ctx.reservations.delete(m.reservedNext)
  m.reservedNext = null
}
// Cells the pathfinder must avoid: everyone else's physical cell and reserved
// next cell (the goal itself is exempt inside findOfficePath).
function blockedByOthers(ctx: SimContext, excludeId: string, now: number): Set<string> {
  const s = new Set<string>()
  for (const [k, id] of ctx.occupiedCells) if (id !== excludeId) s.add(k)
  for (const [k, r] of ctx.reservations) if (r.until > now && r.agentId !== excludeId) s.add(k)
  return s
}
// Release the interaction slot this agent is holding (if any).
function clearDest(ctx: SimContext, m: AgentModel) {
  if (m.destInteractionId) {
    const n = (ctx.occupancy.get(m.destInteractionId) ?? 0) - 1
    if (n > 0) ctx.occupancy.set(m.destInteractionId, n)
    else ctx.occupancy.delete(m.destInteractionId)
    m.destInteractionId = null
    m.destFacing = null
  }
}
// Pick a destination: sometimes an interaction point with free capacity (whose
// slot we reserve here and its facing we remember), otherwise a corridor
// waypoint. Always releases any slot held before choosing.
function chooseDestination(ctx: SimContext, m: AgentModel): OfficePoint | null {
  clearDest(ctx, m)
  const useInteraction = ctx.interactions.length > 0 && m.rng() < 0.5
  if (useInteraction) {
    for (let t = 0; t < 6; t++) {
      const it = ctx.interactions[Math.floor(m.rng() * ctx.interactions.length)]
      if ((ctx.occupancy.get(it.id) ?? 0) >= it.capacity) continue
      if (!inEnvelopePoint(ctx.envelope, ctx.grid, it.point)) continue
      if (!nearestWalkable(ctx.grid, it.point, 2)) continue
      ctx.occupancy.set(it.id, (ctx.occupancy.get(it.id) ?? 0) + 1)
      m.destInteractionId = it.id
      m.destFacing = it.facing ?? null
      return it.point
    }
  }
  if (ctx.waypoints.length === 0) return null
  for (let t = 0; t < 6; t++) {
    const p = ctx.waypoints[Math.floor(m.rng() * ctx.waypoints.length)]
    if (nearestWalkable(ctx.grid, p, 2)) return p
  }
  return null
}
function routeFrom(ctx: SimContext, m: AgentModel, fromFoot: OfficePoint, goalFoot: OfficePoint, now: number): boolean {
  const from = nearestWalkable(ctx.grid, fromFoot, 3)
  const to = nearestWalkable(ctx.grid, goalFoot, 3)
  if (!from || !to) return false
  // Confine the route to the activity envelope (the goal cell is exempt so a
  // just-outside target can still be reached), so feet never leave the area.
  const path = findOfficePathCells(ctx.grid, from, to, { avoid: blockedByOthers(ctx, m.id, now), allowed: (i, j) => inEnvelopeCell(ctx.envelope, i, j) })
  if (!path || path.length < 2) return false
  m.route = path
  m.routeIdx = 0
  return true
}
function beginSeg(ctx: SimContext, m: AgentModel, now: number): boolean {
  if (m.routeIdx >= m.route.length - 1) return false
  const cur = m.route[m.routeIdx]
  occupy(ctx, m, keyOf(cur)) // feet physically hold the current cell
  const nextCell = m.route[m.routeIdx + 1]
  const k = keyOf(nextCell)
  if (!reserveNext(ctx, m, k, now)) {
    m.resume = m.motion === 'waiting' ? m.resume : m.motion
    m.motion = 'waiting'
    m.timer = rand(m.rng, OFFICE_TIMING.waitRetry)
    return false
  }
  m.direction = stepDir(cur, nextCell)
  m.seg = { from: refOf(pointOfCell(ctx.grid, cur.i, cur.j)), to: refOf(pointOfCell(ctx.grid, nextCell.i, nextCell.j)), t: 0, dur: OFFICE_TIMING.stepMs }
  return true
}
function arrive(ctx: SimContext, m: AgentModel) {
  releaseNext(ctx, m) // keep occupiedCell — a paused agent still holds its cell
  m.seg = null
  m.motion = 'pausing'
  // At an interaction point the agent assumes the point's facing and idles.
  if (m.destInteractionId && m.destFacing) m.direction = m.destFacing
  m.timer = rand(m.rng, OFFICE_TIMING.destinationPause)
  if (m.kind === 'loose') ctx.moving.count = Math.max(0, ctx.moving.count - 1)
}
function finishReturn(ctx: SimContext, m: AgentModel) {
  releaseNext(ctx, m)
  m.route = []
  if (m.home) {
    // Sit down from the chair-exit cell (still physically occupied) to the seat.
    m.motion = 'sitting-down'
    m.pos = { ...m.home.exitRef }
    m.seg = { from: { ...m.home.exitRef }, to: { ...m.home.seatRef }, t: 0, dur: OFFICE_TIMING.sitDownMs }
  } else {
    m.motion = 'pausing'
    m.seg = null
    m.timer = rand(m.rng, OFFICE_TIMING.destinationPause)
    ctx.moving.count = Math.max(0, ctx.moving.count - 1)
  }
}
function startReturn(ctx: SimContext, m: AgentModel, now: number) {
  clearDest(ctx, m)
  releaseNext(ctx, m) // keep occupiedCell while we plan the way home
  const targetFoot = m.home ? m.home.exitFoot : footOf(m.baseRef)
  const at = cellOfPoint(ctx.grid, footOf(m.pos))
  const tgt = cellOfPoint(ctx.grid, targetFoot)
  if (at.i === tgt.i && at.j === tgt.j) {
    // Physically at the chair exit already — only now is it safe to sit down.
    finishReturn(ctx, m)
    return
  }
  if (!routeFrom(ctx, m, footOf(m.pos), targetFoot, now)) {
    // Cannot route home right now — wait where we stand and retry; never teleport.
    m.motion = 'waiting'
    m.resume = 'returning'
    m.timer = rand(m.rng, OFFICE_TIMING.waitRetry)
    return
  }
  m.motion = 'returning'
  m.resume = 'returning'
  beginSeg(ctx, m, now)
}
function startTrip(ctx: SimContext, m: AgentModel, now: number): boolean {
  const dest = chooseDestination(ctx, m)
  if (!dest) return false
  // A seated agent may only stand up once its chair-exit cell is physically free.
  let exitCell: GridCell | null = null
  if (m.home) {
    exitCell = nearestWalkable(ctx.grid, m.home.exitFoot, 2)
    if (!exitCell || !cellFree(ctx, keyOf(exitCell), m.id, now)) {
      clearDest(ctx, m)
      return false
    }
  }
  const startFoot = m.home ? m.home.exitFoot : footOf(m.baseRef)
  if (!routeFrom(ctx, m, startFoot, dest, now)) {
    clearDest(ctx, m)
    return false
  }
  m.visits = 0
  m.attempts = 0
  ctx.moving.count++
  m.resume = 'walking'
  if (m.home && exitCell) {
    occupy(ctx, m, keyOf(exitCell)) // hold the exit cell before the feet leave the chair
    m.motion = 'standing-up'
    m.direction = 'front'
    m.seg = { from: { ...m.home.seatRef }, to: { ...m.home.exitRef }, t: 0, dur: OFFICE_TIMING.standUpMs }
  } else {
    m.motion = 'walking'
    beginSeg(ctx, m, now)
  }
  return true
}
function advanceSeg(ctx: SimContext, m: AgentModel, dt: number, now: number) {
  if (!m.seg) {
    if (m.motion === 'walking' || m.motion === 'returning') beginSeg(ctx, m, now)
    return
  }
  m.seg.t += dt / m.seg.dur
  const t = Math.min(1, m.seg.t)
  m.pos = { x: m.seg.from.x + (m.seg.to.x - m.seg.from.x) * t, y: m.seg.from.y + (m.seg.to.y - m.seg.from.y) * t }
  if (m.seg.t < 1) return
  m.pos = { ...m.seg.to }
  m.seg = null
  if (m.motion === 'standing-up') {
    m.motion = 'walking'
    beginSeg(ctx, m, now)
    return
  }
  if (m.motion === 'sitting-down') {
    m.motion = 'seated'
    unoccupy(ctx, m) // back in the chair — no longer on a nav cell
    m.direction = m.home ? m.home.facing : 'front'
    m.frame = 0
    m.timer = rand(m.rng, OFFICE_TIMING.seatedPause)
    ctx.moving.count = Math.max(0, ctx.moving.count - 1)
    return
  }
  // We physically move onto the cell we reserved: it becomes the occupied cell.
  if (m.reservedNext) {
    const nextKey = m.reservedNext
    occupy(ctx, m, nextKey)
    if (ctx.reservations.get(nextKey)?.agentId === m.id) ctx.reservations.delete(nextKey)
    m.reservedNext = null
  }
  m.routeIdx++
  if (m.routeIdx >= m.route.length - 1) {
    if (m.motion === 'returning') finishReturn(ctx, m)
    else arrive(ctx, m)
  } else beginSeg(ctx, m, now)
}

/** Advance one agent by dt milliseconds at time `now`. Mutates the model. */
export function stepAgent(m: AgentModel, dt: number, now: number, ctx: SimContext): void {
  // Any standing agent must physically occupy a cell — seed it lazily (covers
  // loose agents that begin idle, so a route never passes through them).
  if (m.motion !== 'seated' && m.occupiedCell === null) {
    const c = nearestWalkable(ctx.grid, footOf(m.pos), 2)
    if (c) occupy(ctx, m, keyOf(c))
  }

  if (m.motion === 'walking' || m.motion === 'returning' || m.motion === 'standing-up' || m.motion === 'sitting-down') {
    m.frameTimer -= dt
    if (m.frameTimer <= 0) {
      m.frame = (m.frame + 1) % 4
      m.frameTimer += OFFICE_TIMING.walkFrameMs
    }
  }

  switch (m.motion) {
    case 'seated':
      m.timer -= dt
      if (m.timer <= 0 && !(ctx.moving.count < ctx.cap && startTrip(ctx, m, now))) m.timer = rand(m.rng, [1500, 4000])
      break
    case 'pausing':
      m.timer -= dt
      if (m.timer <= 0) {
        if (m.kind === 'seated') {
          m.visits++
          const more = m.visits < OFFICE_TIMING.maxVisitsPerTrip && m.rng() < 0.5
          const dest = more ? chooseDestination(ctx, m) : null
          if (dest && routeFrom(ctx, m, footOf(m.pos), dest, now)) {
            m.motion = 'walking'
            m.resume = 'walking'
            beginSeg(ctx, m, now)
          } else startReturn(ctx, m, now)
        } else {
          const dest = ctx.moving.count < ctx.cap ? chooseDestination(ctx, m) : null
          if (dest && routeFrom(ctx, m, footOf(m.pos), dest, now)) {
            ctx.moving.count++
            m.motion = 'walking'
            m.resume = 'walking'
            beginSeg(ctx, m, now)
          } else {
            clearDest(ctx, m)
            m.timer = rand(m.rng, OFFICE_TIMING.destinationPause)
          }
        }
      }
      break
    case 'waiting':
      m.timer -= dt
      if (m.timer <= 0) {
        if (m.resume === 'returning') {
          // Heading home must never be abandoned — keep re-planning until a route
          // opens up. The agent stays put (occupiedCell held), never teleports.
          m.attempts = 0
          startReturn(ctx, m, now)
        } else {
          m.attempts++
          if (m.attempts > OFFICE_TIMING.maxPathAttempts) {
            m.attempts = 0
            if (m.kind === 'seated') startReturn(ctx, m, now)
            else {
              clearDest(ctx, m)
              releaseNext(ctx, m) // keep occupiedCell — the agent stays put
              m.motion = 'pausing'
              m.timer = rand(m.rng, OFFICE_TIMING.destinationPause)
              ctx.moving.count = Math.max(0, ctx.moving.count - 1)
            }
          } else {
            const goal = m.route[m.route.length - 1]
            if (goal && routeFrom(ctx, m, footOf(m.pos), pointOfCell(ctx.grid, goal.i, goal.j), now)) {
              m.motion = m.resume
              beginSeg(ctx, m, now)
            } else {
              m.timer = rand(m.rng, OFFICE_TIMING.waitRetry) // still blocked — keep waiting
            }
          }
        }
      }
      break
    case 'standing-up':
    case 'sitting-down':
    case 'walking':
    case 'returning':
      advanceSeg(ctx, m, dt, now)
      break
  }
}
