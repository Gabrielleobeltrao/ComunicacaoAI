// O worker de rotinas executando um agente que NÃO é de modelo.
//
// Este caminho é o de `executeRoutineStep`, o mesmo que o runner chama em produção — não
// `runAgentTask`. Ele preparava a inferência inteira antes de qualquer coisa: busca na
// base, resolução do modelo, chave de API, montagem das ferramentas. Para um agente de
// função, tudo isso era conta que não devia existir — e no fim o modelo IMPROVISAVA o que
// a função faria, entregando à rotina uma resposta plausível, em prosa, que nunca tocou o
// código configurado.
//
// As dependências são dubladas onde precisam ser observadas (base, chave, modelo,
// contabilidade), e o executor é o de verdade: o registry roda a função.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
delete process.env.VOYAGE_API_KEY

const { executeRoutineStep } = await import('../dist/automations/routineExecution.js')
const { registerFunction, __resetRegistry } = await import('../dist/executors/functionRegistry.js')
const { mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'owner-rotina'
const PREDIO = new ObjectId()
const ANDAR = new ObjectId()

before(() => {
  registerFunction({
    functionName: 'rotina.soma',
    version: '1.2.0',
    description: 'soma de uma lista',
    capabilities: ['calculo'],
    inputSchema: { type: 'object', properties: { values: { type: 'array', items: { type: 'number' } } }, required: ['values'] },
    outputSchema: { type: 'object', properties: { total: { type: 'number' } }, required: ['total'] },
    handler: ({ values }) => ({ total: values.reduce((a, b) => a + b, 0) }),
    timeoutMs: 2_000,
  })
  registerFunction({
    functionName: 'rotina.quebrada',
    version: '1.0.0',
    description: 'devolve fora do contrato',
    capabilities: [],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    handler: () => ({ n: 'não é número' }),
    timeoutMs: 1_000,
  })
})
after(() => __resetRegistry())

const agente = (over = {}) => ({
  _id: new ObjectId(),
  ownerId: OWNER,
  officeId: ANDAR,
  name: 'Somador',
  objective: 'somar',
  provider: 'anthropic',
  model: null,
  preset: 'custom',
  capabilities: [],
  activationModes: ['manual'],
  inputContract: '',
  outputContract: '',
  delegationPolicy: 'none',
  callerPolicy: 'all',
  toolIds: [],
  appGrants: [],
  ...over,
})

const DE_FUNCAO = (over = {}) =>
  agente({
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'rotina.soma', version: '1.2.0' },
    responseMode: 'structured',
    inputJsonSchema: { type: 'object', properties: { values: { type: 'array', items: { type: 'number' } } }, required: ['values'] },
    outputJsonSchema: { type: 'object', properties: { total: { type: 'number' } }, required: ['total'] },
    ...over,
  })

function deps(alvo, over = {}) {
  const visto = { base: 0, chave: 0, ferramentas: 0, modelo: 0, cobrancas: [], eventos: [] }
  return {
    visto,
    deps: {
      loadAgent: async () => alvo,
      resolveOwnedSectorId: async () => new ObjectId(),
      retrieveContext: async () => {
        visto.base += 1
        return { context: ['trecho'], failed: false, status: 'ok', sources: [] }
      },
      resolveTools: async () => {
        visto.ferramentas += 1
        return []
      },
      apiKeyFor: async () => {
        visto.chave += 1
        return 'chave'
      },
      runTask: async () => {
        visto.modelo += 1
        return { output: 'o modelo improvisaria isto', usage: { inputTokens: 80, outputTokens: 40 }, toolCalls: [] }
      },
      charge: async (_o, usage, chave) => {
        visto.cobrancas.push({ usage, chave })
        return true
      },
      chargeKeyFor: (runId, stepId, agentId, attempt) => `${runId}:${stepId}:${agentId}:${attempt}`,
      finalizeEvent: async (e) => {
        visto.eventos.push(e)
      },
      eventKeyFor: (runId, stepId, agentId) => `run:${runId}:${stepId}:${agentId}`,
      sleep: async () => {},
      ...over,
    },
  }
}

const chamada = (over = {}) => ({
  agentId: new ObjectId().toString(),
  objective: 'somar os valores',
  instructions: '',
  input: { values: [5, 10, 15] },
  context: [],
  format: 'text',
  stepId: 's1',
  attempt: 1,
  ...over,
})

const ctx = () => ({ ownerId: OWNER, runId: new ObjectId().toString(), buildingId: PREDIO, floorId: ANDAR })

// --- o caminho de função ------------------------------------------------------------------

test('a rotina executa a FUNÇÃO — e não prepara nada de inferência', async () => {
  const f = deps(DE_FUNCAO())
  const r = await executeRoutineStep(chamada(), ctx(), f.deps)
  await r.settle

  assert.deepEqual(JSON.parse(r.output), { total: 30 })
  assert.equal(f.visto.modelo, 0, 'o provedor não pode ser chamado')
  // O resto é a preparação de uma inferência: para uma função, é conta que não devia
  // existir. Buscar na base custa embedding; carregar a chave é acesso a segredo.
  assert.equal(f.visto.base, 0, 'buscar conhecimento para uma função é gasto sem uso')
  assert.equal(f.visto.chave, 0, 'nenhuma credencial é carregada por este caminho')
  assert.equal(f.visto.ferramentas, 0)
})

