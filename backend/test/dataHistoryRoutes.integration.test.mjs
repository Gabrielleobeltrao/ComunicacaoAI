// As rotas do histórico genérico — com o dono no filtro, sempre.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.DATA_HISTORY_MIN_INTERVAL_MS = '1000'

const { mongoClient, db } = await import('../dist/db.js')
const { dataHistoryRouter } = await import('../dist/routes/dataHistoryRoutes.js')
const { ensureDataHistoryIndexes } = await import('../dist/dataHistory/store.js')

const DONO = 'dono-rotas'
const VIZINHO = 'vizinho'
let sessao = DONO
let servidor
let port

before(async () => {
  await ensureDataHistoryIndexes()
  const app = express()
  app.use(express.json())
  app.use('/api/data-history', (req, res, next) => {
    res.locals.userId = sessao
    next()
  }, dataHistoryRouter)
  servidor = app.listen(0)
  await new Promise((r) => servidor.once('listening', r))
  port = servidor.address().port
})
after(async () => {
  servidor.close()
  await mongoClient.close()
  await stopMongo()
})
beforeEach(async () => {
  sessao = DONO
  for (const c of ['data_recorders', 'data_history_records', 'data_history_windows']) await db.collection(c).deleteMany({})
})

const pedir = async (metodo, caminho, corpo) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/data-history${caminho}`, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await res.text()
  return { status: res.status, body: texto ? JSON.parse(texto) : null }
}

const DEF = { name: 'meu histórico', source: { kind: 'manual', ref: 'erp' }, mode: 'every_event', entityKeyPath: 'sku' }

test('criar, listar, ler, atualizar e apagar', async () => {
  const criado = await pedir('POST', '/recorders', DEF)
  assert.equal(criado.status, 201)
  assert.equal(criado.body.name, 'meu histórico')
  assert.equal(criado.body.enabled, true)

  assert.equal((await pedir('GET', '/recorders')).body.length, 1)
  assert.equal((await pedir('GET', `/recorders/${criado.body.id}`)).body.storedRecords, 0)

  const mudado = await pedir('PATCH', `/recorders/${criado.body.id}`, { enabled: false })
  assert.equal(mudado.body.enabled, false)

  assert.equal((await pedir('DELETE', `/recorders/${criado.body.id}`)).status, 204)
  assert.equal((await pedir('GET', '/recorders')).body.length, 0)
})

test('uma definição inválida é recusada com o motivo, e nada é criado', async () => {
  const r = await pedir('POST', '/recorders', { ...DEF, mode: 'window_aggregate', intervalMs: 60_000, aggregations: [] })
  assert.equal(r.status, 400)
  assert.match(r.body.message, /agregação/)
  assert.equal(await db.collection('data_recorders').countDocuments({}), 0)
})

test('o histórico de outro dono não existe: 404, e não 403', async () => {
  const meu = (await pedir('POST', '/recorders', DEF)).body
  sessao = VIZINHO
  for (const [metodo, caminho, corpo] of [
    ['GET', `/recorders/${meu.id}`],
    ['PATCH', `/recorders/${meu.id}`, { name: 'sequestrado' }],
    ['DELETE', `/recorders/${meu.id}`],
    ['GET', `/recorders/${meu.id}/records`],
    ['GET', `/recorders/${meu.id}/keys`],
    ['GET', `/recorders/${meu.id}/aggregate`],
  ]) {
    const r = await pedir(metodo, caminho, corpo)
    assert.equal(r.status, 404, `${metodo} ${caminho} devolveu ${r.status}`)
  }
})

test('a prévia roda o motor e NÃO deixa rastro', async () => {
  const r = await pedir('POST', '/preview', {
    recorder: {
      name: 'prévia',
      source: { kind: 'manual', ref: 'erp' },
      mode: 'window_aggregate',
      intervalMs: 60_000,
      entityKeyPath: 'sku',
      aggregations: [
        { from: 'qty', op: 'sum', to: 'total' },
        { from: '', op: 'count', to: 'linhas' },
      ],
    },
    samples: [
      { sku: 'A', qty: 3 },
      { sku: 'A', qty: 4 },
    ],
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.decisions.length, 2)
  assert.equal(r.body.windows.length, 1)
  assert.equal(r.body.windows[0].value.total, 7)
  assert.equal(r.body.windows[0].value.linhas, 2)

  // Nem recorder, nem registro, nem janela: testar não cria nada.
  assert.equal(await db.collection('data_recorders').countDocuments({}), 0)
  assert.equal(await db.collection('data_history_records').countDocuments({}), 0)
  assert.equal(await db.collection('data_history_windows').countDocuments({}), 0)
})

test('a prévia recusa uma configuração inválida antes de rodar', async () => {
  const r = await pedir('POST', '/preview', { recorder: { name: 'x', source: { kind: 'manual', ref: 'r' }, mode: 'nao_existe' }, samples: [{}] })
  assert.equal(r.status, 400)
})

test('consultar registros por chave e período', async () => {
  const rec = (await pedir('POST', '/recorders', DEF)).body
  const engine = await import('../dist/dataHistory/engine.js')
  engine.limparCacheDeRecorders()
  const t0 = Date.parse('2026-08-01T00:00:00.000Z')
  for (const [i, sku] of ['A', 'B', 'A'].entries()) {
    await engine.ingestFact({ ownerId: DONO, sourceKey: 'manual:erp', entityKey: null, occurredAt: new Date(t0 + i * 60_000), value: { sku, qty: i + 1 } })
  }

  const todos = await pedir('GET', `/recorders/${rec.id}/records`)
  assert.equal(todos.body.count, 3)

  const soA = await pedir('GET', `/recorders/${rec.id}/records?entityKey=A&order=asc`)
  assert.deepEqual(soA.body.items.map((i) => i.value.qty), [1, 3])

  const chaves = await pedir('GET', `/recorders/${rec.id}/keys`)
  assert.deepEqual([...chaves.body].sort(), ['A', 'B'])

  const resumo = await pedir('GET', `/recorders/${rec.id}/aggregate`)
  assert.equal(resumo.body.result.total, 3, 'sem regras próprias, o resumo é a contagem')
})
