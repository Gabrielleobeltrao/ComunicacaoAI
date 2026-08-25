// O MOTOR DE VELAS: aritmética, e só aritmética.
//
// Uma vela errada não parece errada — parece um número. Um RSI calculado sobre uma
// série com vela repetida, ou com a abertura do negócio que chegou primeiro em vez da
// do que aconteceu primeiro, devolve um valor plausível que alguém usa para decidir.
// Por isso tudo aqui é determinístico: relógio dado, negócios dados, resultado exato.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()

const { bucketStart, bucketEnd, bucketIsOver, TIMEFRAME_MS, AGGREGATES_TO } = await import('../dist/marketData/timeframes.js')
const store = await import('../dist/marketData/candleStore.js')
const engine = await import('../dist/marketData/engine.js')
const { readState } = await import('../dist/marketData/state.js')
const { ensureMarketStateIndexes } = await import('../dist/marketData/state.js')
const bus = await import('../dist/events/bus.js')
const { MARKET_SCHEMA_VERSION } = await import('../dist/marketData/types.js')
const { db, mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const K = {
  ownerId: 'dono-mercado',
  provider: 'corretora_teste',
  installationId: 'inst-1',
  environment: 'paper',
  symbol: 'PETR4',
}

const T0 = Date.parse('2026-03-10T14:00:00.000Z')
const negocio = (offsetMs, price, size = 100, tradeId = null) => ({
  symbol: K.symbol,
  price,
  size,
  at: new Date(T0 + offsetMs),
  tradeId,
})

before(async () => {
  await store.ensureCandleIndexes()
  await ensureMarketStateIndexes()
  await bus.ensureEventIndexes()
})

beforeEach(async () => {
  await db.collection('market_candles').deleteMany({})
  await db.collection('market_state').deleteMany({})
  await db.collection('platform_events').deleteMany({})
  bus.resetHandlers()
})

const velaDe = (tf, bucket) => store.findCandle(K, tf, bucket)

// --- os baldes -----------------------------------------------------------------------

test('o balde é alinhado em UTC, e o de um dia começa à meia-noite', () => {
  // Alinhar pelo fuso local faria o balde de 1D mudar de tamanho duas vezes por ano —
  // duas velas erradas por ano, sempre de madrugada, e ninguém descobre.
  assert.equal(bucketStart(Date.parse('2026-03-10T14:07:31.500Z'), '1m'), Date.parse('2026-03-10T14:07:00Z'))
  assert.equal(bucketStart(Date.parse('2026-03-10T14:07:31.500Z'), '5m'), Date.parse('2026-03-10T14:05:00Z'))
  assert.equal(bucketStart(Date.parse('2026-03-10T14:07:31.500Z'), '15m'), Date.parse('2026-03-10T14:00:00Z'))
  assert.equal(bucketStart(Date.parse('2026-03-10T14:07:31.500Z'), '1h'), Date.parse('2026-03-10T14:00:00Z'))
  assert.equal(bucketStart(Date.parse('2026-03-10T14:07:31.500Z'), '4h'), Date.parse('2026-03-10T12:00:00Z'))
  assert.equal(bucketStart(Date.parse('2026-03-10T14:07:31.500Z'), '1D'), Date.parse('2026-03-10T00:00:00Z'))
})

test('o balde só acabou quando o relógio passou do fim dele', () => {
  const inicio = Date.parse('2026-03-10T14:00:00Z')
  assert.equal(bucketEnd(inicio, '5m'), inicio + TIMEFRAME_MS['5m'])
  assert.equal(bucketIsOver(inicio, '5m', inicio + TIMEFRAME_MS['5m'] - 1), false)
  assert.equal(bucketIsOver(inicio, '5m', inicio + TIMEFRAME_MS['5m']), true)
})

// --- OHLCV ---------------------------------------------------------------------------

test('a vela de um minuto é o OHLCV exato dos negócios dela', async () => {
  await engine.ingestTrade(K, negocio(0, 10, 100))
  await engine.ingestTrade(K, negocio(10_000, 14, 50))
  await engine.ingestTrade(K, negocio(20_000, 8, 30))
  await engine.ingestTrade(K, negocio(30_000, 12, 20))

  const c = await velaDe('1m', T0)
  assert.equal(c.open, 10, 'abertura é o primeiro')
  assert.equal(c.high, 14)
  assert.equal(c.low, 8)
  assert.equal(c.close, 12, 'fechamento é o último')
  assert.equal(c.volume, 200)
  assert.equal(c.trades, 4)
  assert.equal(c.closed, false, 'a vela do minuto corrente ainda não fechou')
})

test('um negócio no minuto seguinte abre outra vela, e não continua a anterior', async () => {
  await engine.ingestTrade(K, negocio(0, 10))
  await engine.ingestTrade(K, negocio(65_000, 20))
  assert.equal((await velaDe('1m', T0)).close, 10)
  assert.equal((await velaDe('1m', T0 + 60_000)).open, 20)
})

test('negócio fora de ordem conserta a abertura, e não a deixa no que chegou primeiro', async () => {
  // O provider reenvia depois da reconexão e o mais antigo chega por último. A abertura
  // é do negócio que ACONTECEU primeiro, não do que chegou primeiro.
  await engine.ingestTrade(K, negocio(30_000, 12))
  const r = await engine.ingestTrade(K, negocio(5_000, 9))
  assert.equal(r, 'late')
  const c = await velaDe('1m', T0)
  assert.equal(c.open, 9)
  // E o resto não foi mexido: máxima, mínima e volume não dependem da ordem.
  assert.equal(c.high, 12)
  assert.equal(c.low, 9)
  assert.equal(c.volume, 200)
})

test('negócio atrasado para uma vela JÁ FECHADA é descartado', async () => {
  await engine.ingestTrade(K, negocio(0, 10))
  const agora = new Date(T0 + 61_000)
  await engine.closeDueCandles(agora)
  // Reabrir mudaria um número que já foi publicado como fato e que alguém pode ter
  // usado para decidir.
  assert.equal(await engine.ingestTrade(K, negocio(30_000, 99)), 'dropped')
  const c = await velaDe('1m', T0)
  assert.equal(c.high, 10)
  assert.equal(c.closed, true)
})

test('o último preço não anda para trás quando um dado atrasado chega', async () => {
  await engine.ingestTrade(K, negocio(30_000, 12))
  await engine.ingestTrade(K, negocio(5_000, 9))
  const estado = await readState(K)
  assert.equal(estado.price, 12, 'o último preço é o do fato mais recente, não o da última mensagem')
})

// --- fechar exatamente uma vez ---------------------------------------------------------

test('a vela fecha uma vez só, mesmo com dois workers varrendo juntos', async () => {
  await engine.ingestTrade(K, negocio(0, 10))
  const agora = new Date(T0 + 61_000)
  const [a, b] = await Promise.all([engine.closeDueCandles(agora), engine.closeDueCandles(agora)])
  assert.equal(a.closed + b.closed, 1, 'só um dos dois consegue fechar')
  assert.equal(a.published + b.published, 1, 'e só um publica')
})

test('a vela do minuto corrente NÃO fecha', async () => {
  await engine.ingestTrade(K, negocio(0, 10))
  // Publicar uma vela que ainda muda seria publicar um fato falso.
  const r = await engine.closeDueCandles(new Date(T0 + 30_000))
  assert.equal(r.closed, 0)
})

test('reiniciar no meio da publicação não gera um segundo evento da mesma vela', async () => {
  await engine.ingestTrade(K, negocio(0, 10))
  const agora = new Date(T0 + 61_000)
  await engine.closeDueCandles(agora)
  // Simula o restart: a vela volta a parecer aberta (o processo caiu antes do $set) e a
  // varredura roda de novo.
  await db.collection('market_candles').updateOne({ timeframe: '1m', bucketStart: T0 }, { $set: { closed: false } })
  await engine.closeDueCandles(agora)
  const eventos = await bus.listEvents(K.ownerId, { type: 'market.candle.closed' })
  assert.equal(eventos.length, 1, 'a chave de dedupe é a identidade da vela, não a hora do fechamento')
})

test('o evento publicado carrega a vela no contrato que o analisador já recebe', async () => {
  await engine.ingestTrade(K, negocio(0, 10, 100))
  await engine.ingestTrade(K, negocio(20_000, 14, 100))
  await engine.closeDueCandles(new Date(T0 + 61_000))
  const [evento] = await bus.listEvents(K.ownerId, { type: 'market.candle.closed' })
  assert.equal(evento.schemaVersion, MARKET_SCHEMA_VERSION)
  assert.equal(evento.payload.timeframe, '1m')
  assert.deepEqual(evento.payload.candle, { timestamp: T0, open: 10, high: 14, low: 10, close: 14, volume: 200, closed: true })
  // O fato aconteceu no início da vela, não quando a varredura passou.
  assert.equal(evento.occurredAt.getTime(), T0)
})

// --- agregação ----------------------------------------------------------------------

test('cinco velas de um minuto viram uma de cinco, com o OHLCV certo', async () => {
  const precos = [
    [10, 12, 9, 11],
    [11, 15, 10, 14],
    [14, 14, 7, 8],
    [8, 20, 8, 19],
    [19, 19, 17, 18],
  ]
  for (let minuto = 0; minuto < 5; minuto += 1) {
    const [o, h, l, c] = precos[minuto]
    const base = minuto * 60_000
    for (const [i, p] of [o, h, l, c].entries()) await engine.ingestTrade(K, negocio(base + i * 1_000, p, 10))
    await engine.closeDueCandles(new Date(T0 + base + 61_000))
  }
  const cinco = await velaDe('5m', T0)
  assert.equal(cinco.open, 10, 'abertura da primeira filha')
  assert.equal(cinco.high, 20, 'a maior de todas')
  assert.equal(cinco.low, 7, 'a menor de todas')
  assert.equal(cinco.close, 18, 'fechamento da última filha')
  assert.equal(cinco.volume, 200, 'a soma dos volumes')
})

test('a vela de cinco minutos fecha sozinha quando o balde acaba, e publica', async () => {
  for (let minuto = 0; minuto < 5; minuto += 1) {
    await engine.ingestTrade(K, negocio(minuto * 60_000, 10 + minuto, 10))
    await engine.closeDueCandles(new Date(T0 + minuto * 60_000 + 61_000))
  }
  const r = await engine.closeDueCandles(new Date(T0 + 5 * 60_000 + 1))
  assert.ok(r.closed >= 1)
  const eventos = await bus.listEvents(K.ownerId, { type: 'market.candle.closed' })
  assert.ok(eventos.some((e) => e.payload.timeframe === '5m'))
  assert.equal((await velaDe('5m', T0)).closed, true)
})

test('as filhas dobradas fora de ordem ainda dão a abertura e o fechamento certos', async () => {
  // Depois de um restart as velas fechadas podem ser dobradas em qualquer ordem.
  const filha = (minuto, o, h, l, c) => ({
    ownerId: K.ownerId,
    provider: K.provider,
    installationId: K.installationId,
    environment: K.environment,
    symbol: K.symbol,
    timeframe: '1m',
    bucketStart: T0 + minuto * 60_000,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 10,
    trades: 1,
    closed: true,
  })
  await store.foldChild(K, filha(2, 14, 16, 13, 15))
  await store.foldChild(K, filha(0, 10, 11, 9, 10))
  await store.foldChild(K, filha(1, 10, 12, 8, 14))
  const cinco = await velaDe('5m', T0)
  assert.equal(cinco.open, 10, 'a abertura é da filha mais antiga, não da primeira dobrada')
  assert.equal(cinco.close, 15, 'o fechamento é da filha mais recente')
  assert.equal(cinco.high, 16)
  assert.equal(cinco.low, 8)
})

test('a cadeia de agregação sobe até o dia', () => {
  // Cada timeframe é montado do imediatamente menor: montar 1h direto de 1m custaria
  // sessenta dobras para o mesmo resultado.
  assert.deepEqual(AGGREGATES_TO['1m'], ['5m'])
  assert.deepEqual(AGGREGATES_TO['15m'], ['1h'])
  assert.deepEqual(AGGREGATES_TO['1h'], ['4h', '1D'])
  assert.deepEqual(AGGREGATES_TO['1D'], [])
})

// --- contrato -------------------------------------------------------------------------

test('payload incompatível é recusado, não saneado', async () => {
  const base = { ownerId: K.ownerId, provider: K.provider, installationId: K.installationId, environment: K.environment }
  const casos = [
    [{ ...base, symbol: 'PETR4', price: '38.4', at: new Date().toISOString() }, /price/],
    [{ ...base, symbol: '', price: 10, at: new Date().toISOString() }, /symbol/],
    [{ ...base, symbol: 'PETR4', price: 10, at: 'ontem' }, /at/],
    [{ symbol: 'PETR4', price: 10, at: new Date().toISOString() }, /ownerId/],
  ]
  for (const [payload, esperado] of casos) {
    assert.throws(() => engine.parseTradeEvent({ payload, schemaVersion: MARKET_SCHEMA_VERSION }), esperado)
  }
  // Versão desconhecida não é "parecida o suficiente".
  assert.throws(() => engine.parseTradeEvent({ payload: {}, schemaVersion: 99 }), /versão/)
})

test('um evento cujo payload é de outro dono não entra na série', async () => {
  engine.registerMarketDataHandlers()
  await bus.publishEvent({
    ownerId: 'dono-a',
    type: 'market.price.updated',
    source: 'teste',
    schemaVersion: MARKET_SCHEMA_VERSION,
    payload: { ...K, ownerId: 'dono-b', price: 10, size: 1, at: new Date(T0).toISOString() },
    dedupeKey: 'cruzado',
  })
  const evento = await bus.claimNextEvent('w1')
  assert.equal(await bus.processEvent(evento), 'pending', 'recusado: dado não atravessa de dono')
  assert.equal(await db.collection('market_candles').countDocuments({}), 0)
})

test('o caminho completo: evento no barramento vira vela', async () => {
  engine.registerMarketDataHandlers()
  await bus.publishEvent({
    ownerId: K.ownerId,
    type: 'market.price.updated',
    source: 'teste',
    schemaVersion: MARKET_SCHEMA_VERSION,
    payload: { ...K, price: 38.4, size: 100, at: new Date(T0).toISOString(), tradeId: 'abc' },
    dedupeKey: 'trade:abc',
  })
  const evento = await bus.claimNextEvent('w1')
  assert.equal(await bus.processEvent(evento), 'done')
  assert.equal((await velaDe('1m', T0)).close, 38.4)
})

// --- o que esta camada NÃO faz ----------------------------------------------------------

test('nenhum arquivo do motor de mercado chama modelo nem toca memória de agente', () => {
  // O critério é "zero token". Um `import` de LLM aqui seria pagar por uma soma — e
  // dado de mercado entrando sozinho na memória do agente seria histórico virando
  // contexto sem ninguém ter pedido.
  const dir = new URL('../src/marketData/', import.meta.url)
  const proibidos = [/from '\.\.\/llm\.js'/, /from '\.\.\/claude\.js'/, /from '\.\.\/openai\.js'/, /from '\.\.\/memory\//, /agentRuntime/]
  for (const arquivo of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const fonte = readFileSync(new URL(arquivo, dir), 'utf8')
    for (const proibido of proibidos) {
      assert.ok(!proibido.test(fonte), `${arquivo} não pode importar ${proibido}`)
    }
  }
})

test('o tick cru fica desligado a menos que alguém diga quantos guardar', async () => {
  const { rawTicksEnabled, rawTickLimit } = await import('../dist/marketData/ticks.js')
  // Sem limite não há armazenamento: é a diferença entre "ligado" e "ligado até
  // encher o banco".
  assert.equal(rawTicksEnabled(), false)
  assert.equal(rawTickLimit(), 0)
})

// --- entrega para o analisador ----------------------------------------------------------

test('a série fechada é aceita pelo App de análise sem nenhuma conversão', async () => {
  // A prova de que não há um segundo formato de vela: o que o motor entrega passa pelo
  // validador do próprio analisador, que é rigoroso de propósito.
  const { parseSeries } = await import('../dist/apps/official/candle-analyzer/candles.js')
  for (let minuto = 0; minuto < 20; minuto += 1) {
    const base = minuto * 60_000
    await engine.ingestTrade(K, negocio(base, 10 + minuto, 10))
    await engine.ingestTrade(K, negocio(base + 30_000, 11 + minuto, 10))
    await engine.closeDueCandles(new Date(T0 + base + 61_000))
  }
  const serie = await engine.seriesForAnalysis(K.ownerId, { symbol: K.symbol, timeframe: '1m' })
  assert.ok(serie.length >= 15, 'o analisador exige série mínima')
  // Do mais antigo para o mais novo, que é a ordem que ele espera.
  assert.ok(serie[0].timestamp < serie[serie.length - 1].timestamp)
  const parsed = parseSeries(serie)
  assert.equal(parsed.candles.length, serie.length)
  assert.ok(parsed.candles.every((c) => c.closed))
})
