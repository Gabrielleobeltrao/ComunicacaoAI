// O HISTÓRICO GENÉRICO, com Mongo de verdade.
//
// O motor não sabe o que é preço, estoque ou sensor: ele recebe fatos e regras. Por
// isso metade destes testes é de mercado e a outra metade não é — se o mesmo mecanismo
// não servir para pedido e para cotação sem uma linha de código diferente, ele não é
// genérico, é um motor de vela com outro nome.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.DATA_HISTORY_MIN_INTERVAL_MS = '1000'
process.env.DATA_HISTORY_CACHE_MS = '0'

const { mongoClient, db } = await import('../dist/db.js')
const store = await import('../dist/dataHistory/store.js')
const { criarRecorder, normalizarRecorder, listarRecorders, apagarRecorder, atualizarRecorder } = await import('../dist/dataHistory/recorders.js')
const engine = await import('../dist/dataHistory/engine.js')
const janelas = await import('../dist/dataHistory/windows.js')

const DONO = 'dono-historico'
const OUTRO = 'outro-dono'

before(async () => {
  await store.ensureDataHistoryIndexes()
})
after(async () => {
  await mongoClient.close()
  await stopMongo()
})
beforeEach(async () => {
  for (const c of ['data_recorders', 'data_history_records', 'data_history_windows']) await db.collection(c).deleteMany({})
  engine.limparCacheDeRecorders()
})

const criar = (extra = {}, dono = DONO) =>
  criarRecorder(dono, {
    name: 'histórico de teste',
    source: { kind: 'manual', ref: 'teste' },
    mode: 'every_event',
    ...extra,
  })

const fato = (valor, quando, extra = {}) => ({
  ownerId: DONO,
  sourceKey: 'manual:teste',
  entityKey: null,
  occurredAt: quando instanceof Date ? quando : new Date(quando),
  value: valor,
  ...extra,
})

const registros = (filtro = {}) => db.collection('data_history_records').find(filtro).sort({ occurredAt: 1 }).toArray()

// --- os modos ----------------------------------------------------------------------

test('every_event grava toda ocorrência aceita', async () => {
  await criar()
  for (const p of [10, 11, 12]) await engine.ingestFact(fato({ price: p }, Date.now() + p))
  const rs = await registros()
  assert.equal(rs.length, 3)
  assert.deepEqual(rs.map((r) => r.value.price), [10, 11, 12])
  // O que aconteceu e o que gravamos são coisas diferentes, e ficam separadas.
  assert.ok(rs[0].occurredAt instanceof Date && rs[0].recordedAt instanceof Date)
})

test('on_change grava só quando o valor observado muda', async () => {
  await criar({ mode: 'on_change', changePath: 'status' })
  const base = Date.now()
  await engine.ingestFact(fato({ status: 'ok', ruido: 1 }, base))
  await engine.ingestFact(fato({ status: 'ok', ruido: 2 }, base + 10))
  await engine.ingestFact(fato({ status: 'falhou', ruido: 3 }, base + 20))
  await engine.ingestFact(fato({ status: 'falhou', ruido: 4 }, base + 30))
  const rs = await registros()
  assert.deepEqual(rs.map((r) => r.value.status), ['ok', 'falhou'], 'ruído no resto do objeto não conta como mudança')
})

test('condition e filtros: só o que casa vira histórico', async () => {
  await criar({ mode: 'condition', filters: [{ path: 'qty', operator: 'lt', value: 10 }] })
  const base = Date.now()
  await engine.ingestFact(fato({ sku: 'A', qty: 3 }, base))
  await engine.ingestFact(fato({ sku: 'A', qty: 50 }, base + 1))
  const rs = await registros()
  assert.equal(rs.length, 1)
  assert.equal(rs[0].value.qty, 3)
})

