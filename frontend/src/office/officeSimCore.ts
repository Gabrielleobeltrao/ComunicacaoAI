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
import { MAX_CONCURRENT_RATIO, NAV_RES, OFFICE_TIMING, SOCIAL_ATTEMPT_MS, SOCIAL_MAX_RATIO } from './officeConfig'
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
// A live conversation slot the agent is committed to (Phase 7).
interface SocialState {
  pairId: string
  partnerId: string
  slot: GridCell // the distinct physical cell this agent stands on to talk
  facing: OfficeDirection // direction to face the partner
  talking: boolean // both partners have arrived and are conversing
  deadline: number // give-up time while walking to the slot (now-based ms)
}
export interface AgentModel {
  id: string
  kind: 'seated' | 'loose'
  sectorId: string | null // the room this agent belongs to (for in-room wandering)
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
  midPauses: number // consecutive mid-route pauses (bounded)
  isMoving: boolean // currently counted against the away-from-desk cap
  social: SocialState | null // active conversation, if any
  socialUntil: number // when the current conversation ends (now-based ms)
  rng: () => number
}

export interface SimContext {
  grid: NavGrid
  envelope: ActivityEnvelope // invisible activity area — no foot/destination leaves it
  waypoints: OfficePoint[]
  interactions: InteractionPoint[]
  roomInterior: Map<string, OfficePoint[]> // sectorId -> walkable interior points to wander to
  sectorCells: Map<string, string> // cellKey -> owning private-sector id (amenity/preset rooms are public, so absent)
  doorCells: Set<string> // door threshold cells — never a mid-route pause spot
  occupancy: Map<string, number> // interactionId -> agents currently holding it
  occupiedCells: Map<string, string> // cellKey -> agentId physically standing there (never expires)
  reservations: Map<string, { agentId: string; until: number }> // future cells (expire)
  moving: { count: number }
  cap: number
  socialCap: number // max simultaneous conversations
  nextSocialAttempt: number // next time (now-based) a new pair may be formed
  recall: boolean // "everyone back to their desks" mode — no new trips or conversations
}

const rand = (rng: () => number, [a, b]: [number, number]) => a + rng() * (b - a)
const keyOf = (c: GridCell) => `${c.i},${c.j}`
// The chair sits deep at the desk, so its exit cell is several cells away (it must
// clear the desk footprint). Glide seat<->exit at WALKING pace instead of a fixed
// fast tween, so standing up / sitting down reads as walking out, not a teleport.
// stepMs is the time to cross one NAV_RES-sized cell.
export const seatGlideDur = (a: OfficePoint, b: OfficePoint) =>
  Math.max(OFFICE_TIMING.stepMs, Math.hypot(b.x - a.x, b.y - a.y) * (OFFICE_TIMING.stepMs / NAV_RES))
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
  // Door thresholds must never be pause destinations, so keep them out.
  const doorGuard = new Set<string>()
  for (const d of grid.doors)
    for (const p of [d.inner, d.outer]) {
      const c = cellOfPoint(grid, p)
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) doorGuard.add(`${c.i + di},${c.j + dj}`)
    }
  const pts: OfficePoint[] = []
  const rng = mulberry32(hash32('office-waypoints'))
  let guard = 0
  // Corridor waypoints are walkable, outside rooms, inside the envelope, and not
  // on/next to a door — never a far empty corner nor a doorway pause point.
  while (pts.length < 24 && guard++ < 6000) {
    const i = 1 + Math.floor(rng() * (grid.w - 2))
    const j = 1 + Math.floor(rng() * (grid.h - 2))
    if (isWalkable(grid, i, j) && inEnvelopeCell(envelope, i, j) && !inRoom.has(`${i},${j}`) && !doorGuard.has(`${i},${j}`)) pts.push(pointOfCell(grid, i, j))
  }
  return pts
}

