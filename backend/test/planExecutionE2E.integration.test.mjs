// E2E: um plano tipado rodando de ponta a ponta, com agentes de tipos diferentes.
//
// A pergunta que este arquivo responde é uma só: o que uma etapa entrega chega na
// seguinte como DADO, ou chega como parágrafo para ela interpretar?
//
// A diferença não é estética. Enquanto a ligação é textual, a etapa de cálculo recebe "o
// faturamento foi de cento e vinte mil reais no trimestre" e precisa achar o número lá
// dentro — e quando ela erra, erra em silêncio, produzindo um resultado com a mesma cara
// de um certo. Com a ligação tipada, ou o campo chega no formato combinado, ou a etapa não
// roda e diz qual campo faltou.
//
// Real onde importa: mongod de verdade, o planejador de verdade, o compilador de verdade,
// o dispatcher de verdade e as funções do registro de verdade. Dublado só o modelo.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
delete process.env.VOYAGE_API_KEY

const { executeSectorTeam, sectorRunContext } = await import('../dist/delegation.js')
const { registerFunction, __resetRegistry } = await import('../dist/executors/functionRegistry.js')
const { db, mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'owner-e2e'
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

const setorCom = (coordenador, membros) => ({
  _id: new ObjectId(),
  name: 'Mesa',
  officeId: ANDAR,
  mode: 'orchestrated',
  coordinatorAgentId: coordenador._id,
  instruction: '',
  members: [{ agentId: coordenador._id, isDefault: true }, ...membros.map((m) => ({ agentId: m._id }))],
  stages: [],
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
        return over.runTask ? over.runTask(req) : { output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
      },
      startDelegation: async () => new ObjectId(),
      finishDelegation: async () => undefined,
      recordEvent: () => undefined,
      planWithModel: over.planWithModel,
    },
  }
}

const ctx = () => sectorRunContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'e2e' })

// As funções deste teste: determinísticas, registradas pelo servidor, escolhidas por NOME.
before(() => {
  registerFunction({
    functionName: 'teste.margem',
    version: '1.0.0',
    description: 'margem sobre receita e custo',
    capabilities: ['calculo'],
    inputSchema: {
      type: 'object',
      properties: { receita: { type: 'number' }, custo: { type: 'number' } },
      required: ['receita', 'custo'],
    },
    outputSchema: { type: 'object', properties: { margem: { type: 'number' } }, required: ['margem'] },
    handler: ({ receita, custo }) => ({ margem: Number((((receita - custo) / receita) * 100).toFixed(2)) }),
    timeoutMs: 2_000,
  })
  registerFunction({
    functionName: 'teste.classifica',
    version: '1.0.0',
    description: 'classifica uma margem',
    capabilities: ['calculo'],
    inputSchema: { type: 'object', properties: { margem: { type: 'number' } }, required: ['margem'] },
    outputSchema: { type: 'object', properties: { faixa: { type: 'string' } }, required: ['faixa'] },
    handler: ({ margem }) => ({ faixa: margem >= 30 ? 'alta' : 'baixa' }),
    timeoutMs: 2_000,
  })
  // Uma função que MENTE sobre o próprio contrato: devolve texto onde promete número.
  registerFunction({
    functionName: 'teste.quebrada',
    version: '1.0.0',
    description: 'devolve fora do contrato',
    capabilities: ['calculo'],
    inputSchema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
    outputSchema: { type: 'object', properties: { y: { type: 'number' } }, required: ['y'] },
    handler: () => ({ y: 'não é número' }),
    timeoutMs: 2_000,
  })
})
after(() => __resetRegistry())

const coletor = (over = {}) =>
  agente('Coletor', {
    preset: 'researcher',
    outputJsonSchema: { type: 'object', properties: { receita: { type: 'number' }, custo: { type: 'number' } }, required: ['receita', 'custo'] },
    defaultOutputFormat: 'json',
    responseMode: 'structured_and_text',
    ...over,
  })

const calculadora = (over = {}) =>
  agente('Margem', {
    preset: 'custom',
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'teste.margem' },
    inputJsonSchema: { type: 'object', properties: { receita: { type: 'number' }, custo: { type: 'number' } }, required: ['receita', 'custo'] },
    outputJsonSchema: { type: 'object', properties: { margem: { type: 'number' } }, required: ['margem'] },
    responseMode: 'structured',
    ...over,
  })

