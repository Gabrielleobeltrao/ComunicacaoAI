// A VERSÃO publicada decide o que a ferramenta EXECUTA.
//
// Até aqui `runtimeKind` era um campo aceito: dava para publicar uma versão dizendo
// "isto é uma ação de App" e a ferramenta continuava fazendo a mesma chamada HTTP de
// antes. Este arquivo cobre o contrário — que a versão manda de verdade, que a
// ferramenta legada continua legada, e que a permissão é conferida no instante do
// efeito, e não quando a lista de ferramentas foi montada.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { mongoClient, db } = await import('../dist/db.js')
const { executeAgentTool } = await import('../dist/executors/toolExecutor.js')
const { registerFunction, __resetRegistry } = await import('../dist/executors/functionRegistry.js')
const { publishVersion, ensureToolVersionIndexes, ensureToolVersionCallIndexes, listVersionCalls } = await import('../dist/toolVersions.js')
const { resolveAgentTools } = await import('../dist/builtinTools.js')

const DONO = 'dono-runtime'
let servidor
let porta
let chamadasHttp = 0
let rodou = []

before(async () => {
  await mongoClient.connect()
  await ensureToolVersionIndexes()
  await ensureToolVersionCallIndexes()
  servidor = createServer((_req, res) => {
    chamadasHttp++
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"estoque":42}')
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  porta = servidor.address().port

  registerFunction({
    functionName: 'runtime.dobro',
    version: '1.0.0',
    description: 'dobra um número',
    capabilities: ['calculo'],
    inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    outputSchema: { type: 'object', properties: { dobro: { type: 'number' } }, required: ['dobro'] },
    handler: ({ n }) => {
      rodou.push(n)
      return { dobro: n * 2 }
    },
    timeoutMs: 2_000,
  })
})

after(async () => {
  __resetRegistry()
  await new Promise((r) => servidor.close(r))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['tools', 'tool_versions', 'tool_version_calls', 'agents']) await db.collection(c).deleteMany({})
  chamadasHttp = 0
  rodou = []
})

const criarFerramenta = async (over = {}) => {
  const r = await db.collection('tools').insertOne({
    ownerId: DONO,
    name: 'calcular',
    description: 'faz uma conta',
    enabled: true,
    method: 'GET',
    url: `http://127.0.0.1:${porta}/estoque`,
    headers: [],
    inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    allowedDomains: [],
    timeoutMs: 8_000,
    maxResponseChars: 4_000,
    maxCallsPerRun: 5,
    allowAutonomousExecution: true,
    ...over,
  })
  return r.insertedId
}

// Um agente que EXISTE no banco: a autorização é reconferida lá, não na cópia em memória.
const criarAgente = async (over = {}) => {
  const _id = new ObjectId()
  await db.collection('agents').insertOne({
    _id,
    ownerId: DONO,
    name: 'Operador',
    objective: 'operar',
    provider: 'anthropic',
    toolIds: [],
    appGrants: [],
    createdAt: new Date(),
    ...over,
  })
  return { _id, ownerId: DONO, name: 'Operador', toolIds: over.toolIds ?? [], appGrants: over.appGrants ?? [] }
}

const publicarFuncao = (toolId, extra = {}) =>
  publishVersion(DONO, toolId, {
    version: '1.0.0',
    runtimeKind: 'registered_function',
    manifest: { functionName: 'runtime.dobro' },
    inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    outputSchema: { type: 'object', properties: { dobro: { type: 'number' } }, required: ['dobro'] },
    ...extra,
  })

// --- registered_function EXECUTA ------------------------------------------------------------

test('a versão registered_function roda a função do servidor — e não o HTTP da ferramenta', async () => {
  const toolId = await criarFerramenta()
  await publicarFuncao(toolId)
  const agente = await criarAgente({ toolIds: [toolId.toString()] })

  const r = await executeAgentTool(agente, DONO, { kind: 'tool', toolId: toolId.toString() }, { n: 21 })

  assert.equal(r.ok, true)
  assert.deepEqual(r.structured.data, { dobro: 42 })
  assert.deepEqual(rodou, [21], 'a função registrada foi quem rodou')
  assert.equal(chamadasHttp, 0, 'a URL da ferramenta legada NÃO foi chamada')
  assert.equal(r.metadata.runtimeKind, 'registered_function')
})

