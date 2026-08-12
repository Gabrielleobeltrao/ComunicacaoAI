import { describe, expect, it } from 'vitest'
import { assignCharacters } from '../agentAvatar'

describe('assignCharacters', () => {
  it('is deterministic and does not repeat a face while faces remain', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const m1 = assignCharacters(ids)
    const m2 = assignCharacters(ids)
    expect([...m1.entries()]).toEqual([...m2.entries()]) // deterministic
    expect(new Set(m1.values()).size).toBe(ids.length) // no repeats (<= cast size)
  })

  it('keeps every existing agent when a new one is added', () => {
    const ids = ['dev-2', 'sup-1', 'mkt-9', 'fin-4']
    const first = assignCharacters(ids)
    const withNew = assignCharacters([...ids, 'brand-new'], first)
    for (const id of ids) expect(withNew.get(id)).toBe(first.get(id)) // nobody reshuffles
    expect(withNew.get('brand-new')).toBeTruthy()
  })

  it('reuses the least-used face once the cast is exhausted', () => {
    const ids = Array.from({ length: 14 }, (_, i) => `agent-${i}`)
    const m = assignCharacters(ids)
    const counts = new Map<string, number>()
    for (const c of m.values()) counts.set(c, (counts.get(c) ?? 0) + 1)
    // 14 agents over 10 faces → each face used once or twice, none three times
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(2)
  })
})