test('campos escolhidos: o resto do payload não é guardado', async () => {
  await criar({ selectedFields: ['sku', 'qty'] })
  await engine.ingestFact(fato({ sku: 'A', qty: 3, interno: { token: 'nao-deve-ficar' } }, Date.now()))
  const [r] = await registros()
  assert.deepEqual(Object.keys(r.value).sort(), ['qty', 'sku'])
})

// --- agregação -----------------------------------------------------------------------

const comJanela = (extra = {}) =>
  criar({
    mode: 'window_aggregate',
    intervalMs: 60_000,
    entityKeyPath: 'symbol',
    occurredAtPath: 'at',
    aggregations: [
      { from: 'price', op: 'first', to: 'open' },
      { from: 'price', op: 'max', to: 'high' },
      { from: 'price', op: 'min', to: 'low' },
      { from: 'price', op: 'last', to: 'close' },
      { from: 'volume', op: 'sum', to: 'volume' },
      { from: 'price', op: 'avg', to: 'media' },
      { from: '', op: 'count', to: 'tiques' },
    ],
    ...extra,
  })

test('as sete operações produzem o mesmo que uma vela — sem o motor saber o que é vela', async () => {
  const rec = await comJanela()
  const t0 = Date.parse('2026-01-01T10:00:00.000Z')
  const tiques = [
    { at: t0 + 5_000, price: 100, volume: 10 },
    { at: t0 + 20_000, price: 110, volume: 5 },
    { at: t0 + 40_000, price: 98, volume: 7 },
    { at: t0 + 55_000, price: 108, volume: 3 },
  ]
  for (const t of tiques) await engine.ingestFact(fato({ symbol: 'BTCUSDT', ...t, at: new Date(t.at).toISOString() }, t.at))

  const fechado = await engine.closeDueWindows(new Date(t0 + 120_000))
  assert.equal(fechado.gravadas, 1)

  const [r] = await registros()
  assert.equal(r.entityKey, 'BTCUSDT')
  assert.equal(r.value.open, 100)
  assert.equal(r.value.high, 110)
  assert.equal(r.value.low, 98)
  assert.equal(r.value.close, 108)
  assert.equal(r.value.volume, 25)
  assert.equal(r.value.tiques, 4)
  assert.equal(r.value.media, (100 + 110 + 98 + 108) / 4)
  assert.equal(r.windowStart.getTime(), t0)
  assert.equal(r.windowEnd.getTime(), t0 + 60_000)
  void rec
})

test('o mesmo motor agrega PEDIDOS por hora — nada de mercado envolvido', async () => {
  await criar({
    mode: 'window_aggregate',
    intervalMs: 3_600_000,
    entityKeyPath: 'loja',
    occurredAtPath: 'criadoEm',
    aggregations: [
      { from: 'total', op: 'sum', to: 'faturamento' },
      { from: '', op: 'count', to: 'pedidos' },
      { from: 'total', op: 'avg', to: 'ticketMedio' },
      { from: 'total', op: 'max', to: 'maiorPedido' },
    ],
  })
  const h0 = Date.parse('2026-03-02T13:00:00.000Z')
  const pedidos = [
    { loja: 'centro', total: 80, criadoEm: new Date(h0 + 60_000).toISOString() },
    { loja: 'centro', total: 120, criadoEm: new Date(h0 + 900_000).toISOString() },
    { loja: 'bairro', total: 40, criadoEm: new Date(h0 + 120_000).toISOString() },
  ]
  for (const p of pedidos) await engine.ingestFact(fato(p, Date.parse(p.criadoEm)))
  await engine.closeDueWindows(new Date(h0 + 7_200_000))

  const rs = await registros()
  assert.equal(rs.length, 2, 'uma janela por loja')
  const centro = rs.find((r) => r.entityKey === 'centro')
  assert.equal(centro.value.faturamento, 200)
  assert.equal(centro.value.pedidos, 2)
  assert.equal(centro.value.ticketMedio, 100)
  assert.equal(centro.value.maiorPedido, 120)
  const bairro = rs.find((r) => r.entityKey === 'bairro')
  assert.equal(bairro.value.pedidos, 1)
})

