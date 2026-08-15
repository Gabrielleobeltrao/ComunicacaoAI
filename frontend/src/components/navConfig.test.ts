import { describe, expect, it } from 'vitest'
import { isNavActive, navGroupsFor, navItemsFor } from './navConfig'

// Regression guard for the pivot: "Automação" is not a product surface — there is no
// Automações builder and no AUTOMAÇÃO group. What DOES exist is "Execuções": an
// observability surface over the work the agents already do. Creating still happens
// inside the agent (Fluxos); this item only shows and controls.
describe('navConfig has no automation builder', () => {
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
  })
})

describe('the CONTROLE group', () => {
  it('carries Execuções, on every floor and with none selected', () => {
    for (const floorId of [null, 'floor-1']) {
      const executions = navItemsFor(floorId).find((i) => i.key === 'executions')
      expect(executions).toBeDefined()
      expect(executions?.label).toBe('Execuções')
      // Building-wide: the path never depends on the active floor.
      expect(executions?.path(floorId)).toBe('/executions')
    }
  })

  it('is its own group, after the existing ones', () => {
    const groups = navGroupsFor('floor-1', 'Térreo')
    expect(groups.map((g) => g.group)).toEqual(['operation', 'communication', 'control'])
    expect(groups.find((g) => g.group === 'control')?.label).toBe('CONTROLE')
  })

  it('is not floor-scoped, so it never renders disabled without a floor', () => {
    const executions = navItemsFor(null).find((i) => i.key === 'executions')
    expect(executions?.scope).not.toBe('floor')
  })

  it('stays lit on its own page', () => {
    const executions = navItemsFor(null).find((i) => i.key === 'executions')!
    expect(isNavActive(executions, null, '/executions')).toBe(true)
    expect(isNavActive(executions, null, '/agents')).toBe(false)
  })
})

// Desktop rail, mobile drawer and the bottom bar all read THIS module — a
// destination that exists on one surface and not the others is the bug this guards.
describe('one configuration feeds every surface', () => {
  it('the same item set is produced whatever the caller', () => {
    const grouped = navGroupsFor('floor-1', 'Térreo').flatMap((g) => g.items.map((i) => i.key))
    expect(grouped).toEqual(navItemsFor('floor-1').map((i) => i.key))
  })

  it('Execuções is reachable on a phone', () => {
    const executions = navItemsFor(null).find((i) => i.key === 'executions')
    expect(executions?.mobilePrimary).toBe(true)
  })
})
