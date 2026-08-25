// O CAMINHO INTEIRO: uma vela fecha, o barramento avisa, a automação roda, a análise
// acontece — e nenhum token é gasto.
//
// O que está sendo provado aqui é a promessa do modo determinístico. Ela é fácil de
// afirmar e fácil de quebrar sem ninguém perceber: basta uma etapa de IA aparecer na
// definição por acidente. Por isso a conta de tokens é assertada, e não presumida.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'
process.env.APP_ENCRYPTION_KEY ||= 'chave-de-teste-com-32-caracteres!'

const { mongoClient, db } = await import('../dist/db.js')
const { buildEventTriggerDefinition, createEventTrigger, normalizeMarketPlan } = await import('../dist/automations/eventTrigger.js')
const { dispatchInternalEvent, matchesInternalTrigger, MAX_EVENT_CHAIN } = await import('../dist/automations/internalEvents.js')
const { processRun } = await import('../dist/automations/runProcessor.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
const { validateDefinition } = await import('../dist/automations/validate.js')
const bus = await import('../dist/events/bus.js')
const engine = await import('../dist/marketData/engine.js')
const store = await import('../dist/marketData/candleStore.js')
const { ensureMarketStateIndexes } = await import('../dist/marketData/state.js')
const { getApp } = await import('../dist/apps/registry.js')

before(async () => {
  await mongoClient.connect()
  await ensureRunIndexes()
  await bus.ensureEventIndexes()
  await store.ensureCandleIndexes()
  await ensureMarketStateIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'dono-gatilho-interno'
const FLOOR = new ObjectId()
const BUILDING = new ObjectId()
const AGENT = new ObjectId()
const INSTALACAO = new ObjectId()

const T0 = Date.parse('2026-04-06T13:00:00.000Z')
const SIMBOLO = 'PETR4'

const K = {
  ownerId: OWNER,
  provider: 'corretora_teste',
  installationId: INSTALACAO.toString(),
  environment: 'paper',
  symbol: SIMBOLO,
}

beforeEach(async () => {
  for (const c of ['automations', 'automation_versions', 'automation_runs', 'step_runs', 'agents', 'offices', 'buildings', 'connections', 'platform_events', 'market_candles', 'market_state'])
    await db.collection(c).deleteMany({})
  bus.resetHandlers()
  await db.collection('buildings').insertOne({ _id: BUILDING, ownerId: OWNER, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: FLOOR, ownerId: OWNER, buildingId: BUILDING, name: 'Térreo', status: 'active', createdAt: new Date() })
  const app = getApp('candle_analyzer')
  await db.collection('connections').insertOne({
    _id: INSTALACAO,
    ownerId: OWNER,
    appKey: app.key,
    appVersion: app.version,
    name: 'Análise de candles',
    status: 'connected',
    encryptedConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.collection('agents').insertOne({
    _id: AGENT,
    ownerId: OWNER,
    name: 'Ana',
    objective: 'Acompanhar o mercado',
    officeId: FLOOR,
    activationModes: [],
    appGrants: [
      {
        installationId: INSTALACAO.toString(),
        appKey: app.key,
        actionKeys: ['candles_find_opportunities'],
        resourceConfig: {},
        autonomousWriteActionKeys: [],
      },
    ],
  })
})

/** Uma série de velas fechadas, subindo — o suficiente para o analisador aceitar. */
async function serieFechada(quantas = 25) {
  for (let minuto = 0; minuto < quantas; minuto += 1) {
    const base = T0 + minuto * 60_000
    const p = 30 + minuto * 0.2
    await engine.ingestTrade(K, { symbol: SIMBOLO, price: p, size: 100, at: new Date(base + 1_000), tradeId: `a${minuto}` })
    await engine.ingestTrade(K, { symbol: SIMBOLO, price: p + 0.4, size: 100, at: new Date(base + 30_000), tradeId: `b${minuto}` })
    await engine.closeDueCandles(new Date(base + 61_000))
  }
}

const ACAO_ANALISE = {
  enabled: true,
  appKey: 'candle_analyzer',
  actionKey: 'candles_find_opportunities',
  // O gatilho entrega a série pronta em `series`, e o resto vem do payload do evento.
  args: { candles: '{{series}}', symbol: '{{payload.symbol}}', timeframe: '{{payload.timeframe}}' },
}

const specDeMercado = (over = {}) => ({
  name: 'Vela fechada',
  objective: '',
  executionMode: 'deterministic',
  market: { enabled: true, eventType: 'market.candle.closed', symbols: [SIMBOLO], timeframe: '1m', includeSeries: true, seriesLength: 60 },
  action: ACAO_ANALISE,
  ...over,
})

const eventoDeVela = () => bus.listEvents(OWNER, { type: 'market.candle.closed' })

// --- a definição ------------------------------------------------------------------------

test('o gatilho de mercado é interno: sem endereço, sem assinatura, sem porta pública', () => {
  const def = buildEventTriggerDefinition(specDeMercado(), AGENT)
  assert.equal(def.trigger.type, 'internal_event')
  assert.equal(def.trigger.eventType, 'market.candle.closed')
  assert.deepEqual(def.trigger.symbols, [SIMBOLO])
  assert.equal(def.trigger.timeframe, '1m')
  // Nenhuma URL para adivinhar: é a diferença entre ouvir de fora e ouvir de dentro.
  assert.equal(def.trigger.requireSignature, undefined)
  assert.equal(validateDefinition(def).valid, true)
})

test('num modo sem IA a definição NÃO contém etapa de agente', () => {
  const def = buildEventTriggerDefinition(specDeMercado(), AGENT)
  assert.equal(def.steps.some((s) => s.type === 'agent.execute'), false, 'não há passo para pular nem flag para inverter')
  assert.ok(def.steps.some((s) => s.type === 'app.execute'))
})

test('um gatilho com tipo de evento inventado é recusado pela definição', () => {
  const def = buildEventTriggerDefinition(specDeMercado(), AGENT)
  const resultado = validateDefinition({ ...def, trigger: { type: 'internal_event', eventType: 'market.coisa.qualquer' } })
  assert.equal(resultado.valid, false)
  assert.ok(resultado.errors.some((e) => e.path === 'trigger.eventType'))
})

test('tipo desconhecido no plano desliga o gatilho em vez de gravar um que nunca dispara', () => {
  assert.equal(normalizeMarketPlan({ enabled: true, eventType: 'nao.existe' }).enabled, false)
  assert.equal(normalizeMarketPlan({ enabled: true, eventType: 'market.candle.closed' }).enabled, true)
})

// --- os filtros -------------------------------------------------------------------------

test('filtro ausente quer dizer QUALQUER, e não nenhum', () => {
  const evento = { type: 'market.candle.closed', payload: { symbol: 'VALE3', timeframe: '5m', installationId: 'inst-9' } }
  assert.equal(matchesInternalTrigger({ type: 'internal_event', eventType: 'market.candle.closed' }, evento), true)
  assert.equal(matchesInternalTrigger({ type: 'internal_event', eventType: 'market.candle.closed', symbols: ['PETR4'] }, evento), false)
  assert.equal(matchesInternalTrigger({ type: 'internal_event', eventType: 'market.candle.closed', timeframe: '1m' }, evento), false)
  assert.equal(matchesInternalTrigger({ type: 'internal_event', eventType: 'market.candle.closed', installationId: 'outra' }, evento), false)
  assert.equal(matchesInternalTrigger({ type: 'internal_event', eventType: 'trade.order.filled' }, evento), false)
})

test('o símbolo é comparado sem depender de maiúscula', () => {
  const evento = { type: 'market.candle.closed', payload: { symbol: 'petr4' } }
  assert.equal(matchesInternalTrigger({ type: 'internal_event', eventType: 'market.candle.closed', symbols: ['PETR4'] }, evento), true)
})

// --- o caminho inteiro ---------------------------------------------------------------------

test('vela fecha, gatilho dispara, análise roda — e a conta de tokens é zero', async () => {
  await createEventTrigger(OWNER, AGENT, specDeMercado())
  await serieFechada()

  const eventos = await eventoDeVela()
  assert.ok(eventos.length >= 20, 'as velas fecharam e viraram evento')

  const { runs } = await dispatchInternalEvent(eventos[0])
  assert.equal(runs, 1, 'o evento encontrou o gatilho')

  const run = await db.collection('automation_runs').findOne({ ownerId: OWNER })
  await processRun(run._id.toString())
  const feito = await db.collection('automation_runs').findOne({ _id: run._id })

  assert.equal(feito.status, 'succeeded')
  // A promessa do modo determinístico, medida e não presumida.
  assert.equal(feito.usedAI, false)
  assert.equal(feito.usage.inputTokens + feito.usage.outputTokens, 0, 'zero token')

  const passos = await db.collection('step_runs').find({ runId: run._id }).toArray()
  const analise = passos.find((p) => p.stepType === 'app.execute')
  assert.equal(analise.status, 'succeeded')
  // O App recebeu a série de verdade — não uma vela solta.
  assert.equal(analise.outputPreview.symbol, SIMBOLO)
  assert.ok(analise.outputPreview.candleCount >= 15, 'a série inteira, não a vela do evento')
  assert.equal(typeof analise.outputPreview.score, 'number')
})

test('reprocessar o mesmo evento não cria uma segunda execução', async () => {
  await createEventTrigger(OWNER, AGENT, specDeMercado())
  await serieFechada(16)
  const [evento] = await eventoDeVela()
  const primeira = await dispatchInternalEvent(evento)
  const segunda = await dispatchInternalEvent(evento)
  assert.equal(primeira.runs, 1)
  assert.equal(segunda.runs, 0, 'a chave de idempotência é a identidade do evento')
  assert.equal(await db.collection('automation_runs').countDocuments({}), 1)
})

test('um evento que não casa com o filtro não dispara nada', async () => {
  await createEventTrigger(OWNER, AGENT, specDeMercado({ market: { enabled: true, eventType: 'market.candle.closed', symbols: ['VALE3'], timeframe: '1m', includeSeries: true, seriesLength: 60 } }))
  await serieFechada(16)
  const [evento] = await eventoDeVela()
  assert.equal((await dispatchInternalEvent(evento)).runs, 0)
})

test('evento de outra conta não alcança o gatilho', async () => {
  await createEventTrigger(OWNER, AGENT, specDeMercado())
  await serieFechada(16)
  const [evento] = await eventoDeVela()
  const alheio = { ...evento, ownerId: 'outro-dono' }
  assert.equal((await dispatchInternalEvent(alheio)).runs, 0, 'o dono está na consulta, não numa conferência depois')
})

// --- o sinal ------------------------------------------------------------------------------

const specComSinal = (condicao) =>
  specDeMercado({
    signal: { enabled: true, eventType: 'market.signal.detected', condition: condicao },
  })

test('só um resultado relevante publica sinal', async () => {
  // A condição é o ponto: sem ela toda vela viraria sinal, e um sinal que acontece
  // sempre não é sinal.
  await createEventTrigger(OWNER, AGENT, specComSinal({ source: 'acao', path: 'opportunityFound', operator: 'equals', value: true }))
  await serieFechada()
  const [evento] = await eventoDeVela()
  await dispatchInternalEvent(evento)
  const run = await db.collection('automation_runs').findOne({ ownerId: OWNER })
  await processRun(run._id.toString())

  const passos = await db.collection('step_runs').find({ runId: run._id }).toArray()
  const sinal = passos.find((p) => p.stepType === 'event.publish')
  const analise = passos.find((p) => p.stepType === 'app.execute')
  assert.ok(sinal, 'a etapa existe na definição, tenha rodado ou não')
  // O trace conta a decisão: rodou porque a condição deu verdadeira, ou foi pulada.
  const houveOportunidade = analise.outputPreview.opportunityFound === true
  assert.equal(sinal.status, houveOportunidade ? 'succeeded' : 'skipped')
  const sinais = await bus.listEvents(OWNER, { type: 'market.signal.detected' })
  assert.equal(sinais.length, houveOportunidade ? 1 : 0)
})

test('a condição falsa deixa a etapa registrada como pulada, não some do trace', async () => {
  await createEventTrigger(OWNER, AGENT, specComSinal({ source: 'acao', path: 'score', operator: 'equals', value: -1 }))
  await serieFechada(20)
  const [evento] = await eventoDeVela()
  await dispatchInternalEvent(evento)
  const run = await db.collection('automation_runs').findOne({ ownerId: OWNER })
  await processRun(run._id.toString())
  const sinal = (await db.collection('step_runs').find({ runId: run._id }).toArray()).find((p) => p.stepType === 'event.publish')
  assert.equal(sinal.status, 'skipped')
  assert.equal((await bus.listEvents(OWNER, { type: 'market.signal.detected' })).length, 0)
})

test('publicar o sinal duas vezes na mesma execução publica um fato só', async () => {
  await createEventTrigger(OWNER, AGENT, specComSinal(null))
  await serieFechada(20)
  const [evento] = await eventoDeVela()
  await dispatchInternalEvent(evento)
  const run = await db.collection('automation_runs').findOne({ ownerId: OWNER })
  await processRun(run._id.toString())
  // Uma repetição por retry não pode virar um segundo sinal: a chave é (execução, etapa).
  await processRun(run._id.toString()).catch(() => undefined)
  assert.equal((await bus.listEvents(OWNER, { type: 'market.signal.detected' })).length, 1)
})

// --- a corrente ---------------------------------------------------------------------------

test('a corrente de eventos é cortada antes de virar laço', async () => {
  await createEventTrigger(OWNER, AGENT, specDeMercado())
  await serieFechada(16)
  const [evento] = await eventoDeVela()
  const fundo = { ...evento, payload: { ...evento.payload, _chain: MAX_EVENT_CHAIN } }
  const r = await dispatchInternalEvent(fundo)
  assert.equal(r.runs, 0)
  // E não em silêncio: parar calado pareceria "nada aconteceu".
  assert.equal(r.skipped.length, 1)
  assert.match(r.skipped[0], /corrente/)
})