test('fora de ordem: first e last vêm do occurredAt, não da chegada', async () => {
  await comJanela()
  const t0 = Date.parse('2026-01-01T10:00:00.000Z')
  // Chega o do MEIO, depois o mais NOVO, e só então o mais ANTIGO.
  const ordemDeChegada = [
    { at: t0 + 30_000, price: 105 },
    { at: t0 + 50_000, price: 108 },
    { at: t0 + 1_000, price: 100 },
  ]
  for (const t of ordemDeChegada) {
    await engine.ingestFact(fato({ symbol: 'BTCUSDT', price: t.price, volume: 1, at: new Date(t.at).toISOString() }, t.at))
  }
  await engine.closeDueWindows(new Date(t0 + 120_000))
  const [r] = await registros()
  assert.equal(r.value.open, 100, 'abriu no mais ANTIGO, que chegou por último')
  assert.equal(r.value.close, 108, 'fechou no mais NOVO')
  assert.equal(r.value.high, 108)
  assert.equal(r.value.low, 100)
})

test('atrasado enquanto a janela está aberta entra; depois de fechada, não', async () => {
  await comJanela()
  const t0 = Date.parse('2026-01-01T10:00:00.000Z')
  await engine.ingestFact(fato({ symbol: 'X', price: 100, volume: 1, at: new Date(t0 + 30_000).toISOString() }, t0 + 30_000))
  // Atrasado, mas a janela ainda não fechou.
  await engine.ingestFact(fato({ symbol: 'X', price: 90, volume: 1, at: new Date(t0 + 10_000).toISOString() }, t0 + 10_000))

  await engine.closeDueWindows(new Date(t0 + 120_000))
  const [r] = await registros()
  assert.equal(r.value.low, 90, 'o atrasado entrou')

  // Agora tarde demais: a janela já virou fato consumado e não reabre.
  const antes = await registros()
  await engine.ingestFact(fato({ symbol: 'X', price: 1, volume: 1, at: new Date(t0 + 20_000).toISOString() }, t0 + 20_000))
  const depois = await registros()
  assert.deepEqual(
    depois.map((d) => d.value),
    antes.map((a) => a.value),
    'uma janela fechada não muda',
  )
})

test('fechar duas vezes — ou por dois workers — grava um registro só', async () => {
  await comJanela()
  const t0 = Date.parse('2026-01-01T10:00:00.000Z')
  await engine.ingestFact(fato({ symbol: 'X', price: 5, volume: 1, at: new Date(t0 + 1_000).toISOString() }, t0 + 1_000))

  const agora = new Date(t0 + 120_000)
  // Dois workers varrendo ao mesmo tempo, de verdade — não em sequência.
  const [a, b] = await Promise.all([engine.closeDueWindows(agora), engine.closeDueWindows(agora)])
  assert.equal(a.gravadas + b.gravadas, 1, `gravaram ${a.gravadas + b.gravadas}`)
  assert.equal((await registros()).length, 1)

  // E uma terceira passada não inventa outro.
  await engine.closeDueWindows(new Date(t0 + 180_000))
  assert.equal((await registros()).length, 1)
})

test('restart no meio: a janela fechada e não gravada é recuperada', async () => {
  await comJanela()
  const t0 = Date.parse('2026-01-01T10:00:00.000Z')
  await engine.ingestFact(fato({ symbol: 'X', price: 7, volume: 2, at: new Date(t0 + 1_000).toISOString() }, t0 + 1_000))

  // Simula a queda ENTRE fechar e gravar: a janela fica fechada e sem registro.
  const aberta = await db.collection('data_history_windows').findOne({})
  await janelas.fecharJanela(aberta._id, new Date(t0 + 60_001))
  assert.equal((await registros()).length, 0, 'nada gravado ainda')

  // A varredura seguinte — depois do "restart" — termina o trabalho.
  const r = await engine.closeDueWindows(new Date(t0 + 120_000))
  assert.equal(r.gravadas, 1)
  assert.equal((await registros()).length, 1)
})

