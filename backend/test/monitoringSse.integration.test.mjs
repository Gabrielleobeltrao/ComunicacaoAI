// O CLIENTE SSE — e o que separa "implementei SSE" de "o fluxo funciona".
//
// SSE é uma resposta HTTP que nunca termina. O defeito que um cliente ingênuo não vê é o
// silêncio: um socket pendurado não dá erro, ele só para de entregar — e a fonte fica
// conectada, verde e muda até alguém notar que o dado parou.
//
// Estes casos cobrem o formato (que é onde os erros moram), o silêncio, a volta com
// backoff, a retomada por `Last-Event-ID`, a dedupe que impede a reconexão de duplicar a
// série, e o desligamento que realmente desliga.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { mongoClient, db } = await import('../dist/db.js')
const svc = await import('../dist/monitoring/service.js')
const hist = await import('../dist/monitoring/history.js')
const { SseParser, startSseSource, startSseSupervisor } = await import('../dist/monitoring/sse.js')
const { ensureWebhookIndexes } = await import('../dist/monitoring/webhookSource.js')
const { ensureDataHistoryIndexes } = await import('../dist/dataHistory/store.js')

const DONO = 'dono-sse'
let servidor
let porta
/** O que o servidor faz com cada conexão. Trocado por teste. */
let atender
let conexoes

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const ate = async (condicao, limiteMs = 4000) => {
  const fim = Date.now() + limiteMs
  while (Date.now() < fim) {
    if (await condicao()) return true
    await esperar(25)
  }
  return false
}

before(async () => {
  await mongoClient.connect()
  await svc.ensureMonitoringIndexes()
  await hist.ensureMonitoringHistoryIndexes()
  await ensureWebhookIndexes()
  await ensureDataHistoryIndexes()
  servidor = createServer((req, res) => {
    conexoes.push({ url: req.url, headers: req.headers })
    atender(req, res)
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  porta = servidor.address().port
})

after(async () => {
  servidor?.close()
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['monitoring_sources', 'monitoring_events', 'monitoring_webhook_deliveries', 'data_recorders', 'data_history_records', 'live_data', 'realtime_sources'])
    await db.collection(c).deleteMany({})
  conexoes = []
  atender = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
  }
})

const fluxo = (over = {}) => ({
  name: `Fluxo ${Math.random().toString(36).slice(2, 8)}`,
  kind: 'websocket',
  config: { protocol: 'sse', url: `http://127.0.0.1:${porta}/stream`, heartbeatMs: 5_000 },
  cadence: { mode: 'stream' },
  mapping: { version: 1, fields: [{ to: 'preco', from: 'preco', transforms: [{ op: 'number' }], required: true }] },
  destination: { history: true },
  retry: { backoffMs: 1_000, maxAttempts: 3, jitterRatio: 0 },
  ...over,
})

/** A fonte no ar: SSE não passa por teste de leitura, então a ativação é direta. */
const noAr = async (over = {}) => {
  const f = await svc.createSource(DONO, fluxo(over))
  await svc.setSourceStatus(DONO, f._id, 'active')
  return await svc.getSource(DONO, f._id)
}

// --- o FORMATO, que é onde os erros moram ------------------------------------------------

test('o parser junta linhas de `data`, guarda o id e ignora comentário', () => {
  const p = new SseParser()
  assert.deepEqual(p.push(': batimento\n'), [], 'comentário é sinal de vida, não evento')
  const eventos = p.push('id: 7\nevent: preco\ndata: {"a":1}\ndata: {"b":2}\n\n')
  assert.equal(eventos.length, 1)
  assert.equal(eventos[0].id, '7')
  assert.equal(eventos[0].event, 'preco')
  assert.equal(eventos[0].data, '{"a":1}\n{"b":2}')
})

test('o parser aceita evento partido entre dois pedaços da rede', () => {
  // O TCP não respeita a fronteira do evento: um `data:` chega em dois pacotes o tempo todo.
  const p = new SseParser()
  assert.deepEqual(p.push('data: {"pre'), [])
  const eventos = p.push('co":10}\n\n')
  assert.equal(eventos.length, 1)
  assert.equal(eventos[0].data, '{"preco":10}')
})

test('o parser entende as três quebras de linha do protocolo', () => {
  const p = new SseParser()
  assert.equal(p.push('data: a\r\n\r\n').length, 1)
  assert.equal(p.push('data: b\r\r').length, 1)
  assert.equal(p.push('data: c\n\n').length, 1)
})

