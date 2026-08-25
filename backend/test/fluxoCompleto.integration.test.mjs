// O CAMINHO INTEIRO, de ponta a ponta, uma etapa de cada vez.
//
//   conectar Alpaca Paper → escolher símbolos → stream → negócios → vela fechada
//   → gatilho interno → análise determinística (zero token) → sinal → política → ordem
//
// Cada peça já tem o teste dela. Este existe porque as juntas são onde as coisas
// quebram: um contrato que muda de nome, um payload que perde um campo no salto, uma
// permissão conferida em um lugar e não no outro. Nenhuma chamada sai da máquina.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { createInstallation, getInstallation } = await import('../dist/apps/installations.js')
const { getApp } = await import('../dist/apps/registry.js')
const { ensureStream, registerStreamAdapter, streamCredentials, clearStreamAdapters } = await import('../dist/streams/service.js')
const { StreamManager, setStreamManager } = await import('../dist/streams/manager.js')
const { ensureStreamIndexes } = await import('../dist/streams/repository.js')
const { alpacaStreamAdapter } = await import('../dist/apps/official/alpaca/stream.js')
const { createEventTrigger } = await import('../dist/automations/eventTrigger.js')
const { dispatchInternalEvent } = await import('../dist/automations/internalEvents.js')
const { processRun } = await import('../dist/automations/runProcessor.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
const { savePolicy, ensurePolicyIndexes } = await import('../dist/policies/repository.js')
const { ensureAppActionIndexes } = await import('../dist/apps/actionEvents.js')
const { resolveGrant } = await import('../dist/apps/grants.js')
const store = await import('../dist/marketData/candleStore.js')
const engine = await import('../dist/marketData/engine.js')
const { ensureMarketStateIndexes } = await import('../dist/marketData/state.js')
const bus = await import('../dist/events/bus.js')
const { db, mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const DONO = 'dono-fluxo'
const FLOOR = new ObjectId()
const BUILDING = new ObjectId()
const AGENTE = new ObjectId()
const SIMBOLO = 'AAPL'
const CRED = { keyId: 'PKTESTE0000000000000', secretKey: 'segredo-de-teste-que-nao-existe' }
const T0 = Date.parse('2026-06-08T14:00:00.000Z')

/** O socket falso. Nenhuma conexão sai desta máquina. */
class SocketFalso {
  constructor(url) {
    this.url = url
    this.enviadas = []
    SocketFalso.abertos.push(this)
  }
  send(d) {
    this.enviadas.push(d)
  }
  close() {
    this.fechado = true
  }
  abrir() {
    this.onopen?.({})
  }
  receber(obj) {
    this.onmessage?.({ data: JSON.stringify(obj) })
  }
}
SocketFalso.abertos = []

const semRelogio = { schedule: () => ({ id: 0, unref() {} }), cancel: () => undefined }

before(async () => {
  await ensureRunIndexes()
  await ensureStreamIndexes()
  await ensurePolicyIndexes()
  await ensureAppActionIndexes()
  await ensureMarketStateIndexes()
  await store.ensureCandleIndexes()
  await bus.ensureEventIndexes()
})

beforeEach(async () => {
  for (const c of [
    'automations',
    'automation_versions',
    'automation_runs',
    'step_runs',
    'agents',
    'offices',
    'buildings',
    'connections',
    'platform_events',
    'event_handler_runs',
    'market_candles',
    'market_state',
    'market_streams',
    'trading_policies',
    'app_action_events',
  ])
    await db.collection(c).deleteMany({})
  bus.resetHandlers()
  clearStreamAdapters()
  registerStreamAdapter(alpacaStreamAdapter)
  SocketFalso.abertos = []
  await db.collection('buildings').insertOne({ _id: BUILDING, ownerId: DONO, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: FLOOR, ownerId: DONO, buildingId: BUILDING, name: 'Térreo', status: 'active', createdAt: new Date() })
})

test('ACEITAÇÃO: da conexão Paper até a ordem, com zero token e política aplicada', async () => {
  // --- 1. conectar a Alpaca Paper -----------------------------------------------------
  const alpaca = getApp('alpaca')
  const conexao = await createInstallation(DONO, alpaca, { name: 'Alpaca Paper', config: CRED })
  // Nasce em simulação porque o manifesto diz: é o único ambiente que este App executa.
  assert.equal(conexao.environment, 'paper')
  assert.equal((await getInstallation(DONO, conexao._id)).status, 'connected')

  // --- 2. o agente, com permissão para analisar e para operar --------------------------
  const analisador = getApp('candle_analyzer')
  const conexaoAnalise = await createInstallation(DONO, analisador, { name: 'Análise' })
  await db.collection('agents').insertOne({
    _id: AGENTE,
    ownerId: DONO,
    name: 'Operador',
    objective: 'Acompanhar o mercado',
    officeId: FLOOR,
    activationModes: [],
    appGrants: [
      { installationId: conexaoAnalise._id.toString(), appKey: 'candle_analyzer', actionKeys: ['candles_find_opportunities'], resourceConfig: {}, autonomousWriteActionKeys: [] },
      // Ordem é `high_risk`: só roda sozinha com autorização explícita DAQUELA ação.
      { installationId: conexao._id.toString(), appKey: 'alpaca', actionKeys: ['alpaca_criar_ordem'], resourceConfig: {}, autonomousWriteActionKeys: ['alpaca_criar_ordem'] },
    ],
  })

  // --- 3. escolher os símbolos e ligar o tempo real ------------------------------------
  const gerente = new StreamManager({
    adapters: (await import('../dist/streams/registry.js')).streamAdapters(),
    createSocket: (url) => new SocketFalso(url),
    credentialsOf: streamCredentials,
    ...semRelogio,
  })
  setStreamManager(gerente)
  const stream = await ensureStream(DONO, conexao._id.toString(), [SIMBOLO])
  assert.deepEqual(stream.symbols, [SIMBOLO])
  assert.equal(SocketFalso.abertos.length, 1)

  const socket = SocketFalso.abertos[0]
  socket.abrir()
  // Autentica por mensagem e assina os três fatos do ativo.
  assert.deepEqual(JSON.parse(socket.enviadas[0]), { action: 'auth', key: CRED.keyId, secret: CRED.secretKey })
  assert.deepEqual(JSON.parse(socket.enviadas[1]), { action: 'subscribe', trades: [SIMBOLO], quotes: [SIMBOLO], bars: [SIMBOLO] })

  // --- 4. o gatilho de mercado, determinístico -----------------------------------------
  await createEventTrigger(DONO, AGENTE, {
    name: 'Vela fechada',
    objective: '',
    executionMode: 'deterministic',
    market: { enabled: true, eventType: 'market.candle.closed', symbols: [SIMBOLO], timeframe: '1m', includeSeries: true, seriesLength: 60 },
    action: {
      enabled: true,
      appKey: 'candle_analyzer',
      actionKey: 'candles_find_opportunities',
      args: { candles: '{{series}}', symbol: '{{payload.symbol}}', timeframe: '{{payload.timeframe}}' },
    },
    signal: { enabled: true, eventType: 'market.signal.detected', condition: null },
  })

  // --- 5. os negócios chegam pelo socket ------------------------------------------------
  engine.registerMarketDataHandlers()
  for (let minuto = 0; minuto < 20; minuto += 1) {
    const base = T0 + minuto * 60_000
    const preco = 100 + minuto * 0.5
    for (const [i, p] of [preco, preco + 0.3].entries()) {
      socket.receber([{ T: 't', S: SIMBOLO, p, s: 10, i: `${minuto}-${i}`, t: new Date(base + i * 20_000).toISOString() }])
    }
  }
  // O gerenciador publica sem esperar ninguém; os eventos precisam ter chegado ao banco.
  for (let i = 0; i < 200 && (await db.collection('platform_events').countDocuments({ type: 'market.price.updated' })) < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 5))
  }
  assert.equal(await db.collection('platform_events').countDocuments({ type: 'market.price.updated' }), 40)

  // --- 6. os eventos viram velas --------------------------------------------------------
  for (;;) {
    const e = await bus.claimNextEvent('w1')
    if (!e) break
    await bus.processEvent(e)
  }
  assert.ok((await db.collection('market_candles').countDocuments({ timeframe: '1m' })) >= 20)

  // --- 7. as velas fecham e publicam ----------------------------------------------------
  const depois = new Date(T0 + 21 * 60_000)
  const fechamento = await engine.closeDueCandles(depois)
  assert.ok(fechamento.published >= 20, 'cada vela fechada publicou o evento dela')

  // --- 8. o gatilho dispara e a análise roda sem modelo ----------------------------------
  const [velaFechada] = await bus.listEvents(DONO, { type: 'market.candle.closed' })
  const { runs } = await dispatchInternalEvent(velaFechada)
  assert.equal(runs, 1)
  const run = await db.collection('automation_runs').findOne({ ownerId: DONO })
  await processRun(run._id.toString())
  const feito = await db.collection('automation_runs').findOne({ _id: run._id })

  assert.equal(feito.status, 'succeeded')
  assert.equal(feito.usedAI, false)
  assert.equal(feito.usage.inputTokens + feito.usage.outputTokens, 0, 'zero token — medido, não presumido')

  const passos = await db.collection('step_runs').find({ runId: run._id }).toArray()
  const analise = passos.find((p) => p.stepType === 'app.execute')
  assert.equal(analise.status, 'succeeded')
  assert.ok(analise.outputPreview.candleCount >= 15, 'a análise recebeu a série, não uma vela solta')

  // --- 9. o sinal sai com o que serve para filtrar ----------------------------------------
  const [sinal] = await bus.listEvents(DONO, { type: 'market.signal.detected' })
  assert.ok(sinal)
  assert.equal(sinal.payload.symbol, SIMBOLO)
  assert.equal(sinal.payload.timeframe, '1m')
  assert.equal(sinal.payload.installationId, conexao._id.toString())

  // --- 10. a política barra a ordem grande -------------------------------------------------
  await savePolicy({ ownerId: DONO, installationId: conexao._id.toString(), agentId: null }, { maxQuantity: 5, requireStopLoss: false })
  const chamadas = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    chamadas.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null })
    if (String(url).includes('by_client_order_id')) return { ok: false, status: 404, text: async () => '{}' }
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'ordem-paper-1', symbol: SIMBOLO, status: 'accepted', qty: '3' }) }
  }
  try {
    const ferramentas = await resolveGrant(
      DONO,
      { appKey: 'alpaca', installationId: conexao._id.toString(), actionKeys: ['alpaca_criar_ordem'], resourceConfig: {}, autonomousWriteActionKeys: ['alpaca_criar_ordem'] },
      { agentId: AGENTE, executionRef: `run:${run._id.toString()}:ordem` },
    )
    const criar = ferramentas.find((t) => t.name === 'alpaca_criar_ordem')

    const grande = await criar.run({ symbol: SIMBOLO, side: 'buy', quantity: 50, type: 'limit', limitPrice: 100 })
    assert.equal(JSON.parse(grande.result).status, 'policy_denied')
    assert.equal(chamadas.filter((c) => c.method === 'POST').length, 0, 'a ordem grande não saiu')

    // --- 11. e deixa passar a que cabe -----------------------------------------------------
    const pequena = await criar.run({ symbol: SIMBOLO, side: 'buy', quantity: 3, type: 'limit', limitPrice: 100 })
    assert.equal(pequena.ok, true)
    assert.equal(JSON.parse(pequena.result).id, 'ordem-paper-1')
    const post = chamadas.find((c) => c.method === 'POST')
    assert.ok(post.url.includes('paper-api.alpaca.markets'), 'e foi para a SIMULAÇÃO')
    assert.match(post.body.client_order_id, /^cai-/, 'com chave de idempotência derivada da execução')
  } finally {
    globalThis.fetch = originalFetch
  }

  // --- 12. a auditoria conta a história inteira ---------------------------------------------
  const eventos = await db.collection('app_action_events').find({ ownerId: DONO, appKey: 'alpaca' }).sort({ createdAt: 1 }).toArray()
  assert.equal(eventos.length, 2)
  assert.equal(eventos[0].policy.allowed, false)
  assert.deepEqual(eventos[0].policy.violations, ['max_quantity'])
  assert.equal(eventos[1].policy.allowed, true)
  assert.equal(eventos[1].orderId, 'ordem-paper-1')
  assert.equal(eventos[1].environment, 'paper')
  // E nada do que é secreto ou financeiro entrou no registro.
  const json = JSON.stringify(eventos)
  for (const proibido of [CRED.secretKey, CRED.keyId, 'client_order_id']) assert.ok(!json.includes(proibido))
})