test('a janela acumula NO BANCO: o estado sobrevive a perder a memória do processo', async () => {
  await comJanela()
  const t0 = Date.parse('2026-01-01T10:00:00.000Z')
  await engine.ingestFact(fato({ symbol: 'X', price: 10, volume: 1, at: new Date(t0 + 1_000).toISOString() }, t0 + 1_000))
  const doc = await db.collection('data_history_windows').findOne({})
  assert.equal(doc.count, 1)
  assert.equal(doc.acc.high.max, 10)
  assert.equal(doc.firsts.open, 10)
})

// --- idempotência, cota e isolamento --------------------------------------------------

test('o mesmo fato entregue duas vezes grava uma vez', async () => {
  await criar()
  const quando = Date.now()
  const f = fato({ price: 1 }, quando, { factId: 'evento-123' })
  await engine.ingestFact(f)
  await engine.ingestFact(f)
  assert.equal((await registros()).length, 1)
})

test('cada dono só vê o próprio histórico', async () => {
  await criar()
  await criar({}, OUTRO)
  await engine.ingestFact(fato({ price: 1 }, Date.now()))
  await engine.ingestFact({ ...fato({ price: 2 }, Date.now()), ownerId: OUTRO, sourceKey: 'manual:teste' })

  const meus = await store.listarRegistros(DONO, { recorderId: (await listarRecorders(DONO))[0]._id })
  assert.equal(meus.length, 1)
  assert.equal(meus[0].value.price, 1)

  // E a listagem do outro dono não traz o meu recorder.
  const dele = await listarRecorders(OUTRO)
  assert.equal(dele.length, 1)
  assert.notEqual(dele[0]._id.toString(), (await listarRecorders(DONO))[0]._id.toString())
})

test('payload grande ou fundo demais é recusado, não cortado pela metade', async () => {
  await criar()
  await engine.ingestFact(fato({ texto: 'x'.repeat(40_000) }, Date.now()))
  assert.equal((await registros()).length, 0, 'grande demais não grava')

  // Profundo demais: o que passa do teto vira nulo, e o resto continua utilizável.
  let fundo = { fim: 'chegou' }
  for (let i = 0; i < 30; i += 1) fundo = { nivel: fundo }
  await engine.ingestFact(fato(fundo, Date.now()))
  const rs = await registros()
  assert.equal(rs.length, 1)
  assert.ok(JSON.stringify(rs[0].value).length < 500)
})

test('caminho que mexe no protótipo é recusado na configuração', async () => {
  await assert.rejects(() => criar({ entityKeyPath: '__proto__' }), /não permitido|caminho/)
  await assert.rejects(() => criar({ selectedFields: ['constructor'] }), /não permitido|caminho/)
})

test('retenção vira TTL no documento', async () => {
  await criar({ retentionDays: 2 })
  await engine.ingestFact(fato({ a: 1 }, Date.now()))
  const [r] = await registros()
  assert.ok(r.expiresAt instanceof Date)
  const dias = (r.expiresAt.getTime() - r.recordedAt.getTime()) / 86_400_000
  assert.ok(Math.abs(dias - 2) < 0.01, `expira em ${dias} dias`)
})

// --- snapshots -------------------------------------------------------------------------