test('o parser lê o `retry` do servidor e ignora campo desconhecido', () => {
  const p = new SseParser()
  const eventos = p.push('retry: 2500\nqualquercoisa: x\ndata: 1\n\n')
  assert.equal(eventos[0].retryMs, 2500)
})

test('só um espaço depois dos dois-pontos é comido', () => {
  const p = new SseParser()
  assert.equal(p.push('data:  dois espaços\n\n')[0].data, ' dois espaços')
})

// --- a entrega ---------------------------------------------------------------------------

test('ACEITAÇÃO: o evento do fluxo vira fato no histórico, com telemetria', async () => {
  atender = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('id: e1\ndata: {"preco":"10,50"}\n\n')
  }
  const f = await noAr()
  const h = startSseSource(f)
  try {
    assert.ok(await ate(async () => h.estado.eventos > 0), 'o evento precisa ser entregue')
    assert.ok(await ate(async () => (await db.collection('data_history_records').countDocuments({ ownerId: DONO })) === 1))
    const registro = await db.collection('data_history_records').findOne({ ownerId: DONO })
    assert.equal(registro.value.preco, 10.5)

    const depois = await svc.getSource(DONO, f._id)
    assert.equal(depois.telemetry.readsOk, 1)
    assert.ok(depois.telemetry.lastOkAt)
  } finally {
    await h.stop()
  }
})

test('o evento entra no histórico operacional como ENTREGA, não como coleta', async () => {
  atender = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('id: e1\ndata: {"preco":"1"}\n\n')
  }
  const f = await noAr()
  const h = startSseSource(f)
  try {
    assert.ok(await ate(async () => (await hist.listarEventos(DONO, { kind: 'delivery', outcome: 'ok' })).items.length > 0))
    assert.equal((await hist.listarEventos(DONO, { kind: 'collect' })).items.length, 0)
  } finally {
    await h.stop()
  }
})

test('evento sem campo obrigatório é recusado e registrado — não gravado pela metade', async () => {
  atender = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('id: e1\ndata: {"outra":"coisa"}\n\n')
  }
  const f = await noAr()
  const h = startSseSource(f)
  try {
    assert.ok(await ate(async () => (await hist.listarEventos(DONO, { outcome: 'failed' })).items.length > 0))
    assert.equal(await db.collection('data_history_records').countDocuments({ ownerId: DONO }), 0)
  } finally {
    await h.stop()
  }
})

// --- silêncio, volta e retomada ----------------------------------------------------------

test('SILÊNCIO é morte: sem byte nenhum, a conexão é refeita', async () => {
  // Um socket pendurado não dá erro. Sem este relógio, a fonte fica verde e muda.
  atender = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    // E nunca mais escreve nada.
  }
  // O piso de silêncio do modelo é 5 s, e o cliente o respeita: o teste espera o relógio
  // real em vez de encurtar um número que produção nunca teria.
  const f = await noAr({ config: { protocol: 'sse', url: `http://127.0.0.1:${porta}/mudo`, heartbeatMs: 5_000 } })
  const h = startSseSource(f, { random: () => 1 })
  try {
    assert.ok(await ate(() => conexoes.length >= 2, 15_000), `o cliente precisa voltar sozinho: ${conexoes.length} conexões`)
    assert.ok(h.estado.reconexoes >= 1)
    const depois = await svc.getSource(DONO, f._id)
    assert.ok(depois.telemetry.reconnects >= 1, 'a reconexão precisa aparecer na telemetria')
  } finally {
    await h.stop()
  }
})

test('a volta REENVIA o Last-Event-ID: o servidor sabe de onde continuar', async () => {
  atender = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('id: e42\ndata: {"preco":"1"}\n\n')
    // E cala. O relógio de silêncio derruba e o cliente volta.
  }
  const f = await noAr()
  const h = startSseSource(f, { random: () => 1 })
  try {
    assert.ok(await ate(() => conexoes.length >= 2, 15_000))
    assert.equal(conexoes[0].headers['last-event-id'], undefined, 'a primeira conexão não tem de onde continuar')
    assert.equal(conexoes[1].headers['last-event-id'], 'e42', 'a segunda precisa dizer onde parou')
  } finally {
    await h.stop()
  }
})

