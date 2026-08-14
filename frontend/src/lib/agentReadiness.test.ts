import { describe, expect, it } from 'vitest'
import { reachableCollaboratorCount, reachFromPool } from './agentReadiness'
import type { AgentSummary, SectorSummary } from './types'

// Must agree with backend/src/agentReadiness.ts: a policy is not a colleague, so the
// hiring wizard and the card never promise a manager that is alone in the building.
const agent = (id: string, over: Partial<AgentSummary> = {}) => ({ _id: id, name: id, callerPolicy: 'all', allowedCallerAgentIds: [], ...over }) as AgentSummary
const sector = (id: string, mode: SectorSummary['mode']) => ({ _id: id, name: id, mode, members: [] }) as unknown as SectorSummary

describe('reachableCollaboratorCount', () => {
  it('is zero when there is nobody else, whatever the policy says', () => {
    expect(reachableCollaboratorCount({ id: 'm', delegationPolicy: 'all' }, [agent('m')], [])).toBe(0)
    expect(reachableCollaboratorCount({ delegationPolicy: 'all' }, [], [])).toBe(0)
  })

  it('never counts the agent itself', () => {
    expect(reachableCollaboratorCount({ id: 'm', delegationPolicy: 'all' }, [agent('m'), agent('a')], [])).toBe(1)
  })

  it('policy none reaches nobody', () => {
    expect(reachableCollaboratorCount({ id: 'm', delegationPolicy: 'none' }, [agent('a'), agent('b')], [])).toBe(0)
  })

  it('respects the colleague that refuses calls', () => {
    const agents = [agent('closed', { callerPolicy: 'none' }), agent('picky', { callerPolicy: 'selected', allowedCallerAgentIds: ['other'] }), agent('open')]
    expect(reachableCollaboratorCount({ id: 'm', delegationPolicy: 'all' }, agents, [])).toBe(1)
    // 'picky' becomes reachable once it names this caller.
    const named = [agent('picky', { callerPolicy: 'selected', allowedCallerAgentIds: ['m'] })]
    expect(reachableCollaboratorCount({ id: 'm', delegationPolicy: 'all' }, named, [])).toBe(1)
  })

  it('only counts sectors that can actually execute', () => {
    const sectors = [sector('grupo', 'organization'), sector('time', 'orchestrated'), sector('fluxo', 'pipeline')]
    expect(reachableCollaboratorCount({ id: 'm', delegationPolicy: 'all' }, [], sectors)).toBe(2)
  })

  it('selected counts only what was named', () => {
    const agents = [agent('a'), agent('b')]
    const sectors = [sector('time', 'orchestrated'), sector('outro', 'pipeline')]
    expect(reachableCollaboratorCount({ id: 'm', delegationPolicy: 'selected', callableAgentIds: ['a'], callableSectorIds: ['time'] }, agents, sectors)).toBe(2)
    expect(reachableCollaboratorCount({ id: 'm', delegationPolicy: 'selected', callableAgentIds: [], callableSectorIds: [] }, agents, sectors)).toBe(0)
  })
})

// The editor's counter must agree with the backend: a colleague listed as "não
// aceita chamadas hoje" is visible, but never a promise.
describe('reachFromPool', () => {
  const pool = {
    agents: [{ _id: 'a', acceptsCall: true }, { _id: 'b', acceptsCall: false }, { _id: 'c' }],
    sectors: [{ _id: 's1' }, { _id: 's2' }],
  }

  it('none reaches nobody', () => {
    expect(reachFromPool('none', pool, ['a'], ['s1'])).toBe(0)
  })

  it('all counts only colleagues that accept, plus every executable team', () => {
    // 'a' accepts, 'c' has no flag (accepts), 'b' refuses → 2 agents + 2 teams.
    expect(reachFromPool('all', pool, [], [])).toBe(4)
  })

  it('selected counts only the picked colleagues that accept', () => {
    expect(reachFromPool('selected', pool, ['a'], [])).toBe(1)
    expect(reachFromPool('selected', pool, ['a', 'c'], ['s1'])).toBe(3)
  })

  it('a manager that picked ONLY a colleague who refuses reaches nobody', () => {
    expect(reachFromPool('selected', pool, ['b'], [])).toBe(0)
  })

  it('a stale selection that is no longer in the pool does not inflate the count', () => {
    expect(reachFromPool('selected', pool, ['gone'], ['also-gone'])).toBe(0)
  })

  it('an empty pool reaches nobody, whatever the policy', () => {
    expect(reachFromPool('all', { agents: [], sectors: [] }, [], [])).toBe(0)
  })
})
