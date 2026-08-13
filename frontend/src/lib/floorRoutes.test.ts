import { describe, expect, it } from 'vitest'
import { floorAgent, floorAgents, floorHome, floorSector, parseFloorPath, switchFloorPath } from './floorRoutes'

describe('floorRoutes', () => {
  it('builds canonical paths', () => {
    expect(floorHome('A')).toBe('/floors/A')
    expect(floorAgents('A')).toBe('/floors/A/agents')
    expect(floorAgent('A', 'x')).toBe('/floors/A/agents/x')
    expect(floorAgent('A', 'x', 'edit')).toBe('/floors/A/agents/x/edit')
    expect(floorSector('A', 's', 'members')).toBe('/floors/A/sectors/s/members')
  })

  it('parses the floor + module section from a path', () => {
    expect(parseFloorPath('/floors/A')).toEqual({ floorId: 'A', section: null })
    expect(parseFloorPath('/floors/A/agents')).toEqual({ floorId: 'A', section: 'agents' })
    expect(parseFloorPath('/floors/A/agents/x')).toEqual({ floorId: 'A', section: 'agents' })
    expect(parseFloorPath('/widgets')).toEqual({ floorId: null, section: null })
  })

  describe('switchFloorPath keeps the module but never a detail id', () => {
    it('floor home → new floor home', () => {
      expect(switchFloorPath('/floors/A', 'B')).toBe('/floors/B')
    })
    it('list modules carry over', () => {
      expect(switchFloorPath('/floors/A/agents', 'B')).toBe('/floors/B/agents')
      expect(switchFloorPath('/floors/A/sectors', 'B')).toBe('/floors/B/sectors')
      expect(switchFloorPath('/floors/A/automations', 'B')).toBe('/floors/B/automations')
      expect(switchFloorPath('/floors/A/runs', 'B')).toBe('/floors/B/runs')
    })
    it('a detail route drops the id and lands on the module root of the new floor', () => {
      expect(switchFloorPath('/floors/A/agents/agent-1', 'B')).toBe('/floors/B/agents')
      expect(switchFloorPath('/floors/A/sectors/sec-1/members', 'B')).toBe('/floors/B/sectors')
      expect(switchFloorPath('/floors/A/automations/auto-1', 'B')).toBe('/floors/B/automations')
    })
    it('a global route lands on the new floor home', () => {
      expect(switchFloorPath('/widgets', 'B')).toBe('/floors/B')
      expect(switchFloorPath('/chats', 'B')).toBe('/floors/B')
    })
  })
})
