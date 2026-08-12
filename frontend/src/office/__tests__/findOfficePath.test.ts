import { describe, expect, it } from 'vitest'
import type { NavGrid } from '../buildNavigationGrid'
import { cellOfPoint } from '../buildNavigationGrid'
import { findOfficePath, findOfficePathCells } from '../findOfficePath'
import { buildOfficeLayout } from '../buildOfficeLayout'
import { buildNavigationGrid, nearestWalkable } from '../buildNavigationGrid'
import { cozinha, lounge, reuniao } from '../cenarios'

// Build a 1-tile-per-cell grid from ASCII: '#' blocked, anything else walkable.
function gridFromAscii(rows: string[]): NavGrid {
  const h = rows.length
  const w = Math.max(...rows.map((r) => r.length))
  const blocked = new Uint8Array(w * h)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if ((rows[j][i] ?? '#') === '#') blocked[j * w + i] = 1
    }
  return { res: 1, w, h, cols: w, rows: h, blocked, doors: [] }
}

function orthogonal(cells: { i: number; j: number }[]): boolean {
  for (let k = 1; k < cells.length; k++) {
    const d = Math.abs(cells[k].i - cells[k - 1].i) + Math.abs(cells[k].j - cells[k - 1].j)
    if (d !== 1) return false
  }
  return true
}

describe('findOfficePath (A* 4-dir)', () => {
  it('finds a straight corridor path', () => {
    const g = gridFromAscii(['......'])
    const path = findOfficePathCells(g, { i: 0, j: 0 }, { i: 5, j: 0 })
    expect(path?.length).toBe(6)
    expect(orthogonal(path!)).toBe(true)
  })

  it('routes around a desk', () => {
    const g = gridFromAscii([
      '.....', //
      '.###.',
      '.....',
    ])
    const path = findOfficePathCells(g, { i: 0, j: 1 }, { i: 4, j: 1 })
    expect(path).toBeTruthy()
    expect(path!.every((c) => g.blocked[c.j * g.w + c.i] === 0)).toBe(true)
    expect(orthogonal(path!)).toBe(true)
  })

  it('passes through a door gap in a wall', () => {
    const g = gridFromAscii([
      '.......', //
      '###.###',
      '.......',
    ])
    const path = findOfficePathCells(g, { i: 0, j: 0 }, { i: 6, j: 2 })
    expect(path).toBeTruthy()
    // must pass through the single gap at column 3
    expect(path!.some((c) => c.i === 3 && c.j === 1)).toBe(true)
  })

  it('never steps onto a wall', () => {
    const g = gridFromAscii([
      '.....', //
      '.#.#.',
      '.#.#.',
      '.....',
    ])
    const path = findOfficePathCells(g, { i: 0, j: 0 }, { i: 4, j: 3 })
    expect(path!.every((c) => g.blocked[c.j * g.w + c.i] === 0)).toBe(true)
  })

  it('returns null when there is no route', () => {
    const g = gridFromAscii([
      '..#..', //
      '..#..',
      '..#..',
    ])
    expect(findOfficePathCells(g, { i: 0, j: 1 }, { i: 4, j: 1 })).toBeNull()
  })

  it('never cuts a diagonal corner', () => {
    // Two walls meeting at a corner: a diagonal-cutting planner would slip from
    // (0,0) straight to (1,1); a 4-connected one cannot, so it returns null.
    const g = gridFromAscii([
      '.#', //
      '#.',
    ])
    expect(findOfficePathCells(g, { i: 0, j: 0 }, { i: 1, j: 1 })).toBeNull()
  })

  it('reacts to a temporarily reserved cell by routing around it', () => {
    const g = gridFromAscii([
      '.....', //
      '.....',
      '.....',
    ])
    const straight = findOfficePathCells(g, { i: 0, j: 1 }, { i: 4, j: 1 })!
    expect(straight.length).toBe(5) // straight line
    const avoid = new Set(['2,1']) // reserve the middle cell
    const around = findOfficePathCells(g, { i: 0, j: 1 }, { i: 4, j: 1 }, { avoid })!
    expect(around.some((c) => c.i === 2 && c.j === 1)).toBe(false)
    expect(around.length).toBeGreaterThan(straight.length)
  })

  it('is deterministic for the same inputs', () => {
    const g = gridFromAscii([
      '......', //
      '.##.#.',
      '......',
      '.#.##.',
      '......',
    ])
    const a = findOfficePathCells(g, { i: 0, j: 0 }, { i: 5, j: 4 })
    const b = findOfficePathCells(g, { i: 0, j: 0 }, { i: 5, j: 4 })
    expect(a).toEqual(b)
  })

  it('paths from a seated agent to a door on the real office grid', () => {
    const mk = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ _id: `${p}-${i}` }))
    const dev = mk(4, 'dev')
    const loose = mk(3, 'loose')
    const L = buildOfficeLayout({
      agents: [...dev, ...loose],
      sectors: [{ _id: 'dev', name: 'Dev', color: '#2E5BFF', members: dev.map((a) => ({ agentId: a._id })) }],
      aspect: 2,
      amenities: [reuniao, cozinha, lounge],
      amenityTint: { reuniao: '#38B6F0', cozinha: '#FFB53D', lounge: '#8B5CF6' },
      decorArts: ['planta-grande-1.5x2'],
    })
    const g = buildNavigationGrid(L)
    let found = 0
    for (const s of L.seats) {
      const from = nearestWalkable(g, s.exitPoint, 3)
      if (!from) continue
      for (const d of g.doors) {
        const to = cellOfPoint(g, d.outer)
        const p = findOfficePath(g, from, to)
        if (p) {
          found++
          break
        }
      }
    }
    expect(found).toBeGreaterThan(0)
  })
})
