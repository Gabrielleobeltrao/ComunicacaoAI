import { describe, expect, it } from 'vitest'
import { cozinha, lounge, reuniao } from '../cenarios'
import { buildOfficeLayout } from '../buildOfficeLayout'
import type { LayoutInput } from '../buildOfficeLayout'
import { buildNavigationGrid, cellOfPoint, isWalkable, nearestWalkable } from '../buildNavigationGrid'
import { buildActivityEnvelope, inEnvelopeCell } from '../buildActivityEnvelope'
import { findOfficePath } from '../findOfficePath'
import { placeOfficeDecor } from '../placeOfficeDecor'
import { createContext, createModels, footOf, recallComplete, setRecall, settleStartPositions, stepAgent, tickConversations, warmStart } from '../officeSimCore'

const OPP: Record<string, string> = { front: 'back', back: 'front', left: 'right', right: 'left' }

function input(): LayoutInput {
  const mk = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ _id: `${p}-${i}` }))
  const dev = mk(4, 'dev')
  const sup = mk(3, 'sup')
  const loose = mk(4, 'loose')
  return {
    agents: [...dev, ...sup, ...loose],
    sectors: [
      { _id: 'dev', name: 'Dev', color: '#2E5BFF', members: dev.map((a) => ({ agentId: a._id })) },
      { _id: 'sup', name: 'Suporte', color: '#FF6A5B', members: sup.map((a) => ({ agentId: a._id })) },
    ],
    aspect: 2,
    amenities: [reuniao, cozinha, lounge],
    amenityTint: { reuniao: '#38B6F0', cozinha: '#FFB53D', lounge: '#8B5CF6' },
    decorArts: ['planta-grande-1.5x2'],
  }
}

const layout = buildOfficeLayout(input())
const grid = buildNavigationGrid(layout)

