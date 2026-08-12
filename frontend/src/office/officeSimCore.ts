// Pure simulation core: the agent state machine and its helpers, with no React
// or timers, so it can be driven deterministically (by the hook's rAF, or by
// tests one dt at a time). Coordinates: FOOT points are nav/grid space; REF
// points are the MapAgent draw reference the renderer positions with.
import type { BuiltOfficeLayout } from './buildOfficeLayout'
import { hash32, mulberry32 } from './buildOfficeLayout'
import type { NavGrid } from './buildNavigationGrid'
import { isWalkable, nearestWalkable, pointOfCell } from './buildNavigationGrid'
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
  reservedNext: string | null
  reservedCur: string | null
  destInteractionId: string | null // interaction-point slot currently held
  destFacing: OfficeDirection | null // facing to assume on arrival
  timer: number
  visits: number
  attempts: number
  rng: () => number
}

export interface SimContext {
  grid: NavGrid
  waypoints: OfficePoint[]
  interactions: InteractionPoint[]
  occupancy: Map<string, number> // interactionId -> agents currently holding it
  reservations: Map<string, { agentId: string; until: number }>
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

export function corridorWaypoints(grid: NavGrid, layout: BuiltOfficeLayout): OfficePoint[] {
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
  while (pts.length < 24 && guard++ < 6000) {
    const i = 1 + Math.floor(rng() * (grid.w - 2))
    const j = 1 + Math.floor(rng() * (grid.h - 2))
    if (isWalkable(grid, i, j) && !inRoom.has(`${i},${j}`)) pts.push(pointOfCell(grid, i, j))
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
      reservedCur: null,
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
      reservedCur: null,
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

export function createContext(layout: BuiltOfficeLayout, grid: NavGrid, totalAgents: number, interactions: InteractionPoint[] = []): SimContext {
  return {
    grid,
    waypoints: corridorWaypoints(grid, layout),
    interactions,
    occupancy: new Map(),
    reservations: new Map(),
    moving: { count: 0 },
    cap: Math.max(1, Math.floor(totalAgents * MAX_CONCURRENT_RATIO)),
  }
}

function reserve(ctx: SimContext, k: string, id: string, now: number): boolean {
  const held = ctx.reservations.get(k)
  if (held && held.until > now && held.agentId !== id) return false
  ctx.reservations.set(k, { agentId: id, until: now + OFFICE_TIMING.reservationMs })
  return true
}
function release(ctx: SimContext, k: string | null, id: string) {
  if (k && ctx.reservations.get(k)?.agentId === id) ctx.reservations.delete(k)
}
function releaseAll(ctx: SimContext, m: AgentModel) {
  release(ctx, m.reservedNext, m.id)
  release(ctx, m.reservedCur, m.id)
  m.reservedNext = null
  m.reservedCur = null
}
function reservedBy(ctx: SimContext, excludeId: string, now: number): Set<string> {
  const s = new Set<string>()
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
  const path = findOfficePathCells(ctx.grid, from, to, { avoid: reservedBy(ctx, m.id, now) })
  if (!path || path.length < 2) return false
  m.route = path
  m.routeIdx = 0
  return true
}
function beginSeg(ctx: SimContext, m: AgentModel, now: number): boolean {
  if (m.routeIdx >= m.route.length - 1) return false
  const cur = m.route[m.routeIdx]
  if (m.reservedCur === null) {
    reserve(ctx, keyOf(cur), m.id, now)
    m.reservedCur = keyOf(cur)
  }
  const nextCell = m.route[m.routeIdx + 1]
  const k = keyOf(nextCell)
  if (!reserve(ctx, k, m.id, now)) {
    m.resume = m.motion === 'waiting' ? m.resume : m.motion
    m.motion = 'waiting'
    m.timer = rand(m.rng, OFFICE_TIMING.waitRetry)
    return false
  }
  m.reservedNext = k
  m.direction = stepDir(cur, nextCell)
  m.seg = { from: refOf(pointOfCell(ctx.grid, cur.i, cur.j)), to: refOf(pointOfCell(ctx.grid, nextCell.i, nextCell.j)), t: 0, dur: OFFICE_TIMING.stepMs }
  return true
}
function arrive(ctx: SimContext, m: AgentModel) {
  releaseAll(ctx, m)
  m.seg = null
  m.motion = 'pausing'
  // At an interaction point the agent assumes the point's facing and idles.
  if (m.destInteractionId && m.destFacing) m.direction = m.destFacing
  m.timer = rand(m.rng, OFFICE_TIMING.destinationPause)
  if (m.kind === 'loose') ctx.moving.count = Math.max(0, ctx.moving.count - 1)
}
function finishReturn(ctx: SimContext, m: AgentModel) {
  releaseAll(ctx, m)
  m.route = []
  if (m.home) {
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
  releaseAll(ctx, m)
  const targetFoot = m.home ? m.home.exitFoot : footOf(m.baseRef)
  if (!routeFrom(ctx, m, footOf(m.pos), targetFoot, now)) {
    finishReturn(ctx, m)
    return
  }
  m.motion = 'returning'
  m.resume = 'returning'
  beginSeg(ctx, m, now)
}
function startTrip(ctx: SimContext, m: AgentModel, now: number): boolean {
  const dest = chooseDestination(ctx, m)
  if (!dest) return false
  const startFoot = m.home ? m.home.exitFoot : footOf(m.baseRef)
  if (!routeFrom(ctx, m, startFoot, dest, now)) {
    clearDest(ctx, m)
    return false
  }
  m.visits = 0
  m.attempts = 0
  ctx.moving.count++
  m.resume = 'walking'
  if (m.home) {
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
    m.direction = m.home ? m.home.facing : 'front'
    m.frame = 0
    m.timer = rand(m.rng, OFFICE_TIMING.seatedPause)
    ctx.moving.count = Math.max(0, ctx.moving.count - 1)
    return
  }
  // Shift reservations: we now occupy the cell we just reached.
  release(ctx, m.reservedCur, m.id)
  m.reservedCur = m.reservedNext
  m.reservedNext = null
  m.routeIdx++
  if (m.routeIdx >= m.route.length - 1) {
    if (m.motion === 'returning') finishReturn(ctx, m)
    else arrive(ctx, m)
  } else beginSeg(ctx, m, now)
}

/** Advance one agent by dt milliseconds at time `now`. Mutates the model. */
export function stepAgent(m: AgentModel, dt: number, now: number, ctx: SimContext): void {
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
          const dest = ctx.moving.count <= ctx.cap ? chooseDestination(ctx, m) : null
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
        m.attempts++
        if (m.attempts > OFFICE_TIMING.maxPathAttempts) {
          m.attempts = 0
          if (m.kind === 'seated') startReturn(ctx, m, now)
          else {
            clearDest(ctx, m)
            releaseAll(ctx, m)
            m.motion = 'pausing'
            m.timer = rand(m.rng, OFFICE_TIMING.destinationPause)
            ctx.moving.count = Math.max(0, ctx.moving.count - 1)
          }
        } else {
          const goal = m.route[m.route.length - 1]
          if (goal && routeFrom(ctx, m, footOf(m.pos), pointOfCell(ctx.grid, goal.i, goal.j), now)) {
            m.motion = m.resume
            beginSeg(ctx, m, now)
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