test('snapshot_interval grava o último valor uma vez por intervalo', async () => {
  await criar({ mode: 'snapshot_interval', intervalMs: 60_000, entityKeyPath: 'sensor' })
  const t0 = Date.parse('2026-01-01T10:00:00.000Z')
  await engine.ingestFact(fato({ sensor: 'sala', temp: 21 }, t0 + 1_000))
  await engine.ingestFact(fato({ sensor: 'sala', temp: 22 }, t0 + 2_000))

  const agora = new Date(t0 + 30_000)
  assert.equal((await engine.runDueSnapshots(agora)).gravados, 1)
  // Duas passadas no MESMO intervalo gravam uma linha só.
  assert.equal((await engine.runDueSnapshots(new Date(t0 + 45_000))).gravados, 0)
  const rs = await registros()
  assert.equal(rs.length, 1)
  assert.equal(rs[0].value.temp, 22, 'o último valor conhecido')

  // O intervalo seguinte grava de novo.
  assert.equal((await engine.runDueSnapshots(new Date(t0 + 61_000))).gravados, 1)
})

test('schedule_snapshot grava uma vez por dia, na hora marcada', async () => {
  await criar({ mode: 'schedule_snapshot', schedule: { hour: 3, minute: 30 }, entityKeyPath: 'sku' })
  const dia = Date.parse('2026-05-05T00:00:00.000Z')
  await engine.ingestFact(fato({ sku: 'A', estoque: 12 }, dia + 3_600_000))

  // Antes da hora: nada.
  assert.equal((await engine.runDueSnapshots(new Date(dia + 2 * 3_600_000))).gravados, 0)
  // Depois: grava, e só uma vez.
  assert.equal((await engine.runDueSnapshots(new Date(dia + 4 * 3_600_000))).gravados, 1)
  assert.equal((await engine.runDueSnapshots(new Date(dia + 5 * 3_600_000))).gravados, 0)
  const [r] = await registros()
  assert.equal(r.value.estoque, 12)
  assert.equal(new Date(r.occurredAt).toISOString(), '2026-05-05T03:30:00.000Z')
})

// --- leitura ---------------------------------------------------------------------------

test('a agregação sobre o histórico gravado é feita pelo banco', async () => {
  const rec = await criar()
  const t0 = Date.parse('2026-02-01T00:00:00.000Z')
  for (const [i, v] of [10, 30, 20].entries()) await engine.ingestFact(fato({ valor: v }, t0 + i * 1000))

  const r = await store.agregarRegistros(DONO, { recorderId: rec._id }, [
    { from: 'valor', op: 'first', to: 'primeiro' },
    { from: 'valor', op: 'last', to: 'ultimo' },
    { from: 'valor', op: 'min', to: 'minimo' },
    { from: 'valor', op: 'max', to: 'maximo' },
    { from: 'valor', op: 'avg', to: 'media' },
    { from: 'valor', op: 'sum', to: 'soma' },
    { from: '', op: 'count', to: 'quantos' },
  ])
  assert.equal(r.primeiro, 10)
  assert.equal(r.ultimo, 20)
  assert.equal(r.minimo, 10)
  assert.equal(r.maximo, 30)
  assert.equal(r.media, 20)
  assert.equal(r.soma, 60)
  assert.equal(r.quantos, 3)
})

test('a série vem por período e por chave', async () => {
  const rec = await criar({ entityKeyPath: 'sku' })
  const t0 = Date.parse('2026-02-01T00:00:00.000Z')
  await engine.ingestFact(fato({ sku: 'A', v: 1 }, t0))
  await engine.ingestFact(fato({ sku: 'B', v: 2 }, t0 + 1000))
  await engine.ingestFact(fato({ sku: 'A', v: 3 }, t0 + 2000))

  const soA = await store.listarRegistros(DONO, { recorderId: rec._id, entityKey: 'A', order: 'asc' })
  assert.deepEqual(soA.map((r) => r.value.v), [1, 3])

  const janela = await store.listarRegistros(DONO, { recorderId: rec._id, from: new Date(t0 + 500), to: new Date(t0 + 1500) })
  assert.equal(janela.length, 1)
  assert.equal(janela[0].value.v, 2)
})

// --- validação e cotas ------------------------------------------------------------------

