import { describe, expect, it } from 'vitest'
import { auditLink, describeAudit, durationLabel, logsQuery, type AuditLogItem } from './logs'

// The log screen turns a closed vocabulary into sentences a person can read, and
// nothing more: there is no place here for content, only for facts about it.

const event = (over: Partial<AuditLogItem> = {}): AuditLogItem => ({
  id: 'e1',
  actorType: 'user',
  actorId: 'u1',
  action: 'update',
  entityType: 'routine',
  entityId: 'r1',
  floorId: 'f1',
  result: 'success',
  occurredAt: '2026-08-15T12:00:00Z',
  requestId: 'req-1234-5678',
  metadata: {},
  ...over,
})

describe('describeAudit', () => {
  it('reads as a sentence', () => {
    expect(describeAudit(event())).toBe('Você editou rotina')
    expect(describeAudit(event({ action: 'delete', entityType: 'agent' }))).toBe('Você excluiu agente')
    expect(describeAudit(event({ actorType: 'system', action: 'pause', entityType: 'event_trigger' }))).toBe('Sistema pausou gatilho')
  })
})

describe('auditLink', () => {
  it('opens the entity where the app really has a page for it', () => {
    expect(auditLink(event({ entityType: 'agent', entityId: 'a1', floorId: 'f1' }))).toBe('/floors/f1/agents/a1')
    expect(auditLink(event({ entityType: 'agent', entityId: 'a1', floorId: null }))).toBe('/agents/a1')
    expect(auditLink(event({ entityType: 'sector', entityId: 's1', floorId: 'f1' }))).toBe('/floors/f1/sectors/s1')
    expect(auditLink(event({ entityType: 'tool', entityId: 't1' }))).toBe('/tools')
  })

  it('offers no link to something that no longer exists', () => {
    expect(auditLink(event({ action: 'delete' }))).toBeNull()
    expect(auditLink(event({ entityId: null }))).toBeNull()
    expect(auditLink(event({ entityType: 'settings' }))).toBeNull()
  })
})

describe('durationLabel', () => {
  it('drops the noise above a second', () => {
    expect(durationLabel(340)).toBe('340 ms')
    expect(durationLabel(3200)).toBe('3,2 s')
    expect(durationLabel(125_000)).toBe('2 min 5s')
  })

  it('shows nothing for a run that never finished', () => {
    expect(durationLabel(null)).toBe('—')
    expect(durationLabel(undefined)).toBe('—')
  })
})

describe('logsQuery', () => {
  it('carries the cursor, the limit and every chosen filter', () => {
    const query = logsQuery('/api/logs/runs', { agentId: 'a1', triggerType: 'webhook' }, { limit: 25, cursor: 'c1' })
    expect(query).toContain('limit=25')
    expect(query).toContain('cursor=c1')
    expect(query).toContain('agentId=a1')
    expect(query).toContain('triggerType=webhook')
  })

  it('omits what was not chosen', () => {
    const query = logsQuery('/api/logs/audit', { action: '', entityType: undefined }, { limit: 25 })
    expect(query).not.toContain('action')
    expect(query).not.toContain('entityType')
    expect(query).not.toContain('cursor')
  })
})
