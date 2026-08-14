import { describe, expect, it } from 'vitest'
import { reachableCollaboratorCount } from './agentReadiness'
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
