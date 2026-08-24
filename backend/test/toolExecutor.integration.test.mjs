// Executar uma ferramenta pelo caminho que JÁ EXISTE.
//
// Nada de HTTP novo aqui: `resolveGrant` e `executeToolCall` já resolvem App, posse da
// instalação, status, versão e credencial. Reimplementar isso seria manter dois caminhos
// com regras de permissão diferentes — e o dia em que divergissem, um estaria autorizando
// o que o outro recusa.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { executeAgentTool } = await import('../dist/executors/toolExecutor.js')
const { mongoClient, db } = await import('../dist/db.js')

const DONO = 'dono-ferramenta'
let servidor
let porta
let pedidos = []

before(async () => {
  await mongoClient.connect()
  servidor = createServer((req, res) => {
    pedidos.push({ url: req.url, headers: req.headers })
    // `startsWith`: um GET acrescenta os argumentos como query, então a URL não é exata.
    if (req.url?.startsWith('/erro')) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end('{"detail":"quebrou"}')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"estoque":42,"unidade":"caixas"}')
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  porta = servidor.address().port
})

after(async () => {
  await new Promise((r) => servidor.close(r))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await db.collection('tools').deleteMany({})
  pedidos = []
})

const criarFerramenta = async (over = {}) => {
  const r = await db.collection('tools').insertOne({
    ownerId: DONO,
    name: 'consultar_estoque',
    description: 'consulta o estoque',
    enabled: true,
    method: 'GET',
    url: `http://127.0.0.1:${porta}/estoque`,
    headers: [],
    inputSchema: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] },
    // Os campos que um documento REAL tem. Um fixture incompleto testaria outra coisa —
    // e a primeira versão deste teste falhou por isso, não pelo executor.
    allowedDomains: [],
    timeoutMs: 8_000,
    maxResponseChars: 4_000,
    maxCallsPerRun: 5,
    allowAutonomousExecution: true,
    ...over,
  })
  return r.insertedId.toString()
}

const agente = (over = {}) => ({ _id: new ObjectId(), ownerId: DONO, name: 'Operador', toolIds: [], appGrants: [], ...over })

// --- o caminho feliz ---------------------------------------------------------------------------

test('a ferramenta autorizada executa, e o resultado vira DADO e texto', async () => {
  const toolId = await criarFerramenta()
  const r = await executeAgentTool(agente({ toolIds: [toolId] }), DONO, { kind: 'tool', toolId }, { sku: 'ABC' })

  assert.equal(r.ok, true)
  assert.deepEqual(r.structured.data, { estoque: 42, unidade: 'caixas' })
  assert.ok(r.text, 'o texto continua disponível para quem apresenta')
  assert.equal(r.telemetry.externalCalls, 1)
  assert.equal(pedidos.length, 1, 'passou pelo mecanismo existente, uma vez')
})

// --- a permissão ---------------------------------------------------------------------------------

test('ferramenta NÃO atribuída ao agente é recusada — atribuir é a permissão', async () => {
  const toolId = await criarFerramenta()
  const r = await executeAgentTool(agente({ toolIds: [] }), DONO, { kind: 'tool', toolId }, { sku: 'ABC' })

  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_configured')
  assert.match(r.error.message, /não está autorizada/)
  assert.equal(pedidos.length, 0, 'a recusa acontece ANTES de qualquer chamada externa')
})

test('a ferramenta de OUTRO dono não existe para este agente', async () => {
  const r = await db.collection('tools').insertOne({
    ownerId: 'outra-conta',
    name: 'alheia',
    enabled: true,
    method: 'GET',
    url: `http://127.0.0.1:${porta}/estoque`,
    headers: [],
    inputSchema: { type: 'object', properties: {} },
  })
  const id = r.insertedId.toString()
  // Mesmo com o id na lista do agente: o escopo de dono está na CONSULTA.
  const out = await executeAgentTool(agente({ toolIds: [id] }), DONO, { kind: 'tool', toolId: id }, {})
  assert.equal(out.ok, false)
  assert.match(out.error.message, /não existe mais nesta conta/)
  assert.equal(pedidos.length, 0)
})

test('ferramenta desativada não executa', async () => {
  const toolId = await criarFerramenta({ enabled: false })
  const r = await executeAgentTool(agente({ toolIds: [toolId] }), DONO, { kind: 'tool', toolId }, { sku: 'A' })
  assert.equal(r.ok, false)
  assert.match(r.error.message, /desativada/)
  assert.equal(pedidos.length, 0)
})

test('ferramenta que sumiu do banco é recusada', async () => {
  const r = await executeAgentTool(agente({ toolIds: ['x'] }), DONO, { kind: 'tool', toolId: new ObjectId().toString() }, {})
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_configured')
})

// --- o contrato de entrada ------------------------------------------------------------------------

test('entrada fora do contrato não vira chamada externa', async () => {
  const toolId = await criarFerramenta()
  const r = await executeAgentTool(agente({ toolIds: [toolId] }), DONO, { kind: 'tool', toolId }, { sku: 123 })

  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'invalid_input')
  assert.equal(pedidos.length, 0, 'validar depois de chamar é pagar pela chamada errada')
})

// --- o App -----------------------------------------------------------------------------------------

test('sem grant, a ação de App não executa', async () => {
  const r = await executeAgentTool(agente(), DONO, { kind: 'tool', appKey: 'google_calendar', actionKey: 'criar_evento' }, {})
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_configured')
  assert.match(r.error.message, /não tem autorização/)
  // A mensagem não conta o que existe na conta.
  assert.ok(!r.error.message.includes(DONO))
})

test('grant do App sem a AÇÃO pedida também não executa', async () => {
  const a = agente({ appGrants: [{ appKey: 'google_calendar', installationId: new ObjectId().toString(), actionKeys: ['listar_eventos'] }] })
  const r = await executeAgentTool(a, DONO, { kind: 'tool', appKey: 'google_calendar', actionKey: 'criar_evento' }, {})
  assert.equal(r.ok, false)
  assert.match(r.error.message, /ação não está autorizada/)
})

test('instalação ausente: recusa clara, sem executar', async () => {
  // O grant existe e cita a ação, mas a instalação não está lá — foi removida depois.
  const a = agente({ appGrants: [{ appKey: 'google_calendar', installationId: new ObjectId().toString(), actionKeys: ['criar_evento'] }] })
  const r = await executeAgentTool(a, DONO, { kind: 'tool', appKey: 'google_calendar', actionKey: 'criar_evento' }, {})
  assert.equal(r.ok, false)
  assert.equal(pedidos.length, 0)
})

// --- a configuração incompleta ------------------------------------------------------------------------

test('sem toolId e sem App/ação, não há o que executar', async () => {
  const r = await executeAgentTool(agente(), DONO, { kind: 'tool' }, {})
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_configured')
})

// --- o erro do outro lado --------------------------------------------------------------------------------

test('erro do serviço vira erro tipado, e o segredo não vaza', async () => {
  const toolId = await criarFerramenta({
    url: `http://127.0.0.1:${porta}/erro`,
    headers: [{ key: 'Authorization', value: 'Bearer segredo-de-teste' }],
  })
  const r = await executeAgentTool(agente({ toolIds: [toolId] }), DONO, { kind: 'tool', toolId }, { sku: 'A' })

  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'tool')
  const texto = JSON.stringify(r)
  assert.ok(!texto.includes('segredo-de-teste'), 'o mecanismo existente mascara — e é por isso que ele é reusado')
})
