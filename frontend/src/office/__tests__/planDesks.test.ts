import { describe, expect, it } from 'vitest'
import { planDesks } from '../buildOfficeLayout'

// A sector caps at 10 members; the packing must seat EXACTLY the team (no empty
// seats, no missing seat), combining desks for the in-between counts.
const rng = () => 0.25 // deterministic; < 0.5 → mesa-1 faces front

describe('planDesks', () => {
  it('seats exactly k agents for every sector size 0..10', () => {
    for (let k = 0; k <= 10; k++) {
      const seats = planDesks(k, rng).reduce((n, d) => n + d.seats.length, 0)
      expect(seats).toBe(k)
    }
  })

  it('uses a single desk for the exact sizes and combines for the rest', () => {
    // rng = 0.25 < 0.5 → front-facing variants for the 1- and 2-seat desks
    expect(planDesks(1, rng).map((d) => d.art)).toEqual(['mesa-1-frente-2x2'])
    expect(planDesks(2, rng).map((d) => d.art)).toEqual(['mesa-2-frente-3x2'])
    expect(planDesks(4, rng).map((d) => d.art)).toEqual(['mesa-4-3x3'])
    expect(planDesks(6, rng).map((d) => d.art)).toEqual(['mesa-6-4.5x3'])
    expect(planDesks(10, rng).map((d) => d.art)).toEqual(['mesa-10-7.5x3'])
    // in-between counts combine, largest-first
    expect(planDesks(3, rng).map((d) => d.art)).toEqual(['mesa-2-frente-3x2', 'mesa-1-frente-2x2'])
    expect(planDesks(9, rng).map((d) => d.art)).toEqual(['mesa-6-4.5x3', 'mesa-2-frente-3x2', 'mesa-1-frente-2x2'])
  })

  it('faces 1- and 2-seat desks front or back by chance', () => {
    expect(planDesks(1, () => 0.9)[0].art).toBe('mesa-1-costas-2x2')
    expect(planDesks(1, () => 0.1)[0].art).toBe('mesa-1-frente-2x2')
    expect(planDesks(2, () => 0.9)[0].art).toBe('mesa-2-3x2')
    expect(planDesks(2, () => 0.1)[0].art).toBe('mesa-2-frente-3x2')
  })
})
