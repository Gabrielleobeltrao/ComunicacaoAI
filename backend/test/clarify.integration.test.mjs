// Perguntar, em vez de responder — quando responder seria chutar.
//
// O caso: alguém pede algo amplo, o pesquisador encontra 2000 trechos e o modelo faz a
// única coisa que sabe fazer sem esta ferramenta — escolhe alguns e responde como se
// aquilo bastasse. O dono paga por um contexto enorme e recebe um recorte arbitrário
// apresentado como conclusão.
//
// Duas peças precisam existir para o comportamento mudar: o agente tem que SABER que o
// resultado é amplo, e tem que ter um jeito de pedir recorte que o coordenador entenda
// como pedido, e não como resposta.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { clarifyTool, clarificationFrom, CLARIFY_TOOL_NAME } = await import('../dist/clarify.js')
const { breadthNotice } = await import('../dist/retrievalQuery.js')
const { buildDelegationTools, rootContext } = await import('../dist/delegation.js')

// --- a ferramenta -------------------------------------------------------------------

test('a ferramenta cobre incerteza em geral, e não só busca ampla', () => {
  // O pedido era para NÃO ser uma regra rígida de volume: ambiguidade, termo com dois
  // sentidos e critério que falta mudam a resposta tanto quanto dois mil resultados.
  const d = clarifyTool().description
  assert.match(d, /dois sentidos/i, 'ambiguidade precisa estar dita')
  assert.match(d, /mais de uma coisa/i, 'nome ou identificador ambíguo')
  assert.match(d, /per[íi]odo|recorte/i, 'critério que falta')
  assert.match(d, /contradizem/i, 'pedido incoerente')
  assert.match(d, /ampla demais/i, 'e o caso do volume continua lá')
})

test('a ferramenta diz também quando NÃO perguntar', () => {
  // Sem o contrapeso, um agente que ganha o direito de perguntar pergunta por tudo — e
  // isso é tão ruim quanto chutar.
  const d = clarifyTool().description
  assert.match(d, /NÃO use quando/i)
  assert.match(d, /UMA pergunta/i, 'uma, não um questionário')
  assert.match(d, /ofereça-as|alternativas concretas/i, 'escolher é mais rápido que redigir')
})

test('é leitura: perguntar não muda nada, e por isso vale no Playground', () => {
  const t = clarifyTool()
  assert.equal(t.risk, 'read')
  assert.equal(t.name, 'pedir_esclarecimento')
})

test('devolve a pergunta com o motivo e manda o modelo NÃO responder por cima', async () => {
  const r = await clarifyTool().run({ pergunta: 'Qual período?', motivo: '1.842 resultados', opcoes: ['7 dias', '30 dias'] })
  const corpo = JSON.parse(r.result)
  assert.equal(corpo.status, 'clarification_requested')
  assert.equal(corpo.pergunta, 'Qual período?')
  assert.deepEqual(corpo.opcoes, ['7 dias', '30 dias'])
  // Sem esta instrução o modelo chama a ferramenta e responde assim mesmo — o pior dos
  // dois mundos: paga a chamada e ainda chuta.
  assert.match(corpo.instrucao, /Não tente responder ao pedido original/i)
})

test('pergunta vazia é recusada — não há esclarecimento sem pergunta', async () => {
  const r = await clarifyTool().run({ pergunta: '   ', motivo: 'x' })
  assert.equal(r.ok, false)
})

test('o pedido é lido das chamadas de ferramenta, e a ÚLTIMA vale', () => {
  const pedido = clarificationFrom([
    { name: CLARIFY_TOOL_NAME, ok: true, arguments: { pergunta: 'Primeira?', motivo: 'a' } },
    { name: 'outra_coisa', ok: true, arguments: {} },
    { name: CLARIFY_TOOL_NAME, ok: true, arguments: { pergunta: 'Refinada?', motivo: 'b', opcoes: ['x'] } },
  ])
  assert.equal(pedido.question, 'Refinada?')
  assert.deepEqual(pedido.options, ['x'])
})

test('sem chamada, não há pedido — e uma chamada que falhou não conta', () => {
  assert.equal(clarificationFrom([]), null)
  assert.equal(clarificationFrom(undefined), null)
  assert.equal(clarificationFrom([{ name: CLARIFY_TOOL_NAME, ok: false, arguments: { pergunta: 'x', motivo: 'y' } }]), null)
})

