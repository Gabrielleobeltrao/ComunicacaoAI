// A execução lida por quem INVESTIGA.
//
// A linha do tempo serve enquanto acontece. Depois, quando algo deu errado, as perguntas
// são outras e sempre as mesmas: quem trabalhou e por quê, de onde vieram os campos, o que
// foi validado, o que saiu como dado e o que saiu como texto, e quanto custou cada tipo de
// executor. Estas provas fixam a leitura — sem ela, a resposta continua sendo "peça o log
// do servidor a alguém".
import { describe, expect, it } from 'vitest'
import { auditarEtapas, auditarPlanos, custoPorTipo } from '../executionTrace'
import type { TraceEvent } from '../executionTrace'

const evento = (over: Partial<TraceEvent> & { metadata?: Record<string, unknown> }): TraceEvent => ({
  executionId: 'e1',
  timestamp: new Date(0).toISOString(),
  type: 'agent',
  title: 'passo',
  ...over,
})

const ETAPA_MODELO = evento({
  status: 'success',
  title: 'Coletor concluiu',
  model: 'claude-x',
  metadata: {
    planId: 'abc123',
    stepId: 't1',
    agentId: 'a1',
    executorKind: 'llm',
    provider: 'anthropic',
    capability: 'cadastro',
    dependsOn: '',
    inputValid: true,
    outputValid: true,
    hasStructured: true,
    hasText: true,
    outputRepaired: true,
    durationMs: 1200,
    usage: { inputTokens: 100, outputTokens: 50 },
  },
})

const ETAPA_FUNCAO = evento({
  status: 'success',
  title: 'Margem concluiu',
  metadata: {
    planId: 'abc123',
    stepId: 't2',
    agentId: 'a2',
    executorKind: 'function',
    functionName: 'calc.margem',
    functionVersion: '2.1.0',
    capability: 'calculo',
    dependsOn: 't1',
    inputOrigins: 'receita<-$steps.t1.receita custo<-$steps.t1.custo',
    inputValid: true,
    outputValid: true,
    hasStructured: true,
    hasText: false,
    durationMs: 3,
  },
})

describe('as etapas, uma linha cada', () => {
  it('lê tipo, referência e versão do que rodou', () => {
    const [modelo, funcao] = auditarEtapas([ETAPA_MODELO, ETAPA_FUNCAO])
    expect(modelo.executorKind).toBe('llm')
    expect(modelo.ran).toBe('claude-x')
    expect(funcao.executorKind).toBe('function')
    // Sem a versão não dá para saber o que rodou: a mesma função muda de comportamento
    // entre versões, e o agente fixa uma justamente por isso.
    expect(funcao.ran).toBe('calc.margem@2.1.0')
  })

  it('uma ação de App aparece como app.ação', () => {
    const [t] = auditarEtapas([
      evento({ status: 'success', metadata: { stepId: 't1', executorKind: 'tool', appKey: 'agenda', actionKey: 'criar_evento' } }),
    ])
    expect(t.ran).toBe('agenda.criar_evento')
  })

  it('entrada e saída são validações SEPARADAS', () => {
    // "Falhou" não diz se o agente recebeu errado ou devolveu errado — dois defeitos, em
    // lugares diferentes, com donos diferentes.
    const [t] = auditarEtapas([evento({ status: 'skipped', metadata: { stepId: 't1', executorKind: 'function', inputValid: false, error: 'invalid_input', field: 'receita' } })])
    expect(t.inputValid).toBe(false)
    expect(t.outputValid).toBeUndefined()
    expect(t.error).toBe('invalid_input')
    expect(t.field).toBe('receita')
  })

  it('dado e texto são contados separadamente', () => {
    const [modelo, funcao] = auditarEtapas([ETAPA_MODELO, ETAPA_FUNCAO])
    expect(modelo.hasStructured && modelo.hasText).toBe(true)
    expect(funcao.hasStructured).toBe(true)
    expect(funcao.hasText).toBe(false)
  })

  it('a correção de formato aparece — ela custou uma inferência', () => {
    const [modelo, funcao] = auditarEtapas([ETAPA_MODELO, ETAPA_FUNCAO])
    expect(modelo.repaired).toBe(true)
    expect(funcao.repaired).toBe(false)
  })

  it('a origem de cada campo é lida da lista achatada', () => {
    const [, funcao] = auditarEtapas([ETAPA_MODELO, ETAPA_FUNCAO])
    expect(funcao.inputOrigins).toEqual(['receita<-$steps.t1.receita', 'custo<-$steps.t1.custo'])
    expect(funcao.dependsOn).toEqual(['t1'])
  })

  it('etapa ainda em execução não vira linha de auditoria', () => {
    // Ela não tem desfecho: uma linha com validação em branco e tempo zero diria que a
    // etapa terminou sem produzir nada, que é outra coisa.
    expect(auditarEtapas([evento({ status: 'running', metadata: { stepId: 't1' } })])).toHaveLength(0)
  })

  it('evento sem stepId não é etapa de plano', () => {
    expect(auditarEtapas([evento({ status: 'success', metadata: { agentId: 'x' } })])).toHaveLength(0)
  })
})