// Walkable interior points of each sector room (away from doorways) so seated
// agents can wander inside their own room without leaving it.
export function buildRoomInteriors(layout: BuiltOfficeLayout, grid: NavGrid, envelope: ActivityEnvelope): Map<string, OfficePoint[]> {
  const doorGuard = new Set<string>()
  for (const d of grid.doors)
    for (const p of [d.inner, d.outer]) {
      const c = cellOfPoint(grid, p)
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) doorGuard.add(`${c.i + di},${c.j + dj}`)
    }
  const out = new Map<string, OfficePoint[]>()
  for (const r of layout.rooms) {
    if (r.kind !== 'sector') continue
    const bi = Math.round(r.x / grid.res)
    const bj = Math.round(r.y / grid.res)
    const pts: OfficePoint[] = []
    for (const c of r.cells) {
      const [ci, cj] = c.split(',').map(Number)
      const gi = bi + ci
      const gj = bj + cj
      if (!isWalkable(grid, gi, gj) || !inEnvelopeCell(envelope, gi, gj) || doorGuard.has(`${gi},${gj}`)) continue
      pts.push(pointOfCell(grid, gi, gj))
    }
    if (pts.length) out.set(r.key, pts)
  }
  return out
}

// Cell ownership for PRIVATE sector rooms. Preset (amenity) rooms are public and
// deliberately omitted, so any agent may route through them; a private sector's
// cells are enterable only by its own members.
export function buildSectorCells(layout: BuiltOfficeLayout, grid: NavGrid): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of layout.rooms) {
    if (r.kind !== 'sector') continue
    const bi = Math.round(r.x / grid.res)
    const bj = Math.round(r.y / grid.res)
    for (const c of r.cells) {
      const [ci, cj] = c.split(',').map(Number)
      out.set(`${bi + ci},${bj + cj}`, r.key)
    }
  }
  return out
}

