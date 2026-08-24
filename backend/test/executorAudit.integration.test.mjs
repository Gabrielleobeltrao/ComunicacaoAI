// A AUDITORIA de um fluxo misto — e o que ela nunca pode carregar.
//
// Depois de cinco fases, uma execução de setor pode misturar modelo, função determinística
// e ação de App na mesma resposta. Sem registro disso, três perguntas ficam sem resposta e
// as três aparecem quando algo dá errado em produção: por que ESTE agente, com que
// contrato, e a que custo. O log do servidor respondia — para quem tem acesso ao servidor.
//
// Este arquivo prova as duas metades do mesmo requisito: a ficha da etapa está lá, com
// plano, passo, tipo de executor, referência, versão, hashes e validações; e ela NÃO
// carrega credencial, cabeçalho nem payload sem limite.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
delete process.env.VOYAGE_API_KEY

const { executeSectorTeam, sectorRunContext } = await import('../dist/delegation.js')
const { registerFunction, __resetRegistry } = await import('../dist/executors/functionRegistry.js')
const { clearTrace, readTrace, traceEvent, sanitize } = await import('../dist/executionTrace.js')
const { planIdOf } = await import('../dist/sectorPlanner.js')
const { mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'owner-auditoria'
const PREDIO = new ObjectId()
const ANDAR = new ObjectId()

const agente = (nome, over = {}) => ({
  _id: new ObjectId(),
  ownerId: OWNER,
  officeId: ANDAR,
  name: nome,
  objective: `objetivo de ${nome}`,
  provider: 'anthropic',
  model: null,
  preset: 'researcher',
  capabilities: [],
  activationModes: ['manual'],
  inputContract: '',
  outputContract: '',
  delegationPolicy: 'none',
  callerPolicy: 'all',
  callableAgentIds: [],
  callableSectorIds: [],
  allowedCallerAgentIds: [],
  toolIds: [],
  appGrants: [],
  ...over,
})

function deps(agentes, over = {}) {
  const porId = new Map(agentes.map((a) => [a._id.toString(), a]))
  const chamadas = []
  return {
    chamadas,
    deps: {
      loadAgent: async (ownerId, id) => {
        const a = porId.get(id.toString())
        return a && a.ownerId === ownerId ? a : null
      },
      loadSector: async () => over.sector ?? null,
      listAgentsInBuilding: async () => agentes,
      buildingIdForFloor: async () => PREDIO.toString(),
      resolveTools: async () => [],
      apiKeyFor: async () => 'k',
      runTask: async (req) => {
        chamadas.push(req)
        return over.runTask ? over.runTask(req) : { output: 'ok', usage: { inputTokens: 3, outputTokens: 7 }, toolCalls: [] }
      },
      startDelegation: async () => new ObjectId(),
      finishDelegation: async () => undefined,
      recordEvent: () => undefined,
      planWithModel: over.planWithModel,
    },
  }
}

const TRACE = 'auditoria-1'
const ctx = () => sectorRunContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'audit', traceId: TRACE })

before(() => {
  registerFunction({
    functionName: 'auditoria.margem',
    version: '2.1.0',
    description: 'margem sobre receita e custo',
    capabilities: ['calculo', 'margem'],
    inputSchema: { type: 'object', properties: { receita: { type: 'number' }, custo: { type: 'number' } }, required: ['receita', 'custo'] },
    outputSchema: { type: 'object', properties: { margem: { type: 'number' } }, required: ['margem'] },
    handler: ({ receita, custo }) => ({ margem: Number((((receita - custo) / receita) * 100).toFixed(2)) }),
    timeoutMs: 2_000,
  })
})
after(() => __resetRegistry())

const eventos = () => readTrace(TRACE, OWNER)
const doTipo = (tipo, status) => eventos().filter((e) => e.type === tipo && (!status || e.status === status))

const COLETOR = (over = {}) =>
  agente('Coletor', {
    preset: 'researcher',
    capabilities: ['cadastro', 'financeiro'],
    outputJsonSchema: { type: 'object', properties: { receita: { type: 'number' }, custo: { type: 'number' } }, required: ['receita', 'custo'] },
    defaultOutputFormat: 'json',
    responseMode: 'structured_and_text',
    ...over,
  })

const CALCULADORA = (over = {}) =>
  agente('Margem', {
    preset: 'custom',
    capabilities: ['calculo', 'margem'],
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'auditoria.margem', version: '2.1.0' },
    inputJsonSchema: { type: 'object', properties: { receita: { type: 'number' }, custo: { type: 'number' } }, required: ['receita', 'custo'] },
    outputJsonSchema: { type: 'object', properties: { margem: { type: 'number' } }, required: ['margem'] },
    responseMode: 'structured',
    ...over,
  })

