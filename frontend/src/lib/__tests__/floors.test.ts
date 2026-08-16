import { describe, expect, it } from 'vitest'
import { resolveActiveFloor } from '../floors'
import type { Floor } from '../floors'

const f = (id: string, status: 'active' | 'archived' = 'active', order = 0): Floor => ({
  id,
  buildingId: 'b',
  name: id,
  mission: '',
  description: '',
  timezone: 'UTC',
  defaultLanguage: 'pt',
  workMode: 'organization',
  coordinatorAgentId: null,
  instruction: '',
  color: null,
  icon: null,
  order,
  status,
  createdAt: '',
  updatedAt: '',
})

describe('resolveActiveFloor', () => {
  it('keeps a valid saved active floor', () => {
    expect(resolveActiveFloor([f('a'), f('b')], 'b')).toBe('b')
  })
  it('falls back to the first active floor when the saved one is archived or missing', () => {
    expect(resolveActiveFloor([f('a'), f('b', 'archived')], 'b')).toBe('a')
    expect(resolveActiveFloor([f('a')], 'gone')).toBe('a')
    expect(resolveActiveFloor([f('a')], null)).toBe('a')
  })
  it('returns null when there is no active floor', () => {
    expect(resolveActiveFloor([f('a', 'archived')], 'a')).toBe(null)
    expect(resolveActiveFloor([], null)).toBe(null)
  })
})