const planoDe = (tasks) => async () => JSON.stringify({ tasks })

// --- LLM → Function ---------------------------------------------------------------------------

test('LLM → Function: o número sai do modelo como DADO e entra na função como campo', async () => {
  const chefe = agente('Chefe', { preset: 'manager' })
  const a = coletor()
  const b = calculadora()
  const setor = setorCom(chefe, [a, b])
  const f = deps([chefe, a, b], {
    sector: setor,
    planWithModel: planoDe([
      { id: 'c', agentId: a._id.toString(), objective: 'levantar receita e custo' },
      {
        id: 'm',
        agentId: b._id.toString(),
        objective: 'calcular a margem',
        dependsOn: ['c'],
        inputBindings: { receita: '$steps.c.receita', custo: '$steps.c.custo' },
      },
    ]),
    runTask: async (req) => {
      // O coletor responde JSON; o coordenador consolida.
      if (req.output?.format === 'json') {
        return { output: '{"receita":200000,"custo":140000}', json: { receita: 200000, custo: 140000 }, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [], format: { requested: 'json', valid: true, repaired: false } }
      }
      return { output: `consolidado: ${String(req.input ?? '')}`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })

  const run = await executeSectorTeam(f.deps, ctx(), setor, { objective: 'qual a margem?' })
  // 30% de 200000/140000. Se a função tivesse recebido prosa, não haveria número nenhum.
  assert.match(run.output, /30/)
  // E a função NÃO passou pelo provedor: só o coletor e o coordenador chamaram o modelo.
  assert.equal(f.chamadas.length, 2, 'uma função determinística não pode custar uma inferência')
})

// --- Function → Function ------------------------------------------------------------------------

test('Function → Function: duas etapas encadeadas, e nenhuma chamada ao modelo entre elas', async () => {
  const chefe = agente('Chefe', { preset: 'manager' })
  const a = calculadora()
  const b = agente('Classificador', {
    preset: 'custom',
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'teste.classifica' },
    inputJsonSchema: { type: 'object', properties: { margem: { type: 'number' } }, required: ['margem'] },
    outputJsonSchema: { type: 'object', properties: { faixa: { type: 'string' } }, required: ['faixa'] },
    responseMode: 'structured',
  })
  const setor = setorCom(chefe, [a, b])
  const f = deps([chefe, a, b], {
    sector: setor,
    planWithModel: planoDe([
      { id: 'm', agentId: a._id.toString(), objective: 'margem', inputBindings: { receita: 200000, custo: 140000 } },
      { id: 'k', agentId: b._id.toString(), objective: 'faixa', dependsOn: ['m'], inputBindings: { margem: '$steps.m.margem' } },
    ]),
    runTask: async (req) => ({ output: `consolidado: ${String(req.input ?? '')}`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  })

  const run = await executeSectorTeam(f.deps, ctx(), setor, { objective: 'classifique a margem' })
  assert.match(run.output, /alta/)
  assert.equal(f.chamadas.length, 1, 'só a consolidação final falou com o provedor')
})

// --- Tool → LLM --------------------------------------------------------------------------------

test('Tool → LLM: o resultado da ferramenta vira campo para o modelo, não parágrafo', async () => {
  const chefe = agente('Chefe', { preset: 'manager' })
  // Uma "ferramenta" representada pelo mesmo caminho de função: o que o teste precisa
  // provar é o ENCADEAMENTO tipado, e o executor de ferramenta já tem cobertura própria.
  const ferramenta = calculadora({ name: 'Ferramenta' })
  const redator = agente('Redator', {
    preset: 'analyst',
    inputJsonSchema: { type: 'object', properties: { margem: { type: 'number' } }, required: ['margem'] },
    responseMode: 'text',
  })
  const setor = setorCom(chefe, [ferramenta, redator])
  const f = deps([chefe, ferramenta, redator], {
    sector: setor,
    planWithModel: planoDe([
      { id: 'f', agentId: ferramenta._id.toString(), objective: 'calcular', inputBindings: { receita: 200000, custo: 140000 } },
      { id: 'r', agentId: redator._id.toString(), objective: 'escrever', dependsOn: ['f'], inputBindings: { margem: '$steps.f.margem' } },
    ]),
    runTask: async (req) => ({ output: `texto sobre ${String(req.input ?? '')}`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  })

  await executeSectorTeam(f.deps, ctx(), setor, { objective: 'escreva sobre a margem' })
  const doRedator = f.chamadas.find((c) => /margem: 30/.test(String(c.input ?? '')))
  assert.ok(doRedator, 'o modelo recebe o campo com o valor, não a prosa da etapa anterior')
  assert.doesNotMatch(String(doRedator.input), /\[Ferramenta\]/, 'a concatenação textual não acompanha uma tarefa nova')
})

// --- falha de entrada ---------------------------------------------------------------------------

test('falha de entrada: tipo errado não executa a etapa — e o erro diz o campo', async () => {
  const chefe = agente('Chefe', { preset: 'manager' })
  const a = coletor({ outputJsonSchema: { type: 'object', properties: { receita: { type: 'string' }, custo: { type: 'number' } } } })
  const b = calculadora()
  const setor = setorCom(chefe, [a, b])
  const f = deps([chefe, a, b], {
    sector: setor,
    planWithModel: planoDe([
      { id: 'c', agentId: a._id.toString(), objective: 'levantar' },
      { id: 'm', agentId: b._id.toString(), objective: 'calcular', dependsOn: ['c'], inputBindings: { receita: '$steps.c.receita', custo: '$steps.c.custo' } },
    ]),
    runTask: async (req) => {
      if (req.output?.format === 'json') {
        // "duzentos mil" no lugar do número: exatamente o que a ligação textual escondia.
        return { output: '{"receita":"duzentos mil","custo":140000}', json: { receita: 'duzentos mil', custo: 140000 }, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [], format: { requested: 'json', valid: true, repaired: false } }
      }
      return { output: 'consolidado', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })

  const run = await executeSectorTeam(f.deps, ctx(), setor, { objective: 'qual a margem?' })
  const aviso = run.warnings.find((w) => /entrada não confere/.test(w))
  assert.ok(aviso, `a etapa precisa recusar em vez de calcular sobre "duzentos mil": ${JSON.stringify(run.warnings)}`)
  assert.match(aviso, /receita/, 'o diagnóstico diz QUAL campo')
  assert.doesNotMatch(aviso, /duzentos mil/, 'o nome do campo basta; o valor é conteúdo')
})

test('falha de entrada: campo que a etapa anterior não entregou pula a execução', async () => {
  const chefe = agente('Chefe', { preset: 'manager' })
  const a = coletor({ outputJsonSchema: { type: 'object', properties: { receita: { type: 'number' }, custo: { type: 'number' } } } })
  const b = calculadora()
  const setor = setorCom(chefe, [a, b])
  const f = deps([chefe, a, b], {
    sector: setor,
    planWithModel: planoDe([
      { id: 'c', agentId: a._id.toString(), objective: 'levantar' },
      { id: 'm', agentId: b._id.toString(), objective: 'calcular', dependsOn: ['c'], inputBindings: { receita: '$steps.c.receita', custo: '$steps.c.custo' } },
    ]),
    runTask: async (req) => {
      if (req.output?.format === 'json') {
        return { output: '{"receita":200000}', json: { receita: 200000 }, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [], format: { requested: 'json', valid: true, repaired: false } }
      }
      return { output: 'consolidado', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })

  const run = await executeSectorTeam(f.deps, ctx(), setor, { objective: 'qual a margem?' })
  assert.ok(run.warnings.some((w) => /custo/.test(w)), JSON.stringify(run.warnings))
})

// --- falha de saída ------------------------------------------------------------------------------

test('falha de saída: o que não cumpre o contrato não vira entrada de ninguém', async () => {
  const chefe = agente('Chefe', { preset: 'manager' })
  const quebrada = agente('Quebrada', {
    preset: 'custom',
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'teste.quebrada' },
    inputJsonSchema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
    outputJsonSchema: { type: 'object', properties: { y: { type: 'number' } }, required: ['y'] },
    responseMode: 'structured',
  })
  const setor = setorCom(chefe, [quebrada])
  const f = deps([chefe, quebrada], {
    sector: setor,
    planWithModel: planoDe([{ id: 'q', agentId: quebrada._id.toString(), objective: 'rodar', inputBindings: { x: 1 } }]),
    runTask: async () => ({ output: 'consolidado', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  })

  const run = await executeSectorTeam(f.deps, ctx(), setor, { objective: 'rode' })
  assert.ok(run.warnings.some((w) => /y/.test(w)), JSON.stringify(run.warnings))
})

test('Function com saída inválida NÃO chama o modelo para consertar', async () => {
  const chefe = agente('Chefe', { preset: 'manager' })
  const quebrada = agente('Quebrada', {
    preset: 'custom',
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'teste.quebrada' },
    inputJsonSchema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
    outputJsonSchema: { type: 'object', properties: { y: { type: 'number' } }, required: ['y'] },
    responseMode: 'structured',
  })
  const setor = setorCom(chefe, [quebrada])
  const f = deps([chefe, quebrada], {
    sector: setor,
    planWithModel: planoDe([{ id: 'q', agentId: quebrada._id.toString(), objective: 'rodar', inputBindings: { x: 1 } }]),
    runTask: async () => ({ output: 'consolidado', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  })

  await executeSectorTeam(f.deps, ctx(), setor, { objective: 'rode' })
  // Só a consolidação. Uma função que devolve dado inválido é um DEFEITO DA FUNÇÃO; pedir
  // ao modelo que conserte esconderia o defeito e cobraria por isso.
  assert.equal(f.chamadas.length, 1)
})

// --- compatibilidade legada ------------------------------------------------------------------------

test('plano legado, sem bindings, continua ligando as etapas por texto', async () => {
  const chefe = agente('Chefe', { preset: 'manager' })
  const a = agente('Um')
  const b = agente('Dois', { preset: 'analyst' })
  const setor = setorCom(chefe, [a, b])
  const f = deps([chefe, a, b], {
    sector: setor,
    // Exatamente o formato de antes desta fase: nenhum campo novo.
    planWithModel: planoDe([
      { id: 't1', agentId: a._id.toString(), objective: 'levantar' },
      { id: 't2', agentId: b._id.toString(), objective: 'analisar', dependsOn: ['t1'] },
    ]),
    runTask: async (req) => ({ output: `resposta de ${req.objective}`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  })

  const run = await executeSectorTeam(f.deps, ctx(), setor, { objective: 'pergunta antiga' })
  const doSegundo = f.chamadas.find((c) => /\[Um\]/.test(String(c.input ?? '')))
  assert.ok(doSegundo, 'sem bindings, a entrada continua sendo o texto do antecessor, com autoria')
  assert.equal(run.warnings.filter((w) => /não confere/.test(w)).length, 0, 'um plano antigo não pode virar erro por não falar a língua nova')
})

test('agente antigo, sem nenhum campo de contrato, executa pelo caminho de sempre', async () => {
  const chefe = agente('Chefe', { preset: 'manager' })
  const a = agente('Antigo')
  const setor = setorCom(chefe, [a])
  const f = deps([chefe, a], {
    sector: setor,
    planWithModel: planoDe([{ id: 't1', agentId: a._id.toString(), objective: 'trabalhar' }]),
    runTask: async (req) => ({ output: `feito: ${req.objective}`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  })

  const run = await executeSectorTeam(f.deps, ctx(), setor, { objective: 'faça' })
  assert.ok(f.chamadas.some((c) => c.objective === 'trabalhar' || /trabalhar/.test(String(c.instructions ?? ''))))
  assert.equal(run.warnings.filter((w) => /confere/.test(w)).length, 0)
})

// --- a entrega estruturada --------------------------------------------------------------------------

test('coordenador estruturado entrega o DADO, sem pagar uma síntese em prosa', async () => {
  const chefe = agente('Chefe', { preset: 'manager', responseMode: 'structured' })
  const a = calculadora()
  const setor = setorCom(chefe, [a])
  const f = deps([chefe, a], {
    sector: setor,
    planWithModel: planoDe([{ id: 'm', agentId: a._id.toString(), objective: 'margem', inputBindings: { receita: 200000, custo: 140000 } }]),
    runTask: async () => ({ output: 'não deveria ser chamado', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  })

  const run = await executeSectorTeam(f.deps, ctx(), setor, { objective: 'margem' })
  assert.deepEqual(JSON.parse(run.output), { margem: 30 })
  assert.equal(f.chamadas.length, 0, 'transformar dado em frase para o consumidor extrair de volta é gastar por um resultado pior')
})
