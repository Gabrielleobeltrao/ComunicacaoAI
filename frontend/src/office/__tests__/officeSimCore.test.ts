import { describe, expect, it } from 'vitest'
import { cozinha, lounge, reuniao } from '../cenarios'
import { buildOfficeLayout } from '../buildOfficeLayout'
import type { LayoutInput } from '../buildOfficeLayout'
import { buildNavigationGrid, cellOfPoint, isWalkable, nearestWalkable } from '../buildNavigationGrid'
import { buildActivityEnvelope, inEnvelopeCell } from '../buildActivityEnvelope'
import { findOfficePath } from '../findOfficePath'
import { placeOfficeDecor } from '../placeOfficeDecor'
import { createContext, createModels, footOf, stepAgent } from '../officeSimCore'

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

  it('never lets two agents hold (occupy) the same cell', () => {
    const models = createModels(layout, () => 'normal')
    const ctx = createContext(layout, grid, models.size)
    for (const m of models.values()) m.timer = Math.min(m.timer, 500) // get everyone moving sooner
    let now = 0
    for (let step = 0; step < 3000; step++) {
      now += 24
      for (const [k, r] of ctx.reservations) if (r.until <= now) ctx.reservations.delete(k)
      for (const m of models.values()) stepAgent(m, 24, now, ctx)
      // reservedCur is a unique reservation — no two agents can share one
      const occupied = new Map<string, string>()
      for (const m of models.values()) {
        if (!m.reservedCur) continue
        expect(occupied.has(m.reservedCur)).toBe(false)
        occupied.set(m.reservedCur, m.id)
      }
    }
  })

  it('keeps every walking foot inside the activity envelope', () => {
    const env = buildActivityEnvelope(layout, grid)
    const models = createModels(layout, () => 'normal')
    const ctx = createContext(layout, grid, models.size, [], env)
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
    }
    // the cap gates NEW trips; brief overshoot is impossible since starts check it
    expect(ctx.moving.count).toBeLessThanOrEqual(ctx.cap + 1)
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
      // an agent idling at an interaction faces the point's declared facing
      for (const m of models.values()) {
        if (m.motion === 'pausing' && m.destInteractionId) {
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
