// O BARRAMENTO INTERNO: publicar, consumir uma vez só, tentar de novo com espera, e
// parar num canto visível quando não dá mais.
//
// O que estas provas fixam não é "o Mongo grava": é a garantia que o resto do sistema
// vai passar a depender. Um preço que chega duas vezes porque a conexão caiu e voltou
// não pode virar duas ordens.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()

const bus = await import('../dist/events/bus.js')
const { EVENT_TYPES } = await import('../dist/events/types.js')
const { db, mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const DONO = 'dono-eventos'
const VIZINHO = 'dono-vizinho'

before(async () => {
  await bus.ensureEventIndexes()
})

beforeEach(async () => {
  await db.collection('platform_events').deleteMany({})
  await db.collection('event_handler_runs').deleteMany({})
  bus.resetHandlers()
})

const publicar = (over = {}) =>
  bus.publishEvent({
    ownerId: over.ownerId ?? DONO,
    type: over.type ?? 'market.price.updated',
    source: over.source ?? 'teste',
    payload: over.payload ?? { symbol: 'XYZ', price: 10 },
    dedupeKey: over.dedupeKey ?? 'xyz:1',
    ...over,
  })

// --- contratos ---------------------------------------------------------------------

test('os contratos do barramento são os que o resto do sistema espera', () => {
  // A lista é fechada de propósito: um consumidor que espera um tipo que não existe é
  // um gatilho que nunca dispara, e ninguém descobre por quê.
  assert.deepEqual(
    [...EVENT_TYPES],
    [
      'market.price.updated',
      'market.quote.updated',
      'market.bar.closed',
      'market.candle.closed',
      'market.signal.detected',
      'trade.order.created',
      'trade.order.filled',
      'trade.stop.triggered',
      'trade.position.closed',
      'integration.websocket.message',
    ],
  )
})

test('um evento publicado nasce com identidade, versão e hora do fato', async () => {
  const quando = new Date('2026-01-05T12:00:00Z')
  const { event, created } = await publicar({ occurredAt: quando })
  assert.equal(created, true)
  assert.ok(event.eventId)
  assert.equal(event.schemaVersion, 1)
  // `occurredAt` é quando aconteceu LÁ FORA, e não quando chegou aqui.
  assert.equal(event.occurredAt.getTime(), quando.getTime())
  assert.equal(event.status, 'pending')
  assert.equal(event.attempts, 0)
})

// --- entrega única -----------------------------------------------------------------

test('a mesma dedupeKey não vira um segundo evento', async () => {
  const a = await publicar()
  const b = await publicar({ payload: { symbol: 'XYZ', price: 999 } })
  assert.equal(b.created, false)
  assert.equal(b.event._id.toString(), a.event._id.toString())
  // E o primeiro fato é o que fica: um eco não reescreve o que já foi contado.
  assert.equal(b.event.payload.price, 10)
  assert.equal(await db.collection('platform_events').countDocuments({}), 1)
})

test('a mesma chave em contas diferentes são dois eventos diferentes', async () => {
  await publicar()
  const outro = await publicar({ ownerId: VIZINHO })
  assert.equal(outro.created, true)
  assert.equal(await db.collection('platform_events').countDocuments({}), 2)
})

test('dois consumidores nunca pegam o mesmo evento', async () => {
  await publicar()
  const um = await bus.claimNextEvent('worker-a')
  const dois = await bus.claimNextEvent('worker-b')
  assert.ok(um)
  assert.equal(dois, null, 'o segundo não acha nada porque o primeiro já tem o lease')
})

test('um evento preso por um processo morto volta quando o lease vence', async () => {
  await publicar()
  const agora = new Date()
  await bus.claimNextEvent('worker-morto', agora)
  // Antes do vencimento, ninguém encosta.
  assert.equal(await bus.claimNextEvent('worker-vivo', new Date(agora.getTime() + 1_000)), null)
  const retomado = await bus.claimNextEvent('worker-vivo', new Date(agora.getTime() + bus.EVENT_LEASE_MS + 1))
  assert.ok(retomado, 'o lease vencido é o único sinal de que o dono anterior morreu')
  assert.equal(retomado.claimedBy, 'worker-vivo')
})

// --- isolamento --------------------------------------------------------------------

test('a leitura é escopada por dono', async () => {
  await publicar()
  await publicar({ ownerId: VIZINHO, dedupeKey: 'do-vizinho' })
  const meus = await bus.listEvents(DONO)
  assert.equal(meus.length, 1)
  assert.equal(meus[0].ownerId, DONO)
})

// --- processamento -----------------------------------------------------------------

test('o handler roda uma vez e o evento é concluído com prazo de validade', async () => {
  let vezes = 0
  bus.onEvent('market.price.updated', 'teste', async () => {
    vezes += 1
  })
  await publicar()
  const evento = await bus.claimNextEvent('w1')
  assert.equal(await bus.processEvent(evento), 'done')
  assert.equal(vezes, 1)
  const doc = await db.collection('platform_events').findOne({ _id: evento._id })
  assert.equal(doc.status, 'done')
  // Concluído expira sozinho: histórico de preço não é para guardar para sempre.
  assert.ok(doc.expiresAt instanceof Date)
})

test('sem handler o evento é concluído, não recusado', async () => {
  // Publicar um preço antes de existir quem reaja é normal. Virar dead-letter encheria
  // a caixa de problemas com coisa nenhuma.
  await publicar()
  const evento = await bus.claimNextEvent('w1')
  assert.equal(await bus.processEvent(evento), 'done')
})

test('handler que estoura devolve o evento para a fila com espera crescente', async () => {
  bus.onEvent('market.price.updated', 'teste', async () => {
    throw new Error('provider fora do ar')
  })
  await publicar()
  const agora = new Date()
  const evento = await bus.claimNextEvent('w1', agora)
  assert.equal(await bus.processEvent(evento, agora), 'pending')
  const doc = await db.collection('platform_events').findOne({ _id: evento._id })
  assert.equal(doc.status, 'pending')
  assert.equal(doc.error.message, 'provider fora do ar')
  assert.ok(doc.nextAttemptAt > agora, 'a próxima tentativa é no futuro — senão não é espera, é laço')
  // E ninguém pega antes da hora.
  assert.equal(await bus.claimNextEvent('w2', agora), null)
})

test('a espera cresce e nunca é a mesma para todo mundo', () => {
  const semJitter = (n) => bus.backoffMs(n, () => 1)
  assert.ok(semJitter(2) > semJitter(1))
  assert.ok(semJitter(20) <= 60_000, 'com teto: a espera não pode crescer para sempre')
  // O jitter é o que impede mil eventos que caíram juntos de voltarem juntos.
  assert.notEqual(bus.backoffMs(3, () => 0), bus.backoffMs(3, () => 1))
})

test('falha permanente vai para dead-letter e não gira mais', async () => {
  bus.onEvent('market.price.updated', 'teste', async () => {
    throw new Error('payload inválido')
  })
  await publicar()
  let agora = new Date()
  let ultimo = 'pending'
  // Consome todas as tentativas, sempre avançando o relógio além do backoff.
  for (let i = 0; i < bus.MAX_EVENT_ATTEMPTS + 2 && ultimo !== 'dead_letter'; i += 1) {
    agora = new Date(agora.getTime() + 120_000)
    const evento = await bus.claimNextEvent('w1', agora)
    if (!evento) break
    ultimo = await bus.processEvent(evento, agora)
  }
  const doc = await db.collection('platform_events').findOne({ ownerId: DONO })
  assert.equal(doc.status, 'dead_letter')
  // Dead-letter NÃO expira: o que morreu precisa ficar para alguém olhar.
  assert.equal(doc.expiresAt, null)
  // E acabou: ninguém mais pega.
  assert.equal(await bus.claimNextEvent('w1', new Date(agora.getTime() + 600_000)), null)
})

test('um handler idempotente não processa duas vezes o mesmo fato', async () => {
  const vistos = []
  bus.onEvent('trade.order.filled', 'teste', async (e) => {
    vistos.push(e.eventId)
  })
  // O mesmo preenchimento chega duas vezes — reconexão do provider.
  await publicar({ type: 'trade.order.filled', dedupeKey: 'ordem-77:filled' })
  await publicar({ type: 'trade.order.filled', dedupeKey: 'ordem-77:filled' })
  for (;;) {
    const e = await bus.claimNextEvent('w1')
    if (!e) break
    await bus.processEvent(e)
  }
  assert.equal(vistos.length, 1, 'duas publicações, um processamento')
})

// --- a inbox: cada consumidor roda uma vez por evento ---------------------------------

test('a retentativa não repete o handler que já tinha dado certo', async () => {
  // O caso que isto resolve: dois consumidores do mesmo evento, o segundo falha, o
  // evento volta para a fila — e o primeiro, que soma volume numa vela, somaria de novo.
  const somou = []
  bus.onEvent('market.price.updated', 'soma-volume', async () => {
    somou.push(1)
  })
  let falhar = true
  bus.onEvent('market.price.updated', 'o-que-falha', async () => {
    if (falhar) throw new Error('provider fora do ar')
  })

  await publicar()
  let agora = new Date()
  const primeiro = await bus.claimNextEvent('w1', agora)
  assert.equal(await bus.processEvent(primeiro, agora), 'pending')
  assert.equal(somou.length, 1)

  falhar = false
  agora = new Date(agora.getTime() + 120_000)
  const segundo = await bus.claimNextEvent('w1', agora)
  assert.equal(await bus.processEvent(segundo, agora), 'done')
  assert.equal(somou.length, 1, 'o que já tinha dado certo não roda de novo')
})

test('cada consumidor tem a sua vez — um não bloqueia o outro', async () => {
  const vistos = []
  bus.onEvent('market.price.updated', 'consumidor-a', async () => vistos.push('a'))
  bus.onEvent('market.price.updated', 'consumidor-b', async () => vistos.push('b'))
  await publicar()
  const e = await bus.claimNextEvent('w1')
  assert.equal(await bus.processEvent(e), 'done')
  assert.deepEqual(vistos, ['a', 'b'])
})

test('registrar o mesmo nome duas vezes não cria dois consumidores', async () => {
  // Recarregar o módulo é comum; querer dois handlers idênticos não é.
  let vezes = 0
  bus.onEvent('market.price.updated', 'mesmo-nome', async () => {
    vezes += 1
  })
  bus.onEvent('market.price.updated', 'mesmo-nome', async () => {
    vezes += 1
  })
  await publicar()
  await bus.processEvent(await bus.claimNextEvent('w1'))
  assert.equal(vezes, 1)
})