const setorCom = (chefe, membros) => ({
  _id: new ObjectId(),
  name: 'Mesa',
  officeId: ANDAR,
  mode: 'orchestrated',
  coordinatorAgentId: chefe._id,
  instruction: '',
  members: [{ agentId: chefe._id, isDefault: true }, ...membros.map((m) => ({ agentId: m._id }))],
  stages: [],
})

async function fluxoMisto(over = {}) {
  clearTrace(TRACE)
  const chefe = agente('Chefe', { preset: 'manager' })
  const a = COLETOR()
  const b = CALCULADORA()
  const setor = setorCom(chefe, [a, b])
  const f = deps([chefe, a, b], {
    sector: setor,
    planWithModel: async () =>
      JSON.stringify({
        tasks: [
          { id: 'c', agentId: a._id.toString(), objective: 'levantar receita e custo' },
          {
            id: 'm',
            agentId: b._id.toString(),
            objective: 'calcular a margem',
            dependsOn: ['c'],
            inputBindings: { receita: '$steps.c.receita', custo: '$steps.c.custo' },
            onFailure: 'stop',
          },
        ],
      }),
    runTask: async (req) => {
      if (req.output?.format === 'json') {
        return {
          output: '{"receita":200000,"custo":140000}',
          json: { receita: 200000, custo: 140000 },
          usage: { inputTokens: 11, outputTokens: 13 },
          toolCalls: [],
          format: { requested: 'json', valid: true, repaired: false },
        }
      }
      return { output: 'consolidado', usage: { inputTokens: 5, outputTokens: 5 }, toolCalls: [] }
    },
    ...over,
  })
  const run = await executeSectorTeam(f.deps, ctx(), setor, { objective: 'qual a margem de calculo desta empresa?' })
  return { run, f, agentes: { chefe, a, b } }
}

// --- a ficha de cada etapa -------------------------------------------------------------------

test('cada etapa registra plano, passo, agente e tipo de executor', async () => {
  const { agentes } = await fluxoMisto()
  const concluidas = doTipo('agent', 'success')
  assert.ok(concluidas.length >= 2, 'as duas etapas precisam aparecer')

  const daFuncao = concluidas.find((e) => e.metadata.executorKind === 'function')
  assert.ok(daFuncao, 'a etapa de função precisa se declarar como função')
  assert.equal(daFuncao.metadata.stepId, 't2')
  assert.equal(daFuncao.metadata.agentId, agentes.b._id.toString())
  assert.match(String(daFuncao.metadata.planId), /^[0-9a-f]{16}$/, 'o plano tem identidade, e ela é derivada do conteúdo')

  const doModelo = concluidas.find((e) => e.metadata.executorKind === 'llm')
  assert.ok(doModelo, 'a etapa de modelo se declara como modelo')
  assert.equal(doModelo.metadata.planId, daFuncao.metadata.planId, 'as duas etapas pertencem ao MESMO plano')
})

test('a função registra nome e VERSÃO — sem versão não há como saber o que rodou', async () => {
  await fluxoMisto()
  const daFuncao = doTipo('agent', 'success').find((e) => e.metadata.executorKind === 'function')
  assert.equal(daFuncao.metadata.functionName, 'auditoria.margem')
  assert.equal(daFuncao.metadata.functionVersion, '2.1.0')
})

test('a etapa de modelo registra provedor e modelo; a de função, não', async () => {
  await fluxoMisto()
  const concluidas = doTipo('agent', 'success')
  const doModelo = concluidas.find((e) => e.metadata.executorKind === 'llm')
  const daFuncao = concluidas.find((e) => e.metadata.executorKind === 'function')
  assert.equal(doModelo.metadata.provider, 'anthropic')
  // Registrar um provedor numa função determinística não é só irrelevante: é falso —
  // nenhum provedor foi chamado, e o campo mandaria procurar uma conta que não existe.
  assert.equal(daFuncao.metadata.provider, undefined)
})

test('a capacidade que casou fica registrada — é o "por que este agente"', async () => {
  await fluxoMisto()
  const daFuncao = doTipo('agent', 'success').find((e) => e.metadata.executorKind === 'function')
  assert.match(String(daFuncao.metadata.capability), /calculo|margem/)
})