export function createModels(layout: BuiltOfficeLayout, modeFor: (id: string) => AgentVisualMode): Map<string, AgentModel> {
  const out = new Map<string, AgentModel>()
  for (const s of layout.seats) {
    const rng = mulberry32(hash32(`${s.agentId}:sim0`))
    out.set(s.agentId, {
      id: s.agentId,
      kind: 'seated',
      sectorId: s.sectorId ?? null,
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
      midPauses: 0,
      isMoving: false,
      social: null,
      socialUntil: 0,
      rng,
    })
  }
  for (const o of layout.loose) {
    const rng = mulberry32(hash32(`${o.agentId}:sim0`))
    out.set(o.agentId, {
      id: o.agentId,
      kind: 'loose',
      sectorId: null,
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
      midPauses: 0,
      isMoving: false,
      social: null,
      socialUntil: 0,
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
    roomInterior: buildRoomInteriors(layout, grid, envelope),
    sectorCells: buildSectorCells(layout, grid),
    doorCells: new Set(grid.doors.flatMap((d) => [keyOf(cellOfPoint(grid, d.inner)), keyOf(cellOfPoint(grid, d.outer))])),
    occupancy: new Map(),
    occupiedCells: new Map(),
    reservations: new Map(),
    moving: { count: 0 },
    cap: Math.max(1, Math.floor(totalAgents * MAX_CONCURRENT_RATIO)),
    socialCap: Math.max(1, Math.floor((totalAgents * SOCIAL_MAX_RATIO) / 2)),
    nextSocialAttempt: 0,
    recall: false,
  }
}

/** Toggle "return to desks" mode. Turning it on cancels every conversation safely
 *  (no teleport); the state machine then walks each agent home and keeps it there. */
export function setRecall(ctx: SimContext, models: Map<string, AgentModel>, on: boolean): void {
  ctx.recall = on
  if (on) for (const m of models.values()) endSocial(m)
}

/** True once every agent is home: seated agents in their chair, deskless agents
 *  idle on their home cell. Used to know when the office can go static. */
export function recallComplete(ctx: SimContext, models: Map<string, AgentModel>): boolean {
  for (const m of models.values()) {
    if (m.kind === 'seated') {
      if (m.motion !== 'seated') return false
    } else {
      const at = cellOfPoint(ctx.grid, footOf(m.pos))
      const home = cellOfPoint(ctx.grid, footOf(m.baseRef))
      if (m.motion !== 'pausing' || at.i !== home.i || at.j !== home.j) return false
    }
  }
  return true
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
// The away-from-desk cap counts only seated-kind agents that are out of their
// chair; loose agents wander freely and never count.
function setMoving(ctx: SimContext, m: AgentModel, on: boolean) {
  if (on === m.isMoving) return
  m.isMoving = on
  ctx.moving.count = Math.max(0, ctx.moving.count + (on ? 1 : -1))
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
function tryInteraction(ctx: SimContext, m: AgentModel): OfficePoint | null {
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
  return null
}
function tryWaypoint(ctx: SimContext, m: AgentModel): OfficePoint | null {
  if (ctx.waypoints.length === 0) return null
  for (let t = 0; t < 6; t++) {
    const p = ctx.waypoints[Math.floor(m.rng() * ctx.waypoints.length)]
    if (nearestWalkable(ctx.grid, p, 2)) return p
  }
  return null
}
// Pick a destination with the plan's weighting: a seated agent mostly wanders its
// own room (~58%), sometimes the corridor (~22%), sometimes an interaction (~20%);
// a deskless agent alternates interactions and the corridor. Releases any held
// interaction slot first. Interaction picks reserve their slot + remember facing.
function chooseDestination(ctx: SimContext, m: AgentModel): OfficePoint | null {
  clearDest(ctx, m)
  const r = m.rng()
  if (m.sectorId) {
    const interior = ctx.roomInterior.get(m.sectorId)
    if (interior && interior.length && r < 0.58) return interior[Math.floor(m.rng() * interior.length)]
    if (ctx.interactions.length && r >= 0.8) {
      const p = tryInteraction(ctx, m)
      if (p) return p
    }
    return tryWaypoint(ctx, m)
  }
  // deskless agents: roughly half interactions, half corridor
  if (ctx.interactions.length && m.rng() < 0.45) {
    const p = tryInteraction(ctx, m)
    if (p) return p
  }
  return tryWaypoint(ctx, m)
}
// A cell is enterable if it's a public cell (corridor or preset/amenity room) or
// belongs to the agent's own sector. Private sectors reject non-members.
function sectorOk(ctx: SimContext, m: AgentModel, i: number, j: number): boolean {
  const owner = ctx.sectorCells.get(`${i},${j}`)
  return !owner || owner === m.sectorId
}
function routeFrom(ctx: SimContext, m: AgentModel, fromFoot: OfficePoint, goalFoot: OfficePoint, now: number): boolean {
  const from = nearestWalkable(ctx.grid, fromFoot, 3)
  const to = nearestWalkable(ctx.grid, goalFoot, 3)
  if (!from || !to) return false
  // Confine the route to the activity envelope (the goal cell is exempt so a
  // just-outside target can still be reached), and keep non-members out of other
  // agents' private sectors — preset (amenity) rooms and corridors stay open.
  const path = findOfficePathCells(ctx.grid, from, to, { avoid: blockedByOthers(ctx, m.id, now), allowed: (i, j) => inEnvelopeCell(ctx.envelope, i, j) && sectorOk(ctx, m, i, j) })
  if (!path || path.length < 2) return false
  m.route = path
  m.routeIdx = 0
  m.midPauses = 0 // fresh route, fresh mid-pause budget
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
  // Walk from the agent's actual position (usually already the cell centre) to the
  // next cell centre — so a start that isn't grid-aligned glides instead of snapping.
  m.seg = { from: { ...m.pos }, to: refOf(pointOfCell(ctx.grid, nextCell.i, nextCell.j)), t: 0, dur: OFFICE_TIMING.stepMs }
  return true
}
function arrive(ctx: SimContext, m: AgentModel) {
  releaseNext(ctx, m) // keep occupiedCell — a paused agent still holds its cell
  m.seg = null
  m.motion = 'pausing'
  // At an interaction point the agent assumes the point's facing and idles.
  if (m.destInteractionId && m.destFacing) m.direction = m.destFacing
  m.timer = rand(m.rng, OFFICE_TIMING.destinationPause)
}
function finishReturn(ctx: SimContext, m: AgentModel) {
  releaseNext(ctx, m)
  m.route = []
  if (m.home) {
    // Sit down from the chair-exit cell (still physically occupied) to the seat.
    m.motion = 'sitting-down'
    m.pos = { ...m.home.exitRef }
    m.seg = { from: { ...m.home.exitRef }, to: { ...m.home.seatRef }, t: 0, dur: seatGlideDur(m.home.exitRef, m.home.seatRef) }
  } else {
    m.motion = 'pausing'
    m.seg = null
    m.timer = rand(m.rng, OFFICE_TIMING.destinationPause)
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
  m.resume = 'walking'
  if (m.home && exitCell) {
    occupy(ctx, m, keyOf(exitCell)) // hold the exit cell before the feet leave the chair
    m.motion = 'standing-up'
    // Face the way we actually glide (exit is directly above/below the seat), so a
    // far chair reads as walking out instead of moonwalking.
    m.direction = m.home.exitRef.y < m.home.seatRef.y ? 'back' : 'front'
    m.seg = { from: { ...m.home.seatRef }, to: { ...m.home.exitRef }, t: 0, dur: seatGlideDur(m.home.seatRef, m.home.exitRef) }
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
    return
  }
  // Mid-route pause (Phase 6): only at a cell boundary, on a safe (non-door) cell,
  // bounded to a couple consecutive. Keeps the cell occupied and the route intact.
  const here = m.occupiedCell
  if (here && !ctx.doorCells.has(here) && m.midPauses < 2 && m.rng() < OFFICE_TIMING.midwayPauseChance) {
    m.midPauses++
    m.resume = m.motion // walking or returning
    m.seg = null
    m.motion = 'pausing'
    m.timer = rand(m.rng, OFFICE_TIMING.midwayPause)
    return
  }
  m.midPauses = 0
  beginSeg(ctx, m, now)
}

const OPP: Record<OfficeDirection, OfficeDirection> = { front: 'back', back: 'front', left: 'right', right: 'left' }
// End a conversation for one agent without moving it (safe cancel / finish).
function endSocial(m: AgentModel) {
  if (!m.social) return
  m.social = null
  m.socialUntil = 0
  if (m.motion === 'socializing') {
    m.motion = 'pausing'
    m.timer = 300 // resume normal life shortly
  }
}
function socialEligible(ctx: SimContext, m: AgentModel): boolean {
  if (m.social || m.motion !== 'pausing' || !m.occupiedCell) return false
  if (m.route.length && m.routeIdx < m.route.length - 1) return false // mid-route
  if (ctx.doorCells.has(m.occupiedCell)) return false
  return true
}
function sameGroup(a: AgentModel, b: AgentModel): boolean {
  if (a.sectorId && b.sectorId) return a.sectorId === b.sectorId
  return a.sectorId === null && b.sectorId === null // both deskless
}
// A free, walkable, in-envelope, non-door cell orthogonally next to `cell`.
function adjacentSlot(ctx: SimContext, cell: GridCell, forId: string, now: number): { slot: GridCell; facing: OfficeDirection } | null {
  for (const [di, dj] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
    const s = { i: cell.i + di, j: cell.j + dj }
    const k = keyOf(s)
    if (!isWalkable(ctx.grid, s.i, s.j) || !inEnvelopeCell(ctx.envelope, s.i, s.j)) continue
    if (ctx.doorCells.has(k) || !cellFree(ctx, k, forId, now)) continue
    return { slot: s, facing: stepDir(cell, s) }
  }
  return null
}

/** Advance every conversation and, occasionally, start a new one. Pure — call it
 *  once per frame with the same `now` used for stepAgent. */
export function tickConversations(ctx: SimContext, models: Map<string, AgentModel>, now: number): void {
  if (ctx.recall) return // no conversations while everyone is heading back to their desks
  const active = new Set<string>()
  for (const m of models.values()) {
    if (!m.social) continue
    const partner = models.get(m.social.partnerId)
    if (!partner || partner.social?.pairId !== m.social.pairId) {
      endSocial(m) // partner vanished / desynced — cancel safely, no teleport
      continue
    }
    active.add(m.social.pairId)
    if (m.social.talking) {
      if (now >= m.socialUntil) {
        endSocial(m) // both partners leave together, so no one is left mid-talk
        endSocial(partner)
      }
      continue
    }
    const meAt = m.occupiedCell === keyOf(m.social.slot)
    if (meAt && m.motion !== 'socializing') {
      m.motion = 'socializing' // reached the slot (from walking or its arrival pause) — stand and wait
      m.seg = null
    }
    const partnerAt = partner.occupiedCell === keyOf(partner.social.slot)
    if (meAt && partnerAt) {
      m.social.talking = true
      m.direction = m.social.facing // now turn to face the partner
      m.socialUntil = now + rand(m.rng, OFFICE_TIMING.socialTalk)
    } else if (!meAt && now > m.social.deadline) {
      endSocial(m) // gave up approaching
      endSocial(partner)
    }
  }

  if (now < ctx.nextSocialAttempt) return
  ctx.nextSocialAttempt = now + SOCIAL_ATTEMPT_MS
  if (active.size >= ctx.socialCap) return

  const elig = [...models.values()].filter((m) => socialEligible(ctx, m))
  for (let a = 0; a < elig.length; a++)
    for (let b = a + 1; b < elig.length; b++) {
      const A = elig[a]
      const B = elig[b]
      if (!sameGroup(A, B)) continue
      const aCell = cellOfPoint(ctx.grid, footOf(A.pos))
      const found = adjacentSlot(ctx, aCell, B.id, now)
      if (!found) continue
      if (!routeFrom(ctx, B, footOf(B.pos), pointOfCell(ctx.grid, found.slot.i, found.slot.j), now)) continue
      const pairId = `${A.id}~${B.id}`
      const deadline = now + OFFICE_TIMING.socialApproachMs
      A.social = { pairId, partnerId: B.id, slot: aCell, facing: found.facing, talking: false, deadline }
      B.social = { pairId, partnerId: A.id, slot: found.slot, facing: OPP[found.facing], talking: false, deadline }
      A.motion = 'socializing' // A holds its cell and waits for B
      A.seg = null
      clearDest(ctx, B)
      B.motion = 'walking'
      B.resume = 'walking'
      beginSeg(ctx, B, now)
      return // one new pair per attempt
    }
}

/** Deterministic warm-start (Phase 8): pre-roll the whole simulation for `ms` of
 *  sim time with no rendering, so the office opens already alive. Returns the sim
 *  clock value reached, which the render loop then continues from. */
export function warmStart(ctx: SimContext, models: Map<string, AgentModel>, ms: number, dt = 60): number {
  settleStartPositions(ctx, models)
  let now = 0
  for (let elapsed = 0; elapsed < ms; elapsed += dt) {
    now += dt
    for (const [k, r] of ctx.reservations) if (r.until <= now) ctx.reservations.delete(k)
    tickConversations(ctx, models, now)
    for (const m of models.values()) stepAgent(m, dt, now, ctx)
  }
  return now
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
      if (ctx.recall) break // recall mode: stay in the chair
      m.timer -= dt
      if (m.timer <= 0 && !(ctx.moving.count < ctx.cap && startTrip(ctx, m, now))) m.timer = rand(m.rng, [1500, 4000])
      break
    case 'pausing':
      if (m.social) break // committed to a conversation — tickConversations drives it
      m.timer -= dt
      if (m.timer <= 0) {
        // Recall: head home (to the chair, or the deskless home cell) and stay there.
        if (ctx.recall) {
          if (m.home) startReturn(ctx, m, now)
          else {
            const at = cellOfPoint(ctx.grid, footOf(m.pos))
            const home = cellOfPoint(ctx.grid, footOf(m.baseRef))
            if (at.i !== home.i || at.j !== home.j) startReturn(ctx, m, now)
            else m.timer = 800 // already home — idle
          }
          break
        }
        // Mid-route pause: the route isn't finished — resume the very same route.
        if (m.route.length && m.routeIdx < m.route.length - 1) {
          m.motion = m.resume === 'returning' ? 'returning' : 'walking'
          beginSeg(ctx, m, now) // re-reserves the next cell; falls to waiting if blocked
          break
        }
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
          // Deskless agents wander freely — they hold no desk, so they are not
          // gated by the away-from-desk cap.
          const dest = chooseDestination(ctx, m)
          if (dest && routeFrom(ctx, m, footOf(m.pos), dest, now)) {
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

  // Reconcile the away-from-desk cap: a seated-kind agent counts whenever it is
  // out of its chair. This frees a slot the moment an agent sits, so others can go.
  setMoving(ctx, m, m.kind === 'seated' && m.motion !== 'seated')
}
