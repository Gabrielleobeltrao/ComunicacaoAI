// O rascunho desenhado como escritório.
//
// A conversão é a única coisa entre "a proposta mudou" e "o desenho mudou junto". Ela é
// pura para poder ser exercitada aqui, sem navegador — e porque um erro dela aparece
// como um andar vazio, que é exatamente o tipo de defeito que ninguém reporta.
import { describe, expect, it } from 'vitest'
import { blueprintToOfficePreview, describeFloor, isPreviewId, previewId } from '../blueprintPreview'
import type { Blueprint } from '../../../lib/architect'

const bp = (over: Partial<Blueprint> = {}): Blueprint =>
  ({
    title: 'Op',
    objective: 'obj',
    floors: [{ key: 'atendimento', name: 'Atendimento', workMode: 'organization' }],
    agents: [
      { key: 'marina', name: 'Marina', floorKey: 'atendimento', preset: 'manager' },
      { key: 'rafael', name: 'Rafael', floorKey: 'atendimento', preset: 'researcher' },
      { key: 'tereza', name: 'Tereza', floorKey: 'atendimento', preset: 'operator' },
    ],
    sectors: [
      { key: 'mesa', name: 'Mesa', mode: 'orchestrated', floorKey: 'atendimento', memberAgentKeys: ['marina', 'rafael'], coordinatorAgentKey: 'marina' },
    ],
    routines: [],
    appRequirements: [],
    knowledgeRequirements: [],
    assumptions: [],
    warnings: [],
    ...over,
  }) as Blueprint

describe('blueprint como escritório', () => {
  it('leva agentes, setores, membros e coordenador para o mapa', () => {
    const p = blueprintToOfficePreview(bp())
    expect(p.totals).toEqual({ floors: 1, agents: 3, sectors: 1 })

    const andar = p.floors[0]
    expect(andar.name).toBe('Atendimento')
    expect(andar.agents.map((a) => a.name)).toEqual(['Marina', 'Rafael', 'Tereza'])

    const setor = andar.sectors[0]
    expect(setor.name).toBe('Mesa')
    expect(setor.members?.map((m) => m.agentId)).toEqual([previewId('agent', 'marina'), previewId('agent', 'rafael')])
    expect(setor.coordinatorAgentId).toBe(previewId('agent', 'marina'))
  })

  it('quem não está em setor nenhum vai para a área comum', () => {
    // No mapa, "área comum" é onde ficam os que não têm sala. Um agente fora de setor é
    // acionado à mão, e isso precisa ser visível no desenho.
    const andar = blueprintToOfficePreview(bp()).floors[0]
    expect(andar.looseAgents.map((a) => a.name)).toEqual(['Tereza'])
  })

  it('todo id é temporário, e dá para reconhecer que é', () => {
    const p = blueprintToOfficePreview(bp())
    const ids = [...p.floors.map((f) => f.id), ...p.floors[0].agents.map((a) => a._id), ...p.floors[0].sectors.map((s) => s._id)]
    for (const id of ids) expect(isPreviewId(id)).toBe(true)
    // Um id de banco NÃO é confundido com rascunho — é o que impede a tela de tratar
    // recurso real como simulação, e vice-versa.
    expect(isPreviewId('507f1f77bcf86cd799439011')).toBe(false)
  })

  it('vários andares viram vários andares, cada um com a sua gente', () => {
    const p = blueprintToOfficePreview(
      bp({
        floors: [
          { key: 'atendimento', name: 'Atendimento', workMode: 'organization' },
          { key: 'mesa-analise', name: 'Mesa de Análise', workMode: 'organization' },
        ],
        agents: [
          { key: 'marina', name: 'Marina', floorKey: 'atendimento' },
          { key: 'bruno', name: 'Bruno', floorKey: 'mesa-analise' },
        ],
        sectors: [],
      } as Partial<Blueprint>),
    )
    expect(p.totals.floors).toBe(2)
    expect(p.floors[0].agents.map((a) => a.name)).toEqual(['Marina'])
    expect(p.floors[1].agents.map((a) => a.name)).toEqual(['Bruno'])
  })

  it('agente com andar inexistente não some do desenho', () => {
    // No rascunho, um agente invisível é pior que um no lugar errado: o segundo se
    // corrige com um clique; o primeiro ninguém percebe que faltou.
    const p = blueprintToOfficePreview(bp({ agents: [{ key: 'x', name: 'Xuxa', floorKey: 'andar-que-nao-existe' }] } as Partial<Blueprint>))
    expect(p.floors[0].agents.map((a) => a.name)).toEqual(['Xuxa'])
  })

  it('membro que não está na proposta não vira cadeira ocupada por ninguém', () => {
    const p = blueprintToOfficePreview(
      bp({ sectors: [{ key: 'mesa', name: 'Mesa', mode: 'orchestrated', floorKey: 'atendimento', memberAgentKeys: ['marina', 'fantasma'] }] } as Partial<Blueprint>),
    )
    expect(p.floors[0].sectors[0].members?.map((m) => m.agentId)).toEqual([previewId('agent', 'marina')])
  })

  it('sem proposta, não há escritório — e não quebra', () => {
    expect(blueprintToOfficePreview(null).totals).toEqual({ floors: 0, agents: 0, sectors: 0 })
    expect(blueprintToOfficePreview(undefined).floors).toEqual([])
  })

  it('a descrição em texto conta o que o mapa mostra', () => {
    const andar = blueprintToOfficePreview(bp()).floors[0]
    const texto = describeFloor(andar)
    expect(texto).toContain('Atendimento')
    expect(texto).toContain('3 agentes')
    // Os NOMES, e não só a contagem: quem lê a frase em vez de ver o mapa precisa da
    // mesma informação que o mapa dá.
    expect(texto).toContain('Mesa (Marina, Rafael)')
    expect(texto).toContain('Tereza')
    expect(describeFloor(undefined)).toMatch(/Nenhum andar/)
  })
})
