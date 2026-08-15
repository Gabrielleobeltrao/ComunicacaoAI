import { describe, expect, it } from 'vitest'
import {
  absoluteWhen,
  agentFlowPath,
  averageTokensLabel,
  executionsQuery,
  relativeWhen,
  statusOptionsFor,
  summaryQuery,
  tokensLabel,
} from './executions'
import { activeFilterCount, agentsFor, narrowFilters } from '../pages/Executions'

// The Central de execuções shows facts, not guesses. These pin the rules that keep
// it honest: an average says it is an average, a missing value stays "—", and the
// query really carries the filters the user chose.

const NOW = new Date('2026-08-15T12:00:00Z')

describe('relativeWhen', () => {
  it('reads forwards and backwards', () => {
    expect(relativeWhen('2026-08-15T15:00:00Z', NOW)).toBe('em 3 horas')
    expect(relativeWhen('2026-08-15T11:00:00Z', NOW)).toBe('há 1 hora')
    expect(relativeWhen('2026-08-17T12:00:00Z', NOW)).toBe('em 2 dias')
    expect(relativeWhen('2026-08-15T12:10:00Z', NOW)).toBe('em 10 minutos')
  })

  it('collapses the last few seconds into "agora"', () => {
    expect(relativeWhen('2026-08-15T12:00:20Z', NOW)).toBe('agora')
  })

  it('never invents a time it does not have', () => {
    expect(relativeWhen(null, NOW)).toBe('—')
    expect(relativeWhen('não é data', NOW)).toBe('—')
  })
})

describe('absoluteWhen', () => {
  it('is the exact instant, so the relative one is never the only claim', () => {
    expect(absoluteWhen('2026-08-15T12:00:00Z')).toMatch(/15\/08\/2026/)
  })

  it('has nothing to show without a date', () => {
    expect(absoluteWhen(null)).toBe('—')
    expect(absoluteWhen(undefined)).toBe('—')
  })
})

describe('tokensLabel', () => {
  it('keeps small numbers exact', () => {
    expect(tokensLabel(0)).toBe('0')
    expect(tokensLabel(999)).toBe('999')
  })

  it('abbreviates larger ones', () => {
    expect(tokensLabel(1500)).toBe('1,5 mil')
    expect(tokensLabel(42_000)).toBe('42 mil')
    expect(tokensLabel(2_400_000)).toBe('2,4 mi')
  })

  it('shows nothing rather than a zero it cannot back', () => {
    expect(tokensLabel(null)).toBe('—')
  })
})

describe('averageTokensLabel', () => {
  it('says it is an average and names the sample', () => {
    const label = averageTokensLabel(1200, 8)
    expect(label).toContain('média')
    expect(label).toContain('8')
    expect(label).toContain('~')
  })

  it('promises nothing without history', () => {
    expect(averageTokensLabel(null, 0)).toBe('Sem histórico')
    expect(averageTokensLabel(500, 0)).toBe('Sem histórico')
  })
})

describe('statusOptionsFor', () => {
  it('offers automation states on the scheduled and trigger tabs', () => {
    for (const tab of ['scheduled', 'triggers'] as const) {
      expect(statusOptionsFor(tab).map((o) => o.value)).toEqual(['', 'active', 'paused'])
    }
  })

  it('offers only in-flight states while work is in flight', () => {
    expect(statusOptionsFor('active').map((o) => o.value)).toEqual(['', 'queued', 'running', 'cancel_requested'])
  })

  it('offers only closed states in history', () => {
    expect(statusOptionsFor('history').map((o) => o.value)).toEqual(['', 'succeeded', 'failed', 'canceled'])
  })
})

describe('executionsQuery', () => {
  it('carries the tab, the page and every chosen filter', () => {
    const query = executionsQuery('triggers', { floorId: 'f1', agentId: 'a1' }, { limit: 20, skip: 40 })
    expect(query).toContain('tab=triggers')
    expect(query).toContain('limit=20')
    expect(query).toContain('skip=40')
    expect(query).toContain('floorId=f1')
    expect(query).toContain('agentId=a1')
  })

  it('omits what was not chosen instead of sending empty filters', () => {
    const query = executionsQuery('scheduled', { floorId: undefined, status: '' }, { limit: 20, skip: 0 })
    expect(query).not.toContain('floorId')
    expect(query).not.toContain('status')
  })
})