test('DEDUPE: reconectar e receber os mesmos eventos não duplica a série', async () => {
  // É o caso real: o servidor reenvia a partir do Last-Event-ID, e sem identidade por
  // evento a série ganharia uma cópia a cada queda.
  let vezes = 0
  atender = (_req, res) => {
    vezes += 1
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('id: e1\ndata: {"preco":"1"}\n\n')
    res.write('id: e2\ndata: {"preco":"2"}\n\n')
  }
  const f = await noAr()
  const h = startSseSource(f, { random: () => 1 })
  try {
    assert.ok(await ate(() => vezes >= 2, 15_000), 'precisa reconectar ao menos uma vez')
    await esperar(400)
    const gravados = await db.collection('data_history_records').countDocuments({ ownerId: DONO })
    assert.equal(gravados, 2, `os mesmos dois eventos entregues ${vezes} vezes continuam sendo dois fatos`)
  } finally {
    await h.stop()
  }
})

test('resposta que não é event-stream não vira laço de reconexão contra a resposta errada', async () => {
  atender = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"nao":"sou um fluxo"}')
  }
  const f = await noAr()
  const h = startSseSource(f, { random: () => 1 })
  try {
    assert.ok(await ate(async () => (await hist.listarEventos(DONO, { outcome: 'failed' })).items.length > 0, 5000))
    const { items } = await hist.listarEventos(DONO, { outcome: 'failed' })
    assert.match(items[0].errorCode, /tipo_errado/)
  } finally {
    await h.stop()
  }
})

test('status de erro é recusa registrada, e a volta respeita o backoff', async () => {
  atender = (_req, res) => {
    res.writeHead(503, { 'content-type': 'text/plain' })
    res.end('fora do ar')
  }
  const f = await noAr()
  const h = startSseSource(f, { random: () => 1 })
  try {
    assert.ok(await ate(async () => (await hist.listarEventos(DONO, { outcome: 'failed' })).items.length > 0, 5000))
    const { items } = await hist.listarEventos(DONO, { outcome: 'failed' })
    assert.match(items[0].errorCode, /status_503/)
    // O backoff da fonte é 1s: em meio segundo não pode ter voltado.
    const antes = conexoes.length
    await esperar(300)
    assert.equal(conexoes.length, antes, 'voltar antes do backoff seria martelar quem já disse que está mal')
  } finally {
    await h.stop()
  }
})

test('PARAR é parar: o desligamento não reconecta', async () => {
  atender = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(': oi\n\n')
  }
  const f = await noAr()
  const h = startSseSource(f, { random: () => 1 })
  assert.ok(await ate(() => conexoes.length >= 1))
  await h.stop()
  const depois = conexoes.length
  await esperar(600)
  assert.equal(conexoes.length, depois, 'um socket derrubado pelo stop não pode cair no caminho da reconexão')
  assert.equal(h.estado.conectado, false)
})

test('AMEAÇA: um fluxo apontando para a rede interna não conecta', async () => {
  const f = await svc.createSource(DONO, fluxo({ config: { protocol: 'sse', url: 'http://169.254.169.254/latest/meta-data/', heartbeatMs: 5_000 } }))
  await svc.setSourceStatus(DONO, f._id, 'active')
  const h = startSseSource(await svc.getSource(DONO, f._id), { random: () => 1 })
  try {
    assert.ok(await ate(async () => (await hist.listarEventos(DONO, { outcome: 'failed' })).items.length > 0, 5000))
    assert.equal((await hist.listarEventos(DONO, { outcome: 'failed' })).items[0].errorCode, 'blocked')
  } finally {
    await h.stop()
  }
})

// --- o supervisor ------------------------------------------------------------------------

test('o supervisor sobe as fontes ativas e derruba as que foram pausadas', async () => {
  atender = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(': oi\n\n')
  }
  const f = await noAr()
  const sup = startSseSupervisor({ intervalMs: 5_000 })
  try {
    assert.ok(await ate(() => sup.ativas === 1), 'a fonte ativa precisa virar assinatura')
    await svc.setSourceStatus(DONO, f._id, 'paused')
    // Reconciliar é o que faz pausar na tela realmente parar de consumir a rede do outro
    // lado, sem reiniciar processo nenhum.
    await sup.stop()
    assert.equal(sup.ativas, 0)
  } finally {
    await sup.stop()
  }
})

test('uma fonte SSE ativa sem endereço é recusada na ativação', async () => {
  await assert.rejects(
    () => svc.createSource(DONO, fluxo({ config: { protocol: 'sse', heartbeatMs: 5_000 } })),
    /precisa do endereço do fluxo/,
  )
})

test('SSE e WebSocket não são a mesma coisa: um pede endereço, o outro pede a conexão do App', async () => {
  await assert.rejects(
    () => svc.createSource(DONO, fluxo({ config: { protocol: 'websocket', heartbeatMs: 5_000 } })),
    /precisa da conexão do App/,
  )
})