test('a ferramenta SEM versão continua HTTP — nada de migração', async () => {
  const toolId = await criarFerramenta()
  const agente = await criarAgente({ toolIds: [toolId.toString()] })

  const r = await executeAgentTool(agente, DONO, { kind: 'tool', toolId: toolId.toString() }, { n: 1 })

  assert.equal(r.ok, true)
  assert.equal(chamadasHttp, 1, 'o caminho de sempre, intocado')
  assert.equal(rodou.length, 0)
})

test('uma versão http publicada também não desvia o caminho legado', async () => {
  const toolId = await criarFerramenta()
  await publishVersion(DONO, toolId, {
    version: '1.0.0',
    runtimeKind: 'http',
    manifest: { method: 'GET', url: `http://127.0.0.1:${porta}/estoque` },
    inputSchema: { type: 'object', properties: { n: { type: 'number' } } },
    outputSchema: { type: 'object', properties: { estoque: { type: 'number' } } },
  })
  const agente = await criarAgente({ toolIds: [toolId.toString()] })

  const r = await executeAgentTool(agente, DONO, { kind: 'tool', toolId: toolId.toString() }, { n: 1 })
  assert.equal(r.ok, true)
  assert.equal(chamadasHttp, 1)
})

// --- a autorização, no instante do efeito ------------------------------------------------------

test('ferramenta tirada do agente DEPOIS de montar a lista não executa', async () => {
  const toolId = await criarFerramenta()
  await publicarFuncao(toolId)
  const agente = await criarAgente({ toolIds: [toolId.toString()] })

  // A lista é montada com a permissão válida...
  const ferramentas = await resolveAgentTools({ ...agente, tools: [], builtinTools: [] }, DONO)
  const alvo = ferramentas.find((f) => f.name === 'calcular')
  assert.ok(alvo, 'a ferramenta versionada aparece para o modelo')

  // ...e a permissão é retirada antes de o modelo decidir chamar.
  await db.collection('agents').updateOne({ _id: agente._id }, { $set: { toolIds: [] } })

  const saida = await alvo.run({ n: 5 })
  assert.equal(saida.ok, false)
  assert.match(saida.result, /capability_unavailable/)
  assert.equal(rodou.length, 0, 'nada foi executado depois da revogação')
})

test('agente apagado não executa nada', async () => {
  const toolId = await criarFerramenta()
  await publicarFuncao(toolId)
  const agente = await criarAgente({ toolIds: [toolId.toString()] })
  await db.collection('agents').deleteOne({ _id: agente._id })

  const r = await executeAgentTool(agente, DONO, { kind: 'tool', toolId: toolId.toString() }, { n: 5 })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_configured')
  assert.equal(rodou.length, 0)
})

// --- os contratos --------------------------------------------------------------------------------

test('entrada fora do contrato da VERSÃO não chega na função', async () => {
  const toolId = await criarFerramenta()
  await publicarFuncao(toolId)
  const agente = await criarAgente({ toolIds: [toolId.toString()] })

  const r = await executeAgentTool(agente, DONO, { kind: 'tool', toolId: toolId.toString() }, { n: 'vinte' })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'invalid_input')
  assert.equal(rodou.length, 0)
})

test('saída que não bate com o contrato publicado é recusada, não repassada', async () => {
  const toolId = await criarFerramenta()
  // A versão promete `texto`; a função devolve `dobro`. Quem instalou leu a promessa.
  await publicarFuncao(toolId, {
    outputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
  })
  const agente = await criarAgente({ toolIds: [toolId.toString()] })

  const r = await executeAgentTool(agente, DONO, { kind: 'tool', toolId: toolId.toString() }, { n: 2 })
  assert.equal(r.ok, false)
  assert.match(r.error.message, /contrato publicado/)
})

// --- app_action --------------------------------------------------------------------------------

