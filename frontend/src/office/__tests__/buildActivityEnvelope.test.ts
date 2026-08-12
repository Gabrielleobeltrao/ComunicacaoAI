import { describe, expect, it } from 'vitest'
import { cozinha, lounge, reuniao } from '../cenarios'
import { buildOfficeLayout } from '../buildOfficeLayout'
import type { LayoutInput } from '../buildOfficeLayout'
import { buildNavigationGrid, cellIndex, cellOfPoint } from '../buildNavigationGrid'
import { buildActivityEnvelope, inEnvelopeCell, inEnvelopePoint } from '../buildActivityEnvelope'
import { createContext, footOf } from '../officeSimCore'

function input(): LayoutInput {
  const mk = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ _id: `${p}-${i}` }))
  const dev = mk(4, 'dev')
  const fin = mk(3, 'fin')
  const loose = mk(6, 'loose')
  return {
    agents: [...dev, ...fin, ...loose],
    sectors: [
      { _id: 'dev', name: 'Desenvolvimento', color: '#2E5BFF', members: dev.map((a) => ({ agentId: a._id })) },
      { _id: 'fin', name: 'Financeiro', color: '#17B98A', members: fin.map((a) => ({ agentId: a._id })) },
    ],
    aspect: 2,
    amenities: [reuniao, cozinha, lounge],
    amenityTint: { reuniao: '#38B6F0', cozinha: '#FFB53D', lounge: '#8B5CF6' },
    decorArts: ['planta-grande-1.5x2'],
  }
}

const layout = buildOfficeLayout(input())
const grid = buildNavigationGrid(layout)
const env = buildActivityEnvelope(layout, grid)

describe('buildActivityEnvelope', () => {
  it('is deterministic', () => {
    const b = buildActivityEnvelope(layout, grid)
    expect(env.mask.length).toBe(b.mask.length)
    for (let i = 0; i < env.mask.length; i++) expect(env.mask[i]).toBe(b.mask[i])
  })

  it('covers rooms but not the whole walkable floor', () => {
    let inCount = 0
    let walkable = 0
    for (let j = 0; j < grid.h; j++)
      for (let i = 0; i < grid.w; i++) {
        if (grid.blocked[cellIndex(grid, i, j)] === 0) walkable++
        if (env.mask[cellIndex(grid, i, j)] === 1) inCount++
      }
    expect(inCount).toBeGreaterThan(0)
    // the envelope is a strict subset of walkable space (far corners excluded)
    expect(inCount).toBeLessThan(walkable)
  })

  it('contains every loose agent start position', () => {
    for (const o of layout.loose) {
      const foot = footOf(o.point)
      expect(inEnvelopePoint(env, grid, foot)).toBe(true)
    }
  })

  it('keeps every corridor waypoint inside the envelope', () => {
    const ctx = createContext(layout, grid, layout.seats.length + layout.loose.length, [], env)
    expect(ctx.waypoints.length).toBeGreaterThan(0)
    for (const w of ctx.waypoints) {
      const c = cellOfPoint(grid, w)
      expect(inEnvelopeCell(env, c.i, c.j)).toBe(true)
    }
  })
})
