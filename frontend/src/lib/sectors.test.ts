import { describe, expect, it } from 'vitest'
import { sectorReadiness } from './sectors'
import type { SectorMemberSummary } from './types'

// Readiness must mirror the backend rule (plan §7.5), so the hero badge and the
// wizard's "will be incomplete" warning never disagree with what the API enforces.
const member = (isDefault = false): SectorMemberSummary => ({ agentId: 'a', sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault })

describe('sectorReadiness', () => {
  it('adaptive: ready needs >= 1 member AND a default', () => {
    expect(sectorReadiness('adaptive', [])).toBe('incomplete')
    expect(sectorReadiness('adaptive', [member(false)])).toBe('incomplete') // no default
    expect(sectorReadiness('adaptive', [member(true)])).toBe('ready')
  })

  it('pipeline: ready needs >= 2 members AND a default', () => {
    expect(sectorReadiness('pipeline', [member(true)])).toBe('incomplete') // only one stage
    expect(sectorReadiness('pipeline', [member(false), member(false)])).toBe('incomplete') // no default
    expect(sectorReadiness('pipeline', [member(true), member(false)])).toBe('ready')
  })
})
