// O contrato que o dono escreve à mão — e as três formas de errar nele.
//
// Vírgula sobrando e chave errada o parser pega sozinho. A terceira é a que importa: um
// schema sintaticamente perfeito que descreve OUTRA COISA. Ele salva sem reclamar, e o
// defeito só aparece em produção, quando o agente recusa entradas boas ou aceita as
// erradas. É por isso que existe validação por caminho e um resumo em português: ler
// "cnpj, texto, obrigatório" é o que denuncia o schema certo com o contrato errado.
import { describe, expect, it } from 'vitest'
import { checkSchema, describeSchema } from '../JsonSchemaEditor'
import { executorProblems } from '../AgentExecutorSection'
import type { ExecutorDraft } from '../AgentExecutorSection'

const draft = (over: Partial<ExecutorDraft> = {}): ExecutorDraft => ({
  kind: 'llm',
  functionName: '',
  functionVersion: '',
  appKey: '',
  actionKey: '',
  responseMode: 'text',
  config: {},
  expression: '',
  ...over,
})

describe('o contrato, conferido enquanto se escreve', () => {
  it('vazio não é erro: um agente sem contrato é o comportamento de sempre', () => {
    expect(checkSchema('').problems).toEqual([])
    expect(checkSchema('   ').parsed).toBeNull()
  })

  it('JSON quebrado aponta o problema em vez de "inválido"', () => {
    const { problems, parsed } = checkSchema('{ "type": "object", }')
    expect(problems).toHaveLength(1)
    expect(parsed).toBeNull()
  })

  it('a raiz precisa ser object — é o que o validador do servidor exige', () => {
    const { problems } = checkSchema('{"type":"array"}')
    expect(problems.some((p) => p.path === 'type')).toBe(true)
  })

  it('o campo sem tipo é apontado PELO NOME', () => {
    const { problems } = checkSchema('{"type":"object","properties":{"cnpj":{}}}')
    expect(problems[0].path).toBe('properties.cnpj')
  })

  it('um tipo que o servidor não conhece não passa daqui', () => {
    const { problems } = checkSchema('{"type":"object","properties":{"x":{"type":"date"}}}')
    expect(problems[0].path).toBe('properties.x.type')
  })

  it('exigir um campo que não existe é o erro que nenhum parser pega', () => {
    // O schema é JSON válido, tem raiz object, tem properties. E NENHUMA entrada o
    // satisfaz — o agente recusaria tudo, para sempre, sem ninguém entender por quê.
    const { problems } = checkSchema('{"type":"object","properties":{"a":{"type":"string"}},"required":["b"]}')
    expect(problems.some((p) => p.path === 'required.b')).toBe(true)
  })

  it('um contrato correto passa e volta lido', () => {
    const { problems, parsed } = checkSchema('{"type":"object","properties":{"cnpj":{"type":"string"}},"required":["cnpj"]}')
    expect(problems).toEqual([])
    expect(parsed).not.toBeNull()
  })
})

describe('o contrato em português', () => {
  it('diz campo, tipo e se é obrigatório', () => {
    const { parsed } = checkSchema('{"type":"object","properties":{"cnpj":{"type":"string"},"valor":{"type":"number"}},"required":["cnpj"]}')
    expect(describeSchema(parsed)).toEqual([
      { campo: 'cnpj', tipo: 'string', obrigatorio: true },
      { campo: 'valor', tipo: 'number', obrigatorio: false },
    ])
  })

  it('sem properties não há o que descrever', () => {
    expect(describeSchema({ type: 'object' })).toEqual([])
    expect(describeSchema(null)).toEqual([])
  })
})

describe('o que impede de salvar', () => {
  it('agente de modelo não exige escolha nenhuma — é o padrão de sempre', () => {
    expect(executorProblems(draft())).toEqual([])
  })

  it('função sem função escolhida não salva', () => {
    // Salvar isto criaria um agente que falha na primeira execução, longe do formulário,
    // com uma mensagem que não fala do formulário.
    expect(executorProblems(draft({ kind: 'function' }))).toHaveLength(1)
    expect(executorProblems(draft({ kind: 'function', functionName: 'math.summary' }))).toEqual([])
  })

  it('ferramenta exige o App E a ação — um dos dois não basta', () => {
    expect(executorProblems(draft({ kind: 'tool' }))).toHaveLength(1)
    expect(executorProblems(draft({ kind: 'tool', appKey: 'agenda' }))).toHaveLength(1)
    expect(executorProblems(draft({ kind: 'tool', appKey: 'agenda', actionKey: 'criar' }))).toEqual([])
  })
})