test('os contratos aparecem como HASH — nunca o corpo do schema', async () => {
  await fluxoMisto()
  const daFuncao = doTipo('agent', 'success').find((e) => e.metadata.executorKind === 'function')
  assert.match(String(daFuncao.metadata.inputSchemaHash), /^[0-9a-f]{16}$/)
  assert.match(String(daFuncao.metadata.outputSchemaHash), /^[0-9a-f]{16}$/)
  // O hash responde "mudou?" sem guardar o quê. O corpo é grande, muda por formatação e
  // encheria a trilha sem responder nada que o hash não responda.
  const bruto = JSON.stringify(daFuncao.metadata)
  assert.ok(!bruto.includes('properties'), 'o corpo do schema não entra na trilha')
})

test('a origem de cada campo fica registrada — as origens, nunca os valores', async () => {
  await fluxoMisto()
  const daFuncao = doTipo('agent', 'success').find((e) => e.metadata.executorKind === 'function')
  assert.match(String(daFuncao.metadata.inputOrigins), /receita<-\$steps\.t1\.receita/)
  assert.ok(!String(daFuncao.metadata.inputOrigins).includes('200000'), 'o valor do campo é conteúdo, não auditoria')
  assert.equal(daFuncao.metadata.dependsOn, 't1')
})

test('validação de entrada e de saída, e o que saiu de cada uma', async () => {
  await fluxoMisto()
  const daFuncao = doTipo('agent', 'success').find((e) => e.metadata.executorKind === 'function')
  assert.equal(daFuncao.metadata.inputValid, true)
  assert.equal(daFuncao.metadata.outputValid, true)
  // Dado e texto contados separadamente: `structured` entrega dado e nada de texto.
  assert.equal(daFuncao.metadata.hasStructured, true)
  assert.equal(daFuncao.metadata.hasText, false)
  assert.equal(typeof daFuncao.metadata.durationMs, 'number')
})

test('a recusa de entrada registra o CAMPO e o código — e não executa', async () => {
  clearTrace(TRACE)
  const chefe = agente('Chefe', { preset: 'manager' })
  const a = COLETOR({ outputJsonSchema: { type: 'object', properties: { receita: { type: 'string' }, custo: { type: 'number' } } } })
  const b = CALCULADORA()
  const setor = setorCom(chefe, [a, b])
  const f = deps([chefe, a, b], {
    sector: setor,
    planWithModel: async () =>
      JSON.stringify({
        tasks: [
          { id: 'c', agentId: a._id.toString(), objective: 'levantar' },
          { id: 'm', agentId: b._id.toString(), objective: 'calcular', dependsOn: ['c'], inputBindings: { receita: '$steps.c.receita', custo: '$steps.c.custo' } },
        ],
      }),
    runTask: async (req) =>
      req.output?.format === 'json'
        ? { output: '{"receita":"duzentos mil","custo":140000}', json: { receita: 'duzentos mil', custo: 140000 }, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [], format: { requested: 'json', valid: true, repaired: false } }
        : { output: 'consolidado', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] },
  })
  await executeSectorTeam(f.deps, ctx(), setor, { objective: 'margem' })

  const pulada = doTipo('agent', 'skipped').find((e) => e.metadata?.executorKind === 'function')
  assert.ok(pulada, 'a etapa recusada precisa aparecer na trilha')
  assert.equal(pulada.metadata.inputValid, false)
  assert.equal(pulada.metadata.field, 'receita')
  assert.equal(pulada.metadata.error, 'invalid_input')
  // O valor que causou a recusa é conteúdo do cliente. Ele não entra.
  assert.ok(!JSON.stringify(pulada.metadata).includes('duzentos mil'))
})

test('o plano registrado traz dependências, origens e política de falha', async () => {
  await fluxoMisto()
  const plano = doTipo('planner')[0]
  assert.ok(plano, 'o plano precisa aparecer na trilha')
  assert.match(String(plano.metadata.planId), /^[0-9a-f]{16}$/)
  const etapa = plano.metadata.selected.find((t) => t.taskId === 't2')
  assert.deepEqual(etapa.dependsOn, ['t1'])
  assert.equal(etapa.executorKind, 'function')
  assert.equal(etapa.onFailure, 'stop')
  // Achatadas em texto: a sanitização da trilha para na quarta profundidade, e um objeto
  // aqui sairia como "[…]" — o limite está certo, a forma do dado é que tinha que ceder.
  assert.deepEqual([...etapa.inputOrigins].sort(), ['custo<-$steps.t1.custo', 'receita<-$steps.t1.receita'])
})

