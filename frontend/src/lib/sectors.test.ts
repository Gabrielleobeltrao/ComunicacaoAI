import { describe, expect, it } from 'vitest'
import { sectorReadiness } from './sectors'
import type { SectorMemberSummary } from './types'

// Readiness must mirror the backend rule (plan §7.5), so the hero badge and the
// wizard's "will be incomplete" warning never disagree with what the API enforces.
const member = (isDefault = false): SectorMemberSummary => ({ agentId: 'a', sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault })

describe('sectorReadiness', () => {
  it('organization: ready with at least one member', () => {
    expect(sectorReadiness('organization', [])).toBe('incomplete')
    expect(sectorReadiness('organization', [member()])).toBe('ready')
  })

  it('orchestrated: ready needs a coordinator AND a member', () => {
    expect(sectorReadiness('orchestrated', [member()])).toBe('incomplete') // no coordinator
    expect(sectorReadiness('orchestrated', [], { coordinatorAgentId: 'c' })).toBe('incomplete') // no member
    expect(sectorReadiness('orchestrated', [member()], { coordinatorAgentId: 'c' })).toBe('ready')
  })

  it('pipeline: ready needs at least one stage', () => {
    expect(sectorReadiness('pipeline', [], { stages: [] })).toBe('incomplete')
    expect(sectorReadiness('pipeline', [], { stages: [{ id: 's1' }] })).toBe('ready')
  })
})
