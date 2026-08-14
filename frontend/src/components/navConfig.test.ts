import { describe, expect, it } from 'vitest'
import { navGroupsFor, navItemsFor } from './navConfig'

// Regression guard for the pivot: "Automação" is not a product surface. There is
// no Automações/Execuções nav item and no AUTOMAÇÃO group, on any floor.
describe('navConfig has no automation surface', () => {
  it('exposes no automations/runs items', () => {
    for (const floorId of [null, 'floor-1']) {
      const keys = navItemsFor(floorId).map((i) => i.key)
      expect(keys).not.toContain('automations')
      expect(keys).not.toContain('runs')
    }
  })

  it('produces no AUTOMAÇÃO group', () => {
    const labels = navGroupsFor('floor-1', 'Térreo').map((g) => g.label)
    expect(labels.some((l) => /AUTOMA/i.test(l))).toBe(false)
    // The expected groups are still present.
    expect(navGroupsFor('floor-1').map((g) => g.group)).toEqual(['operation', 'communication'])
  })
})