test('o custo aparece por etapa — e é ele que permite comparar os tipos', async () => {
  await fluxoMisto()
  const concluidas = doTipo('agent', 'success')
  const doModelo = concluidas.find((e) => e.metadata.executorKind === 'llm')
  const daFuncao = concluidas.find((e) => e.metadata.executorKind === 'function')
  assert.equal(doModelo.metadata.usage.inputTokens, 11)
  assert.equal(doModelo.metadata.usage.outputTokens, 13)
  // A função não consome token nenhum: é a comparação inteira, num número só.
  assert.ok(!daFuncao.metadata.usage || (daFuncao.metadata.usage.inputTokens ?? 0) === 0)
})

// --- o que a auditoria NUNCA carrega ------------------------------------------------------------

test('nome de campo que soa a credencial não chega ao painel', () => {
  clearTrace('higiene')
  traceEvent({
    ownerId: OWNER,
    executionId: 'higiene',
    type: 'tool',
    title: 'chamada',
    metadata: {
      Authorization: 'Bearer abc123',
      apiKey: 'k',
      refreshToken: 'r',
      x_api_token: 't',
      githubAccessToken: 'g',
      'set-cookie': 'a=b',
      clientSecret: 's',
      privateKey: 'p',
      // O que PODE aparecer: o que aconteceu.
      status: 200,
      durationMs: 12,
    },
  })
  const m = readTrace('higiene', OWNER)[0].metadata
  for (const proibida of ['Authorization', 'apiKey', 'refreshToken', 'x_api_token', 'githubAccessToken', 'set-cookie', 'clientSecret', 'privateKey']) {
    assert.ok(!(proibida in m), `${proibida} não pode chegar ao painel`)
  }
  assert.equal(m.status, 200)
  assert.equal(m.durationMs, 12)
})

test('a CONTA de tokens sobrevive à regra que remove "token"', () => {
  // A regra casa por contenção, senão `refreshToken` passaria. `inputTokens` também contém
  // "token" e é justamente o número que o dono precisa ver: uma proteção que apaga a conta
  // não protege nada, só cega quem paga.
  const limpo = sanitize({ inputTokens: 10, outputTokens: 20, totalTokens: 30, tokensSpent: 5 })
  assert.deepEqual(limpo, { inputTokens: 10, outputTokens: 20, totalTokens: 30, tokensSpent: 5 })
})

test('credencial SOLTA no meio de um texto também é removida', () => {
  for (const veneno of [
    'falhou com sk-abcdefghijklmnop',
    'header: Bearer eyJabcdefghij.klmnopqrst.uvwxyz1234',
    'token ghp_abcdefghijklmnopqrstuvwxyz',
    'usou AKIAIOSFODNN7EXAMPLE',
  ]) {
    assert.equal(sanitize(veneno), '[removido]', `${veneno} deveria sair`)
  }
})

test('payload sem limite vira preview COM identidade', () => {
  const gigante = 'x'.repeat(50_000)
  const limpo = sanitize(gigante)
  assert.ok(limpo.length < 1_400, 'o painel não é um arquivo')
  // O hash é o que permite comparar duas execuções sem guardar as duas.
  assert.match(limpo, /sha256:[0-9a-f]{12}/)
})

test('uma lista enorme não entra inteira — e o corte é declarado', () => {
  const limpo = sanitize(Array.from({ length: 500 }, (_, i) => i))
  assert.equal(limpo.length, 31)
  assert.match(String(limpo.at(-1)), /\+470 itens/)
})

test('chave de protótipo não atravessa a sanitização', () => {
  const veneno = JSON.parse('{"__proto__":{"poluido":true},"ok":1}')
  const limpo = sanitize(veneno)
  assert.equal(limpo.ok, 1)
  assert.equal({}.poluido, undefined, 'o protótipo global segue intacto')
  assert.ok(!Object.prototype.hasOwnProperty.call(limpo, '__proto__'))
})

// --- a identidade do plano ------------------------------------------------------------------------

test('o mesmo plano tem o mesmo id; um plano diferente, outro', () => {
  const a = { tasks: [{ id: 't1', agentId: 'x', objective: 'o' }] }
  const b = { tasks: [{ id: 't1', agentId: 'x', objective: 'o' }] }
  const c = { tasks: [{ id: 't1', agentId: 'y', objective: 'o' }] }
  assert.equal(planIdOf(a), planIdOf(b), 'dois planos iguais SÃO o mesmo plano')
  assert.notEqual(planIdOf(a), planIdOf(c))
})