describe('officeSimCore', () => {
  it('walks a seated agent out and returns it to the exact same seat', () => {
    const models = createModels(layout, () => 'normal')
    const ctx = createContext(layout, grid, models.size)
    // find a seated agent that can actually reach a door from its exit
    const mobile = layout.seats.find((s) => {
      const from = nearestWalkable(grid, s.exitPoint, 3)
      return from && grid.doors.some((d) => findOfficePath(grid, from, cellOfPoint(grid, d.outer)))
    })
    expect(mobile).toBeTruthy()
    const m = models.get(mobile!.agentId)!
    const seat = { ...m.pos }
    m.timer = 0 // stand up immediately

    let sawWalking = false
    let returnedSeated = false
    let now = 0
    for (let step = 0; step < 8000 && !returnedSeated; step++) {
      now += 32
      stepAgent(m, 32, now, ctx)
      if (m.motion === 'walking') sawWalking = true
      // while on foot, the agent stands on a walkable cell (never a wall/desk)
      if (m.motion === 'walking' || m.motion === 'returning') {
        const c = cellOfPoint(grid, footOf(m.pos))
        expect(isWalkable(grid, c.i, c.j)).toBe(true)
      }
      if (sawWalking && m.motion === 'seated') returnedSeated = true
    }
    expect(sawWalking).toBe(true)
    expect(returnedSeated).toBe(true)
    expect(m.pos.x).toBeCloseTo(seat.x, 6)
    expect(m.pos.y).toBeCloseTo(seat.y, 6)
  })

  it('never lets two agents occupy the same cell (formal + real feet) and honours the cap', () => {
    const models = createModels(layout, () => 'normal')
    const ctx = createContext(layout, grid, models.size)
    settleStartPositions(ctx, models)
    for (const m of models.values()) m.timer = Math.min(m.timer, 500) // get everyone moving sooner
    let now = 0
    for (let step = 0; step < 4000; step++) {
      now += 24
      for (const [k, r] of ctx.reservations) if (r.until <= now) ctx.reservations.delete(k)
      for (const m of models.values()) stepAgent(m, 24, now, ctx)

      // 1. formal occupancy is unique
      const byCell = new Map<string, string>()
      for (const m of models.values()) {
        if (!m.occupiedCell) continue
        expect(byCell.has(m.occupiedCell)).toBe(false)
        byCell.set(m.occupiedCell, m.id)
      }
      // 2. every standing agent actually holds a cell (never floats un-occupied)
      for (const m of models.values()) if (m.motion !== 'seated') expect(m.occupiedCell).not.toBeNull()
      // 3. real foot cells of walking/paused/waiting agents never collide
      const feet = new Map<string, string>()
      for (const m of models.values()) {
        if (m.motion === 'seated' || m.motion === 'standing-up' || m.motion === 'sitting-down') continue
        const c = cellOfPoint(grid, footOf(m.pos))
        const key = `${c.i},${c.j}`
        expect(feet.has(key)).toBe(false)
        feet.set(key, m.id)
      }
      // 4. the concurrency cap is never exceeded
      expect(ctx.moving.count).toBeLessThanOrEqual(ctx.cap)
    }
  })

  it('never teleports: per-frame displacement stays bounded after init', () => {
    const models = createModels(layout, () => 'normal')
    const ctx = createContext(layout, grid, models.size)
    settleStartPositions(ctx, models) // init-only snapping happens before we watch
    for (const m of models.values()) m.timer = Math.min(m.timer, 400) // cycle sit→walk→return often
    const prev = new Map<string, { x: number; y: number }>()
    for (const m of models.values()) prev.set(m.id, { ...m.pos })
    const dt = 24
    const MAX = 0.3 // tiles/frame at real time — a teleport (>= ~1 tile) fails this
    let now = 0
    for (let step = 0; step < 5000; step++) {
      now += dt
      for (const [k, r] of ctx.reservations) if (r.until <= now) ctx.reservations.delete(k)
      for (const m of models.values()) {
        stepAgent(m, dt, now, ctx)
        const p = prev.get(m.id)!
        const d = Math.hypot(m.pos.x - p.x, m.pos.y - p.y)
        expect(d).toBeLessThanOrEqual(MAX)
        prev.set(m.id, { ...m.pos })
      }
    }
  })

  it('keeps every walking foot inside the activity envelope', () => {
    const env = buildActivityEnvelope(layout, grid)
    const models = createModels(layout, () => 'normal')
    const ctx = createContext(layout, grid, models.size, [], env)
    settleStartPositions(ctx, models)
    for (const m of models.values()) m.timer = Math.min(m.timer, 500)
    let now = 0
    for (let step = 0; step < 3000; step++) {
      now += 28
      for (const [k, r] of ctx.reservations) if (r.until <= now) ctx.reservations.delete(k)
      for (const m of models.values()) {
        stepAgent(m, 28, now, ctx)
        if (m.motion === 'walking' || m.motion === 'returning' || m.motion === 'pausing') {
          const c = cellOfPoint(grid, footOf(m.pos))
          expect(inEnvelopeCell(env, c.i, c.j)).toBe(true)
        }
      }
    }
  })

  it('takes bounded mid-route pauses, never on a door cell', () => {
    const models = createModels(layout, () => 'normal')
    const ctx = createContext(layout, grid, models.size)
    settleStartPositions(ctx, models)
    for (const m of models.values()) m.timer = Math.min(m.timer, 300)
    let now = 0
    let midPauses = 0
    for (let step = 0; step < 6000; step++) {
      now += 28
      for (const [k, r] of ctx.reservations) if (r.until <= now) ctx.reservations.delete(k)
      for (const m of models.values()) {
        stepAgent(m, 28, now, ctx)
        // a pausing agent whose route isn't finished is mid-route
        if (m.motion === 'pausing' && m.route.length && m.routeIdx < m.route.length - 1) {
          midPauses++
          expect(m.occupiedCell && ctx.doorCells.has(m.occupiedCell)).toBeFalsy()
        }
        expect(m.midPauses).toBeLessThanOrEqual(2) // bounded consecutive pauses
      }
    }
    expect(midPauses).toBeGreaterThan(0)
  })

  it('sends seated agents wandering inside their own room', () => {
    const models = createModels(layout, () => 'normal')
    const ctx = createContext(layout, grid, models.size)
    settleStartPositions(ctx, models)
    const interiorKeys = new Map<string, Set<string>>()
    for (const [sid, pts] of ctx.roomInterior) {
      const s = new Set<string>()
      for (const p of pts) {
        const c = cellOfPoint(grid, p)
        s.add(`${c.i},${c.j}`)
      }
      interiorKeys.set(sid, s)
    }
    for (const m of models.values()) m.timer = Math.min(m.timer, 300)
    let now = 0
    let inRoomWander = 0
    for (let step = 0; step < 6000; step++) {
      now += 28
      for (const [k, r] of ctx.reservations) if (r.until <= now) ctx.reservations.delete(k)
      for (const m of models.values()) {
        stepAgent(m, 28, now, ctx)
        // a seated agent that pauses (not at an interaction) on its own room's
        // interior cell has walked inside its room and stopped there
        if (m.motion === 'pausing' && m.sectorId && !m.destInteractionId) {
          const c = cellOfPoint(grid, footOf(m.pos))
          if (interiorKeys.get(m.sectorId)?.has(`${c.i},${c.j}`)) inRoomWander++
        }
      }
    }
    expect(inRoomWander).toBeGreaterThan(0)
  })

  it('forms conversations: two partners on distinct cells facing each other, then release', () => {
    const models = createModels(layout, () => 'normal')
    const ctx = createContext(layout, grid, models.size)
    settleStartPositions(ctx, models)
    for (const m of models.values()) m.timer = Math.min(m.timer, 300)
    let now = 0
    let sawTalking = false
    let everPaired = false
    for (let step = 0; step < 9000; step++) {
      now += 30
      for (const [k, r] of ctx.reservations) if (r.until <= now) ctx.reservations.delete(k)
      tickConversations(ctx, models, now)
      for (const m of models.values()) stepAgent(m, 30, now, ctx)
      // active conversations never exceed the cap
      const pairs = new Set<string>()
      for (const m of models.values()) if (m.social) pairs.add(m.social.pairId)
      expect(pairs.size).toBeLessThanOrEqual(ctx.socialCap)
      for (const m of models.values()) {
        if (m.social) everPaired = true
        if (m.motion === 'socializing' && m.social?.talking) {
          const p = models.get(m.social.partnerId)!
          expect(p.social?.pairId).toBe(m.social.pairId) // symmetric pairing
          expect(p.social?.talking).toBe(true)
          expect(m.occupiedCell).not.toBe(p.occupiedCell) // two distinct physical slots
          expect(m.direction).toBe(OPP[p.direction]) // facing each other
          sawTalking = true
        }
      }
    }
    expect(everPaired).toBe(true)
    expect(sawTalking).toBe(true)
  })

  it('warm-starts the office alive: deterministic, mixed activity, no shared cells', () => {
    const a = createModels(layout, () => 'normal')
    const ctxA = createContext(layout, grid, a.size)
    warmStart(ctxA, a, 22000)
    const b = createModels(layout, () => 'normal')
    const ctxB = createContext(layout, grid, b.size)
    warmStart(ctxB, b, 22000)
    // deterministic: identical snapshot for the same layout + seed
    for (const m of a.values()) {
      const n = b.get(m.id)!
      expect(n.motion).toBe(m.motion)
      expect(n.pos.x).toBeCloseTo(m.pos.x, 6)
      expect(n.pos.y).toBeCloseTo(m.pos.y, 6)
    }
    // a mix: some agents are active and some remain at their desks
    const active = [...a.values()].filter((m) => m.motion !== 'seated').length
    const seated = [...a.values()].filter((m) => m.motion === 'seated').length
    expect(active).toBeGreaterThan(0)
    expect(seated).toBeGreaterThan(0)
    // the opening snapshot is collision-free
    const cells = new Map<string, string>()
    for (const m of a.values()) {
      if (!m.occupiedCell) continue
      expect(cells.has(m.occupiedCell)).toBe(false)
      cells.set(m.occupiedCell, m.id)
    }
  })

  it('recall brings every agent home with no collisions or teleport', () => {
    const models = createModels(layout, () => 'normal')
    const ctx = createContext(layout, grid, models.size)
    warmStart(ctx, models, 22000) // start from a busy, mid-activity state
    setRecall(ctx, models, true)
    for (const m of models.values()) expect(m.social).toBeNull() // conversations cancelled on recall
    const prev = new Map<string, { x: number; y: number }>()
    for (const m of models.values()) prev.set(m.id, { ...m.pos })
    let now = 22000
    let done = false
    for (let step = 0; step < 8000 && !done; step++) {
      now += 30
      for (const [k, r] of ctx.reservations) if (r.until <= now) ctx.reservations.delete(k)
      tickConversations(ctx, models, now) // no-op under recall
      const cells = new Map<string, string>()
      for (const m of models.values()) {
        stepAgent(m, 30, now, ctx)
        const p = prev.get(m.id)!
        expect(Math.hypot(m.pos.x - p.x, m.pos.y - p.y)).toBeLessThanOrEqual(0.3) // no teleport
        prev.set(m.id, { ...m.pos })
        if (m.occupiedCell) {
          expect(cells.has(m.occupiedCell)).toBe(false)
          cells.set(m.occupiedCell, m.id)
        }
        expect(m.social).toBeNull() // no new conversations during recall
      }
      done = recallComplete(ctx, models)
    }
    expect(done).toBe(true)
  })

  it('respects the concurrency cap', () => {
    const models = createModels(layout, () => 'normal')
    const ctx = createContext(layout, grid, models.size)
    for (const m of models.values()) m.timer = 0
    let now = 0
    let maxMoving = 0
    for (let step = 0; step < 2000; step++) {
      now += 32
      for (const m of models.values()) stepAgent(m, 32, now, ctx)
      maxMoving = Math.max(maxMoving, ctx.moving.count)
      expect(ctx.moving.count).toBeLessThanOrEqual(ctx.cap) // strict: never cap + 1
    }
    expect(maxMoving).toBeGreaterThan(0)
  })

  it('respects interaction-point capacity and adopts its facing on arrival', () => {
    const decor = placeOfficeDecor(layout, grid)
    const merged = buildNavigationGrid({ ...layout, obstacles: [...layout.obstacles, ...decor.obstacles] })
    const capOf = new Map(decor.interactionPoints.map((i) => [i.id, i.capacity]))
    const faceOf = new Map(decor.interactionPoints.map((i) => [i.id, i.facing]))
    const models = createModels(layout, () => 'normal')
    const ctx = createContext(layout, merged, models.size, decor.interactionPoints)
    for (const m of models.values()) m.timer = Math.min(m.timer, 300)
    let now = 0
    let sawFacingMatch = false
    for (let step = 0; step < 5000; step++) {
      now += 32
      for (const [k, r] of ctx.reservations) if (r.until <= now) ctx.reservations.delete(k)
      for (const m of models.values()) stepAgent(m, 32, now, ctx)
      // occupancy never exceeds capacity
      for (const [id, n] of ctx.occupancy) expect(n).toBeLessThanOrEqual(capOf.get(id) ?? 0)
      // an agent that has ARRIVED at an interaction (route finished) faces the
      // point's declared facing (a mid-route pause still faces its walk direction)
      for (const m of models.values()) {
        const arrived = m.route.length > 0 && m.routeIdx >= m.route.length - 1
        if (m.motion === 'pausing' && m.destInteractionId && arrived) {
          const f = faceOf.get(m.destInteractionId)
          if (f) {
            expect(m.direction).toBe(f)
            sawFacingMatch = true
          }
        }
      }
    }
    expect(sawFacingMatch).toBe(true)
  })
})
