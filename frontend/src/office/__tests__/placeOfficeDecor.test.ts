import { describe, expect, it } from 'vitest'
import { cozinha, lounge, reuniao } from '../cenarios'
import { buildOfficeLayout } from '../buildOfficeLayout'
import type { LayoutInput } from '../buildOfficeLayout'
import { buildNavigationGrid, cellOfPoint, isReachable, isWalkable, nearestWalkable } from '../buildNavigationGrid'
import { placeOfficeDecor } from '../placeOfficeDecor'

function input(): LayoutInput {
  const mk = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ _id: `${p}-${i}` }))
  const mkt = mk(4, 'mkt')
  const fin = mk(4, 'fin')
  const dev = mk(6, 'dev')
  return {
    agents: [...mkt, ...fin, ...dev, ...mk(3, 'loose')],
    sectors: [
      { _id: 'mkt', name: 'Marketing', color: '#FF6A5B', members: mkt.map((a) => ({ agentId: a._id })) },
      { _id: 'fin', name: 'Financeiro', color: '#2E5BFF', members: fin.map((a) => ({ agentId: a._id })) },
      { _id: 'dev', name: 'Desenvolvimento', color: '#38B6F0', members: dev.map((a) => ({ agentId: a._id })) },
    ],
    aspect: 2,
    amenities: [reuniao, cozinha, lounge],
    amenityTint: { reuniao: '#38B6F0', cozinha: '#FFB53D', lounge: '#8B5CF6' },
    decorArts: ['planta-grande-1.5x2'],
  }
}

const layout = buildOfficeLayout(input())
const baseGrid = buildNavigationGrid(layout)

describe('placeOfficeDecor', () => {
  it('is deterministic for the same layout', () => {
    const a = placeOfficeDecor(layout, baseGrid)
    const b = placeOfficeDecor(layout, baseGrid)
    expect(JSON.stringify(a.items)).toBe(JSON.stringify(b.items))
    expect(JSON.stringify(a.interactionPoints)).toBe(JSON.stringify(b.interactionPoints))
  })

  it('places at least some themed decoration and interaction points', () => {
    const d = placeOfficeDecor(layout, baseGrid)
    expect(d.items.length).toBeGreaterThan(0)
    expect(d.interactionPoints.length).toBeGreaterThan(0)
  })

  it('never covers a seat or a chair exit', () => {
    const d = placeOfficeDecor(layout, baseGrid)
    for (const s of layout.seats) {
      for (const it of d.items) {
        const coversSeat = s.seatedPoint.x >= it.x && s.seatedPoint.x <= it.x + it.w && s.seatedPoint.y >= it.y && s.seatedPoint.y <= it.y + it.h
        const coversExit = s.exitPoint.x >= it.x && s.exitPoint.x <= it.x + it.w && s.exitPoint.y >= it.y && s.exitPoint.y <= it.y + it.h
        expect(coversSeat).toBe(false)
        expect(coversExit).toBe(false)
      }
    }
  })

  it('does not break any chair→door route that worked before', () => {
    const d = placeOfficeDecor(layout, baseGrid)
    const merged = buildNavigationGrid({ ...layout, obstacles: [...layout.obstacles, ...d.obstacles] })
    for (const seat of layout.seats) {
      const door = merged.doors.find((dd) => dd.sectorId === seat.sectorId)
      const baseDoor = baseGrid.doors.find((dd) => dd.sectorId === seat.sectorId)
      if (!door || !baseDoor) continue
      const from0 = nearestWalkable(baseGrid, seat.exitPoint, 3)
      const to0 = nearestWalkable(baseGrid, baseDoor.inner, 3)
      // only require preservation where the base grid already had the route
      if (!from0 || !to0 || !isReachable(baseGrid, from0, to0)) continue
      const from = nearestWalkable(merged, seat.exitPoint, 3)
      const to = nearestWalkable(merged, door.inner, 3)
      expect(from && to && isReachable(merged, from, to)).toBeTruthy()
    }
  })

  it('adds deterministic non-blocking ambient wall detail per sector', () => {
    const a = placeOfficeDecor(layout, baseGrid)
    const b = placeOfficeDecor(layout, baseGrid)
    expect(JSON.stringify(a.ambient)).toBe(JSON.stringify(b.ambient)) // deterministic
    const sectors = layout.rooms.filter((r) => r.kind === 'sector').length
    expect(a.ambient.length).toBe(sectors) // one per sector
    // ambient never becomes an obstacle (only placed blocking items do)
    expect(a.obstacles.length).toBe(a.items.length)
    // ambient wall detail is present (one per sector, asserted above) — it is no
    // longer tied to a ratio of items, which now scale up with the denser decor.
    expect(a.ambient.length).toBeGreaterThan(0)
  })

  it('produces interaction points that stand on walkable, reachable cells', () => {
    const d = placeOfficeDecor(layout, baseGrid)
    const merged = buildNavigationGrid({ ...layout, obstacles: [...layout.obstacles, ...d.obstacles] })
    const anchor = nearestWalkable(merged, merged.doors[0].outer, 2)!
    for (const ip of d.interactionPoints) {
      const c = cellOfPoint(merged, ip.point)
      expect(isWalkable(merged, c.i, c.j)).toBe(true)
      expect(isReachable(merged, anchor, c)).toBe(true)
    }
  })
})