test('a validação recusa o que o motor não saberia executar', async () => {
  assert.throws(() => normalizarRecorder({ name: 'x', source: { kind: 'manual', ref: 'r' }, mode: 'window_aggregate', intervalMs: 60_000 }), /agregação/)
  assert.throws(() => normalizarRecorder({ name: 'x', source: { kind: 'manual', ref: 'r' }, mode: 'snapshot_interval', intervalMs: 5 }), /intervalo/)
  assert.throws(() => normalizarRecorder({ name: 'x', source: { kind: 'nao_existe', ref: 'r' }, mode: 'every_event' }), /fonte/)
  assert.throws(() => normalizarRecorder({ name: 'x', source: { kind: 'manual', ref: 'r' }, mode: 'every_event', retentionDays: 9999 }), /retenção/)
})

test('desligado não grava, e apagar leva o histórico junto', async () => {
  const rec = await criar()
  await engine.ingestFact(fato({ a: 1 }, Date.now()))
  assert.equal((await registros()).length, 1)

  await atualizarRecorder(DONO, rec._id, { enabled: false })
  engine.limparCacheDeRecorders()
  await engine.ingestFact(fato({ a: 2 }, Date.now() + 1))
  assert.equal((await registros()).length, 1, 'desligado não grava')

  await apagarRecorder(DONO, rec._id)
  assert.equal((await registros()).length, 0, 'apagar o histórico apaga os registros')
})

test('um recorder de OUTRO dono não é encontrado pelo id', async () => {
  const rec = await criar({}, OUTRO)
  assert.equal(await atualizarRecorder(DONO, rec._id, { name: 'sequestrado' }), null)
  assert.equal(await apagarRecorder(DONO, rec._id), false)
})

// --- integração com o que já existia ------------------------------------------------

test('um evento do barramento vira histórico, sem tipo de evento novo', async () => {
  const { publishEvent, claimNextEvent, processEvent, resetHandlers } = await import('../dist/events/bus.js')
  const { registerDataHistoryHandlers } = await import('../dist/dataHistory/engine.js')
  const { ensureEventIndexes } = await import('../dist/events/bus.js')
  await ensureEventIndexes()
  resetHandlers()
  registerDataHistoryHandlers()

  await criarRecorder(DONO, {
    name: 'candles do mercado',
    // A fonte é um tipo de evento que JÁ existia — o motor de mercado continua dono
    // dele, e o histórico só escuta.
    source: { kind: 'event', ref: 'market.candle.closed' },
    mode: 'every_event',
    entityKeyPath: 'symbol',
    selectedFields: ['symbol', 'close'],
  })
  engine.limparCacheDeRecorders()

  const { event } = await publishEvent({
    ownerId: DONO,
    type: 'market.candle.closed',
    source: 'candle-engine',
    payload: { symbol: 'PETR4', close: 38.4, open: 37 },
    dedupeKey: 'vela-1',
    occurredAt: new Date('2026-01-05T10:00:00.000Z'),
  })
  await processEvent(event)

  const rs = await registros()
  assert.equal(rs.length, 1)
  assert.equal(rs[0].entityKey, 'PETR4')
  assert.deepEqual(Object.keys(rs[0].value).sort(), ['close', 'symbol'])
  assert.equal(rs[0].occurredAt.toISOString(), '2026-01-05T10:00:00.000Z', 'o tempo do FATO, não o da gravação')

  // E o motor de mercado continua funcionando: o evento dele não foi consumido nem
  // alterado por nós — reprocessar não duplica.
  await processEvent(event)
  assert.equal((await registros()).length, 1)
  void claimNextEvent
  resetHandlers()
})