test('a conta é ZERO, e a contabilidade continua acontecendo', async () => {
  const f = deps(DE_FUNCAO())
  const r = await executeRoutineStep(chamada(), ctx(), f.deps)
  assert.equal(await r.settle, true)

  assert.deepEqual(r.usage, { inputTokens: 0, outputTokens: 0 })
  // A cobrança é CHAMADA — com uso zero. A idempotência por tentativa é dela, e pular a
  // chamada deixaria a rotina de função fora do registro que todo o resto usa.
  assert.equal(f.visto.cobrancas.length, 1)
  assert.deepEqual(f.visto.cobrancas[0].usage, { inputTokens: 0, outputTokens: 0 })
  assert.match(f.visto.cobrancas[0].chave, /:s1:.*:1$/, 'a chave carrega a tentativa')
})

test('a telemetria registra o tipo de executor, a função e a versão', async () => {
  const f = deps(DE_FUNCAO())
  const r = await executeRoutineStep(chamada(), ctx(), f.deps)
  await r.settle

  const sucesso = f.visto.eventos.find((e) => e.status === 'succeeded')
  assert.ok(sucesso)
  assert.equal(sucesso.metadata.executorKind, 'function')
  assert.equal(sucesso.metadata.functionName, 'rotina.soma')
  assert.equal(sucesso.metadata.functionVersion, '1.2.0')
  assert.equal(sucesso.metadata.outputValid, true)
  assert.equal(sucesso.metadata.hasStructured, true)
  assert.equal(sucesso.inputTokens, 0)
  assert.equal(sucesso.outputTokens, 0)
  assert.equal(sucesso.model, null, 'nenhum modelo rodou')
  assert.equal(typeof sucesso.metadata.durationMs, 'number')
})

test('entrada fora do contrato não executa a função — e não chama o modelo', async () => {
  const f = deps(DE_FUNCAO())
  await assert.rejects(() => executeRoutineStep(chamada({ input: { values: 'doze e quinze' } }), ctx(), f.deps), /contrato/i)
  assert.equal(f.visto.modelo, 0)
  const falha = f.visto.eventos.find((e) => e.status === 'failed')
  assert.ok(falha, 'a tentativa falha precisa ficar registrada')
  assert.equal(falha.metadata.outputValid, false)
  assert.equal(falha.metadata.executorKind, 'function')
})

test('saída fora do contrato falha SEM pedir correção a um modelo', async () => {
  const quebrado = DE_FUNCAO({
    executorConfig: { kind: 'function', functionName: 'rotina.quebrada' },
    inputJsonSchema: { type: 'object', properties: {} },
    outputJsonSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
  })
  const f = deps(quebrado)
  await assert.rejects(() => executeRoutineStep(chamada({ input: {} }), ctx(), f.deps))
  // Uma função que devolve fora do formato tem defeito no código: pedir ao modelo que
  // conserte esconderia o defeito e cobraria por isso.
  assert.equal(f.visto.modelo, 0)
})

test('a falha por contrato NÃO é repetível — repetir daria no mesmo', async () => {
  const f = deps(DE_FUNCAO())
  const erro = await executeRoutineStep(chamada({ input: {} }), ctx(), f.deps).catch((e) => e)
  assert.equal(erro.retryable, false)
})

// --- o caminho de modelo continua igual ----------------------------------------------------

test('um agente ANTIGO continua passando por base, chave, ferramentas e modelo', async () => {
  const f = deps(agente())
  const r = await executeRoutineStep(chamada({ input: 'texto qualquer' }), ctx(), f.deps)
  await r.settle

  assert.equal(f.visto.modelo, 1)
  assert.equal(f.visto.base, 1, 'a rotina de um agente de IA continua consultando a base')
  assert.equal(f.visto.chave, 1)
  assert.equal(f.visto.ferramentas, 1)
  assert.equal(r.usage.inputTokens, 80)
  const sucesso = f.visto.eventos.find((e) => e.status === 'succeeded')
  assert.equal(sucesso.metadata.executorKind, undefined, 'nada de novo aparece num agente que não declara nada')
  assert.equal(sucesso.metadata.grounding, 'ok')
})

test('o agente antigo com `requireGrounding` continua se recusando sem base', async () => {
  const f = deps(agente({ requireGrounding: true }), {
    retrieveContext: async () => ({ context: [], failed: true, status: 'unavailable', sources: [] }),
  })
  await assert.rejects(() => executeRoutineStep(chamada({ input: 'x' }), ctx(), f.deps), /base de conhecimento/)
  assert.equal(f.visto.modelo, 0)
})