describe('agentFlowPath', () => {
  it('opens the agent on Fluxos — where the work is actually edited', () => {
    expect(agentFlowPath({ floorId: 'f1', floorName: null, sectorId: null, sectorName: null }, 'a1')).toBe('/floors/f1/agents/a1/fluxos')
  })

  it('falls back to the flat route when the row has no floor', () => {
    expect(agentFlowPath({ floorId: null, floorName: null, sectorId: null, sectorName: null }, 'a1')).toBe('/agents/a1/fluxos')
  })
})

// The pickers must be conjunctive the way the API is: a wider choice narrows the
// narrower ones, and a selection that no longer fits is cleared instead of being
// sent as a combination that can only answer nothing.
describe('narrowFilters', () => {
  const options = {
    floors: [
      { id: 'f1', name: 'Térreo' },
      { id: 'f2', name: 'Primeiro' },
    ],
    sectors: [
      { _id: 's1', name: 'Atendimento', floorId: 'f1', members: [{ agentId: 'a1' }] },
      { _id: 's2', name: 'Compras', floorId: 'f2', members: [{ agentId: 'a2' }] },
    ],
    agents: [
      { _id: 'a1', name: 'Ana', floorId: 'f1' },
      { _id: 'a2', name: 'Bruno', floorId: 'f2' },
    ],
  }

  it('changing floor drops a sector and an agent from another floor', () => {
    const next = narrowFilters({ floorId: 'f2', sectorId: 's1', agentId: 'a1' }, options)
    expect(next).toEqual({ floorId: 'f2', sectorId: undefined, agentId: undefined })
  })

  it('keeps what still fits', () => {
    const next = narrowFilters({ floorId: 'f1', sectorId: 's1', agentId: 'a1' }, options)
    expect(next).toEqual({ floorId: 'f1', sectorId: 's1', agentId: 'a1' })
  })

  it('choosing a sector drops an agent that is not in it', () => {
    const next = narrowFilters({ sectorId: 's1', agentId: 'a2' }, options)
    expect(next.sectorId).toBe('s1')
    expect(next.agentId).toBeUndefined()
  })

  it('never touches the status', () => {
    expect(narrowFilters({ floorId: 'f1', status: 'paused' }, options).status).toBe('paused')
  })
})

describe('agentsFor', () => {
  const options = {
    floors: [],
    sectors: [{ _id: 's1', name: 'Atendimento', floorId: 'f1', members: [{ agentId: 'a1' }] }],
    agents: [
      { _id: 'a1', name: 'Ana', floorId: 'f1' },
      { _id: 'a2', name: 'Bruno', floorId: 'f1' },
      { _id: 'a3', name: 'Carla', floorId: 'f2' },
    ],
  }

  it('offers only the chosen floor', () => {
    expect(agentsFor({ floorId: 'f1' }, options).map((a) => a._id)).toEqual(['a1', 'a2'])
  })

  it('offers only the chosen sector', () => {
    expect(agentsFor({ sectorId: 's1' }, options).map((a) => a._id)).toEqual(['a1'])
  })

  it('offers everyone when nothing narrows it', () => {
    expect(agentsFor({}, options)).toHaveLength(3)
  })
})

describe('activeFilterCount', () => {
  it('counts what the mobile button has to announce', () => {
    expect(activeFilterCount({})).toBe(0)
    expect(activeFilterCount({ floorId: 'f1' })).toBe(1)
    expect(activeFilterCount({ floorId: 'f1', sectorId: 's1', agentId: 'a1', status: 'active' })).toBe(4)
  })
})

describe('summaryQuery', () => {
  it('asks the counters the same question the list was asked', () => {
    expect(summaryQuery({ floorId: 'f1', agentId: 'a1' })).toBe('/api/executions/summary?floorId=f1&agentId=a1')
  })

  it('has no query string when nothing is filtered', () => {
    expect(summaryQuery({})).toBe('/api/executions/summary')
  })
})