test('o Live Data alimenta o histórico sem virar histórico', async () => {
  const liveData = await import('../dist/integrations/websocket/liveData.js')
  await liveData.ensureLiveDataIndexes()
  liveData.resetLiveBuffer()

  await criarRecorder(DONO, {
    name: 'preço quando muda',
    source: { kind: 'live_data', ref: 'conexao-1' },
    mode: 'on_change',
    changePath: 'price',
  })
  engine.limparCacheDeRecorders()

  // Instantes explícitos: três tiques no mesmo milissegundo empatam em `occurredAt`, e
  // aí qual deles é "o primeiro" não tem resposta — nem deveria ter.
  // Perto de agora: o Live Data tem TTL, e um instante do mês passado nasceria vencido.
  const t0 = new Date(Date.now() - 2_000)
  await liveData.putLiveValue(DONO, 'conexao-1', 'BTCUSDT', { price: 100 }, 60, t0)
  await liveData.putLiveValue(DONO, 'conexao-1', 'BTCUSDT', { price: 100 }, 60, new Date(t0.getTime() + 1_000))
  await liveData.putLiveValue(DONO, 'conexao-1', 'BTCUSDT', { price: 101 }, 60, new Date(t0.getTime() + 2_000))
  // O aviso é disparado SEM espera — o caminho quente do dado ao vivo não pode ficar
  // atrás de uma regra de histórico. Então os três correm juntos, e o que se garante
  // aqui é o que o motor promete nessa condição: nada duplicado, nada mais velho
  // sobrescrevendo o mais novo, e o valor final igual ao que está ao vivo. A ordem
  // determinística do `on_change` é exercitada no teste que entrega fato a fato.
  for (let i = 0; i < 40 && (await registros()).length === 0; i += 1) await new Promise((r) => setTimeout(r, 25))
  await new Promise((r) => setTimeout(r, 100))

  const rs = await registros()
  assert.ok(rs.length >= 1 && rs.length <= 2, `gravou ${rs.length}: ${JSON.stringify(rs.map((r) => r.value))}`)
  assert.equal(rs.at(-1).value.price, 101, 'o mais recente é o que vale')
  assert.equal(rs[0].entityKey, 'BTCUSDT')
  // O tique repetido nunca vira registro — é isto que `on_change` promete.
  assert.ok(!rs.some((r, i) => i > 0 && r.value.price === rs[i - 1].value.price), 'nenhum valor repetido em sequência')

  // E o Live Data continua sendo só o valor de agora: uma chave, um valor, com TTL.
  await liveData.flushLiveData()
  const vivo = await liveData.getLiveValue(DONO, 'conexao-1', 'BTCUSDT')
  assert.equal(vivo.value.price, 101)
  assert.equal(await db.collection('live_data').countDocuments({}), 1, 'o Live Data não virou série')
})

test('as tools leem o histórico, e não calculam com modelo nenhum', async () => {
  const { executeRegisteredFunction } = await import('../dist/executors/functionExecutor.js')
  const rec = await criar({ entityKeyPath: 'sku' })
  const t0 = Date.parse('2026-04-01T00:00:00.000Z')
  for (const [i, v] of [5, 9, 7].entries()) await engine.ingestFact(fato({ sku: 'A', qty: v }, t0 + i * 60_000))

  const ctx = { ownerId: DONO }
  const bruto = await executeRegisteredFunction({ kind: 'function', functionName: 'data_history.latest' }, { recorderId: rec._id.toString(), entityKey: 'A' }, ctx)
  assert.equal(bruto.ok, true, JSON.stringify(bruto.error))
  const ultimo = bruto.structured.data
  assert.equal(ultimo.found, true)
  assert.equal(ultimo.record.value.qty, 7)

  const faixa = (await executeRegisteredFunction({ kind: 'function', functionName: 'data_history.range' }, { recorderId: rec._id.toString(), entityKey: 'A', order: 'asc' }, ctx)).structured.data
  assert.deepEqual(faixa.records.map((r) => r.value.qty), [5, 9, 7])

  const agregado = (await executeRegisteredFunction({ kind: 'function', functionName: 'data_history.aggregate' }, {
      recorderId: rec._id.toString(),
      entityKey: 'A',
      aggregations: [
        { from: 'qty', op: 'min', to: 'minimo' },
        { from: 'qty', op: 'max', to: 'maximo' },
        { from: 'qty', op: 'avg', to: 'media' },
        { from: '', op: 'count', to: 'quantos' },
      ],
    },
    ctx,
  )).structured.data
  assert.equal(agregado.result.minimo, 5)
  assert.equal(agregado.result.maximo, 9)
  assert.equal(agregado.result.media, 7)
  assert.equal(agregado.result.quantos, 3)

  const serie = (await executeRegisteredFunction({ kind: 'function', functionName: 'data_history.series' }, { recorderId: rec._id.toString(), entityKey: 'A', field: 'qty' }, ctx)).structured.data
  assert.deepEqual(serie.points.map((p) => p.value), [5, 9, 7])
  assert.ok(serie.points.every((p) => typeof p.at === 'string'))
})