describe('o plano e suas dependências', () => {
  const PLANO = evento({
    type: 'planner',
    status: 'success',
    title: 'Plano da rodada 1',
    metadata: {
      planId: 'abc123',
      round: 1,
      source: 'model',
      selected: [
        { taskId: 't1', name: 'Coletor', executorKind: 'llm', dependsOn: [], inputOrigins: [], onFailure: 'skip', objective: 'levantar' },
        { taskId: 't2', name: 'Margem', executorKind: 'function', dependsOn: ['t1'], inputOrigins: ['receita<-$steps.t1.receita'], onFailure: 'stop', objective: 'calcular' },
      ],
    },
  })

  it('traz a ordem, as origens e a política de falha', () => {
    const [plano] = auditarPlanos([PLANO])
    expect(plano.planId).toBe('abc123')
    expect(plano.steps[1].dependsOn).toEqual(['t1'])
    expect(plano.steps[1].onFailure).toBe('stop')
    expect(plano.steps[1].inputOrigins).toEqual(['receita<-$steps.t1.receita'])
  })

  it('duas rodadas são dois planos — e não um plano com o dobro de etapas', () => {
    const segunda = { ...PLANO, metadata: { ...PLANO.metadata, planId: 'def456', round: 2 } }
    expect(auditarPlanos([PLANO, segunda])).toHaveLength(2)
  })
})

describe('o custo por tipo de executor', () => {
  it('separa o que custou token do que não custou', () => {
    // É a comparação que justifica a arquitetura, e ela não existia: sem separar, uma
    // função determinística e uma inferência aparecem como "duas etapas".
    const custos = custoPorTipo([ETAPA_MODELO, ETAPA_FUNCAO])
    const modelo = custos.find((c) => c.executorKind === 'llm')!
    const funcao = custos.find((c) => c.executorKind === 'function')!
    expect(modelo.tokens).toBe(150)
    expect(funcao.tokens).toBe(0)
    expect(funcao.durationMs).toBe(3)
    expect(modelo.durationMs).toBe(1200)
  })

  it('soma as etapas do mesmo tipo', () => {
    const outra = { ...ETAPA_FUNCAO, metadata: { ...ETAPA_FUNCAO.metadata, stepId: 't3', durationMs: 5 } }
    const [, funcao] = custoPorTipo([ETAPA_MODELO, ETAPA_FUNCAO, outra])
    expect(funcao.etapas).toBe(2)
    expect(funcao.durationMs).toBe(8)
  })

  it('uma execução só de modelo não produz comparação de nada', () => {
    expect(custoPorTipo([ETAPA_MODELO])).toHaveLength(1)
  })
})
