import { describe, expect, it } from 'vitest'
import { sectorReadiness } from './sectors'

// Readiness must mirror backend/src/sectors.ts, so the hero badge, the wizard's
// warning and what the API enforces never disagree.
const member = (agentId = 'a') => ({ agentId })

describe('sectorReadiness', () => {
  it('organization: ready with at least one member', () => {
    expect(sectorReadiness({ mode: 'organization', members: [] }).ready).toBe(false)
    expect(sectorReadiness({ mode: 'organization', members: [member()] }).ready).toBe(true)
  })

  it('orchestrated: ready needs a coordinator AND a member', () => {
    expect(sectorReadiness({ mode: 'orchestrated', members: [member()] }).ready).toBe(false)
    expect(sectorReadiness({ mode: 'orchestrated', members: [], coordinatorAgentId: 'c' }).ready).toBe(false)
    expect(sectorReadiness({ mode: 'orchestrated', members: [member()], coordinatorAgentId: 'c' }).ready).toBe(true)
  })

  it('orchestrated: coordenar sozinho é aviso, não bloqueio', () => {
    // O setor executa — por isso não bloqueia. Mas quem testa vê UM agente trabalhando e
    // conclui que a orquestração quebrou; ela não quebrou, não há a quem delegar.
    const sozinho = sectorReadiness({ mode: 'orchestrated', members: [member('c')], coordinatorAgentId: 'c' })
    expect(sozinho.ready).toBe(true)
    expect(sozinho.issues.map((i) => i.code)).toContain('coordinator_alone')
    // Com um especialista junto, não há o que avisar.
    const comTime = sectorReadiness({ mode: 'orchestrated', members: [member('c'), member('esp')], coordinatorAgentId: 'c' })
    expect(comTime.issues.map((i) => i.code)).not.toContain('coordinator_alone')
  })

  it('pipeline: ready needs stages, each with a real agent', () => {
    expect(sectorReadiness({ mode: 'pipeline', members: [], stages: [] }).ready).toBe(false)
    expect(sectorReadiness({ mode: 'pipeline', members: [], stages: [{ id: 's1', agentId: 'a' }] }).ready).toBe(true)
    const orphan = sectorReadiness({ mode: 'pipeline', members: [], stages: [{ id: 's1', name: 'Triagem', agentId: 'gone' }], knownAgentIds: ['a'] })
    expect(orphan.ready).toBe(false)
    expect(orphan.issues[0].code).toBe('stage_without_agent')
  })

  it('agent pendency is a warning, never a blocker', () => {
    const r = sectorReadiness({ mode: 'organization', members: [member()], pendingAgentNames: ['Ana'] })
    expect(r.ready).toBe(true)
    expect(r.issues.map((i) => i.code)).toEqual(['agent_pending'])
  })
})