test('a tool de outro dono não lê o meu histórico', async () => {
  const { executeRegisteredFunction } = await import('../dist/executors/functionExecutor.js')
  const rec = await criar()
  await engine.ingestFact(fato({ a: 1 }, Date.now()))
  const r = (await executeRegisteredFunction({ kind: 'function', functionName: 'data_history.range' }, { recorderId: rec._id.toString() }, { ownerId: OUTRO })).structured.data
  assert.equal(r.count, 0, 'o dono está no filtro, sempre')
})

test('sem dono na execução, a tool recusa em vez de vazar', async () => {
  const { executeRegisteredFunction } = await import('../dist/executors/functionExecutor.js')
  const rec = await criar()
  const r = await executeRegisteredFunction({ kind: 'function', functionName: 'data_history.latest' }, { recorderId: rec._id.toString() }, {})
  assert.equal(r.ok, false)
  assert.match(String(r.error.message ?? ''), /dono/)
})

test('o motor de mercado continua intacto — o histórico só escuta', async () => {
  // O `marketData` é o especialista: trade, cotação e vela com semântica de verdade.
  // O histórico genérico não o substitui nem o conhece — ele consome o evento que o
  // outro publica, como consumiria qualquer outro.
  const { bucketStart, TIMEFRAME_MS } = await import('../dist/marketData/timeframes.js')
  const { foldTrade, closeCandle, ensureCandleIndexes } = await import('../dist/marketData/candleStore.js')
  await ensureCandleIndexes()
  await db.collection('market_candles').deleteMany({})

  const chave = { ownerId: DONO, provider: 'teste', installationId: 'i1', environment: 'paper', symbol: 'PETR4' }
  const t0 = new Date('2026-07-01T10:00:00.000Z')
  await foldTrade(chave, { price: 30, size: 100, at: t0 })
  await foldTrade(chave, { price: 32, size: 50, at: new Date(t0.getTime() + 10_000) })

  const vela = await db.collection('market_candles').findOne({})
  assert.equal(vela.open, 30)
  assert.equal(vela.high, 32)
  assert.equal(vela.volume, 150)
  assert.ok(await closeCandle(vela._id), 'a vela fecha pelo caminho de sempre')
  assert.equal(bucketStart(t0, '1m') % TIMEFRAME_MS['1m'], 0)

  // E as duas coleções são separadas: nada do histórico genérico encostou nas velas.
  assert.equal(await db.collection('data_history_records').countDocuments({}), 0)
})

test('quotas: o recorder para de gravar ao bater o teto', async () => {
  const rec = await criar()
  await db.collection('data_recorders').updateOne({ _id: rec._id }, { $set: { recordCount: 500_000 } })
  engine.limparCacheDeRecorders()
  await engine.ingestFact(fato({ a: 1 }, Date.now()))
  assert.equal((await registros()).length, 0, 'o teto vale, e não grava calado')
})