test('versão app_action sem grant não executa — e a recusa não conta o que a conta tem', async () => {
  const toolId = await criarFerramenta()
  await publishVersion(DONO, toolId, {
    version: '1.0.0',
    runtimeKind: 'app_action',
    manifest: { appKey: 'google_calendar', actionKey: 'criar_evento' },
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
  })
  const agente = await criarAgente({ toolIds: [toolId.toString()] })

  const r = await executeAgentTool(agente, DONO, { kind: 'tool', toolId: toolId.toString() }, {})
  assert.equal(r.ok, false)
  assert.match(r.error.message, /não tem autorização/)
  assert.ok(!JSON.stringify(r).includes(DONO))
  assert.equal(chamadasHttp, 0)
})

test('a versão app_action exige App e ação no manifesto — na publicação', async () => {
  const toolId = await criarFerramenta()
  await assert.rejects(
    () =>
      publishVersion(DONO, toolId, {
        version: '1.0.0',
        runtimeKind: 'app_action',
        manifest: { appKey: 'google_calendar' },
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      }),
    /qual App e qual ação/,
  )
})

test('a versão registered_function exige o nome da função — na publicação', async () => {
  const toolId = await criarFerramenta()
  await assert.rejects(
    () =>
      publishVersion(DONO, toolId, {
        version: '1.0.0',
        runtimeKind: 'registered_function',
        manifest: {},
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      }),
    /qual função/,
  )
})

test('função que não existe neste servidor recusa, sem inventar execução', async () => {
  const toolId = await criarFerramenta()
  await publicarFuncao(toolId, { manifest: { functionName: 'runtime.inexistente' } })
  const agente = await criarAgente({ toolIds: [toolId.toString()] })

  const r = await executeAgentTool(agente, DONO, { kind: 'tool', toolId: toolId.toString() }, { n: 1 })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_configured')
})

// --- limites e auditoria -------------------------------------------------------------------------

test('o teto de chamadas por execução vale para a ferramenta versionada', async () => {
  const toolId = await criarFerramenta()
  await publicarFuncao(toolId, { manifest: { functionName: 'runtime.dobro', maxCallsPerRun: 2 } })
  const agente = await criarAgente({ toolIds: [toolId.toString()] })

  const ferramentas = await resolveAgentTools({ ...agente, tools: [], builtinTools: [] }, DONO)
  const alvo = ferramentas.find((f) => f.name === 'calcular')
  assert.equal((await alvo.run({ n: 1 })).ok, true)
  assert.equal((await alvo.run({ n: 2 })).ok, true)
  const terceira = await alvo.run({ n: 3 })
  assert.equal(terceira.ok, false)
  assert.match(terceira.result, /limite_de_chamadas/)
  assert.deepEqual(rodou, [1, 2], 'a terceira não rodou')
})

test('cada execução deixa rastro seguro: o que rodou, se deu certo e quanto levou', async () => {
  const toolId = await criarFerramenta()
  await publicarFuncao(toolId)
  const agente = await criarAgente({ toolIds: [toolId.toString()] })

  await executeAgentTool(agente, DONO, { kind: 'tool', toolId: toolId.toString() }, { n: 4 })
  const trilha = await listVersionCalls(DONO, toolId)

  assert.equal(trilha.length, 1)
  const linha = trilha[0]
  assert.equal(linha.ok, true)
  assert.equal(linha.status, 'executed')
  assert.equal(linha.runtimeKind, 'registered_function')
  assert.equal(linha.version, '1.0.0')
  assert.equal(linha.risk, 'read')
  assert.ok(linha.sha256, 'o hash do que rodou — é por ele que se confere a revisão')
  assert.ok(Number.isFinite(linha.durationMs))
  // Nem argumento nem resposta: a trilha diz o que aconteceu, não o que passou por ali.
  const texto = JSON.stringify(linha)
  assert.ok(!texto.includes('"n"') && !texto.includes('dobro') && !texto.includes('"8"'))
})

test('a recusa é registrada como recusa, e não como execução', async () => {
  const toolId = await criarFerramenta()
  await publicarFuncao(toolId)
  const agente = await criarAgente({ toolIds: [toolId.toString()] })

  await executeAgentTool(agente, DONO, { kind: 'tool', toolId: toolId.toString() }, { n: 'texto' })
  const [linha] = await listVersionCalls(DONO, toolId)
  assert.equal(linha.ok, false)
  assert.equal(linha.status, 'refused')
})
