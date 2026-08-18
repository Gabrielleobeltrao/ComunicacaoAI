// Quem está no setor — a pergunta que tinha duas respostas.
//
// Um setor guarda seus agentes em `members` (orquestrado, organizacional) ou em `stages`
// (executar em etapas). Toda tela lia só `members`, e o editor de pipeline gravava
// `members: []` de propósito: o resultado era "0 agentes", coluna vazia ao lado do fluxo
// desenhado, sala vazia no mapa e "Sem setor" na página de cada agente — com os agentes
// existindo o tempo todo dentro das etapas.
import { describe, expect, it } from 'vitest'
import { sectorRoster } from './sectors'

const etapa = (id: string, name: string, agentId: string, dependsOn: string[] = []) => ({
  id,
  name,
  agentId,
  instruction: '',
  dependsOn,
  inputMapping: {},
  expectedOutput: '',
  retryPolicy: { maxAttempts: 1, backoffMs: 2000 },
  onError: 'stop' as const,
})

const membro = (agentId: string, over: Record<string, unknown> = {}) => ({
  agentId,
  sector: '',
  routingDescription: '',
  advanceWhen: '',
  transitions: [],
  isDefault: false,
  ...over,
})

describe('quem está no setor', () => {
  it('num pipeline, são os agentes das ETAPAS — mesmo com members vazio', () => {
    const roster = sectorRoster({
      mode: 'pipeline',
      members: [],
      stages: [etapa('s1', 'Coleta', 'a1'), etapa('s2', 'Análise', 'a2', ['s1'])],
    })
    expect(roster.map((r) => r.agentId)).toEqual(['a1', 'a2'])
    expect(roster.map((r) => r.stageName)).toEqual(['Coleta', 'Análise'])
    expect(roster.map((r) => r.order)).toEqual([1, 2])
  })

  it('a etapa diz de quem ela recebe, pelo NOME e não pelo id', () => {
    const roster = sectorRoster({
      mode: 'pipeline',
      members: [],
      stages: [etapa('s1', 'Coleta', 'a1'), etapa('s2', 'Análise', 'a2', ['s1'])],
    })
    expect(roster[1].dependsOnNames).toEqual(['Coleta'])
  })

  it('num setor orquestrado, são os membros — e o coordenador é marcado', () => {
    const roster = sectorRoster({
      mode: 'orchestrated',
      members: [membro('a1', { isDefault: true }), membro('a2')],
      coordinatorAgentId: 'a2',
    })
    expect(roster.map((r) => r.agentId)).toEqual(['a1', 'a2'])
    expect(roster[0].isDefault).toBe(true)
    expect(roster[1].isCoordinator).toBe(true)
  })

  it('um pipeline ANTIGO, salvo só com membros, continua mostrando os membros', () => {
    // Compatibilidade com o que já está gravado: sem etapas, mostrar nada seria
    // repetir o defeito pelo outro lado.
    const roster = sectorRoster({ mode: 'pipeline', members: [membro('a1'), membro('a2')], stages: [] })
    expect(roster.map((r) => r.agentId)).toEqual(['a1', 'a2'])
  })

  it('o modo legado "adaptive" continua lendo membros', () => {
    const roster = sectorRoster({ mode: 'adaptive' as never, members: [membro('a1')] })
    expect(roster).toHaveLength(1)
  })

  it('setor sem ninguém devolve lista vazia, e não quebra', () => {
    expect(sectorRoster({ mode: 'organization', members: [] })).toEqual([])
    expect(sectorRoster({ mode: 'pipeline' })).toEqual([])
  })
})