// --- o aviso de amplitude ---------------------------------------------------------------

test('o aviso só existe quando há mais do que coube', () => {
  assert.equal(breadthNotice(6, 6), null, 'seis de seis não é amplo')
  assert.equal(breadthNotice(undefined, 6), null, 'sem saber o total, não se inventa um aviso')
  assert.equal(breadthNotice(0, 0), null)
})

test('o aviso diz o número e o que fazer com ele', () => {
  const aviso = breadthNotice(2000, 6)
  assert.match(aviso, /2000 trechos/)
  assert.match(aviso, /apenas os 6/)
  assert.match(aviso, /peça um recorte/i)
})

// --- o caminho da delegação -----------------------------------------------------------

const agente = (over = {}) => ({
  _id: new ObjectId(),
  ownerId: 'o1',
  officeId: new ObjectId(),
  name: 'A',
  objective: 'obj',
  provider: 'anthropic',
  model: null,
  preset: 'researcher',
  capabilities: [],
  activationModes: ['manual'],
  inputContract: '',
  outputContract: '',
  delegationPolicy: 'all',
  callerPolicy: 'all',
  callableAgentIds: [],
  callableSectorIds: [],
  allowedCallerAgentIds: [],
  ...over,
})

test('o especialista que pede recorte devolve needs_clarification, e não texto', async () => {
  const coordenador = agente({ name: 'Coordenador', preset: 'manager' })
  const pesquisador = agente({ name: 'Pesquisador' })
  const predio = coordenador.officeId.toString()

  const deps = {
    loadAgent: async (_o, id) => [coordenador, pesquisador].find((a) => a._id.toString() === id.toString()) ?? null,
    listAgentsInBuilding: async () => [coordenador, pesquisador],
    buildingIdForFloor: async () => predio,
    resolveTools: async () => [],
    apiKeyFor: async () => 'k',
    // O pesquisador olhou a base, viu que era amplo demais e pediu recorte.
    runTask: async () => ({
      output: 'não deveria ser usado como resposta',
      usage: { inputTokens: 1, outputTokens: 1 },
      toolCalls: [
        { name: CLARIFY_TOOL_NAME, ok: true, arguments: { pergunta: 'De qual período?', motivo: '2000 resultados' }, result: '{}' },
      ],
    }),
    startDelegation: async () => new ObjectId(),
    finishDelegation: async () => undefined,
  }

  const ctx = rootContext({ ownerId: 'o1', buildingId: predio, correlationId: 'c', agent: coordenador })
  const ferramenta = buildDelegationTools(ctx, deps).find((t) => t.name === 'delegate_to_agent')
  const r = await ferramenta.run({ agentId: pesquisador._id.toString(), objective: 'pesquise o mercado' })
  const corpo = JSON.parse(r.result)

  assert.equal(corpo.status, 'needs_clarification', 'devolver como `ok` faria o coordenador consolidar uma pergunta')
  assert.equal(corpo.pergunta, 'De qual período?')
  assert.match(corpo.motivo, /2000/)
  assert.equal(corpo.output, undefined, 'o texto de rascunho do especialista não vaza como resposta')
  assert.match(corpo.instrucao, /NÃO invente a resposta/)
})

test('sem pedido de recorte, a delegação segue devolvendo a resposta normalmente', async () => {
  const coordenador = agente({ name: 'Coordenador', preset: 'manager' })
  const alvo = agente({ name: 'Alvo' })
  const predio = coordenador.officeId.toString()
  const deps = {
    loadAgent: async (_o, id) => [coordenador, alvo].find((a) => a._id.toString() === id.toString()) ?? null,
    listAgentsInBuilding: async () => [coordenador, alvo],
    buildingIdForFloor: async () => predio,
    resolveTools: async () => [],
    apiKeyFor: async () => 'k',
    runTask: async () => ({ output: 'a resposta', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
    startDelegation: async () => new ObjectId(),
    finishDelegation: async () => undefined,
  }
  const ctx = rootContext({ ownerId: 'o1', buildingId: predio, correlationId: 'c', agent: coordenador })
  const ferramenta = buildDelegationTools(ctx, deps).find((t) => t.name === 'delegate_to_agent')
  const corpo = JSON.parse((await ferramenta.run({ agentId: alvo._id.toString(), objective: 'x' })).result)

  assert.equal(corpo.status, 'ok')
  assert.equal(corpo.output, 'a resposta')
})
