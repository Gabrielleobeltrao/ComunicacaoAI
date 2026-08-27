// As rotas das fontes em tempo real — com o dono no filtro, sempre.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { realtimeSourceRouter } = await import('../dist/routes/realtimeSourceRoutes.js')
const { ensureRealtimeSourceIndexes } = await import('../dist/realtimeSources/repository.js')
const liveData = await import('../dist/integrations/websocket/liveData.js')
const { createInstallation } = await import('../dist/apps/installations.js')
const { getApp } = await import('../dist/apps/registry.js')

const DONO = 'dono-rotas-realtime'
const VIZINHO = 'vizinho'
const AGENTE = new ObjectId()
let sessao = DONO
let servidor
let port

before(async () => {
  await ensureRealtimeSourceIndexes()
  await liveData.ensureLiveDataIndexes()
  const app = express()
  app.use(express.json())
  app.use('/api/realtime-sources', (req, res, next) => {
    res.locals.userId = sessao
    next()
  }, realtimeSourceRouter)
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
  for (const c of ['realtime_sources', 'live_data', 'connections']) await db.collection(c).deleteMany({})
  liveData.resetLiveBuffer()
})

const pedir = async (metodo, caminho, corpo) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/realtime-sources${caminho}`, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await res.text()
  return { status: res.status, body: texto ? JSON.parse(texto) : null }
}

async function conectar(nome = 'WebSocket Genérico — Binance', dono = DONO) {
  const i = await createInstallation(dono, getApp('websocket'), { name: nome, config: { token: 'segredo-de-teste-123' }, publicMetadata: {} })
  return i._id.toString()
}

const DEF = (conexao) => ({ name: 'BTC atual', sourceKind: 'live_data', sourceRef: conexao, key: 'BTCUSDT', alias: 'btc_price' })

test('criar, listar, editar e apagar — com o nome amigável da conexão', async () => {
  const conexao = await conectar()
  const criado = await pedir('POST', '/', DEF(conexao))
  assert.equal(criado.status, 201)
  assert.equal(criado.body.alias, 'btc_price')
  // A tela mostra o NOME, não o id.
  assert.equal(criado.body.sourceLabel, 'WebSocket Genérico — Binance')

  assert.equal((await pedir('GET', '/')).body.length, 1)
  const mudado = await pedir('PATCH', `/${criado.body.id}`, { name: 'BTC (spot)' })
  assert.equal(mudado.body.name, 'BTC (spot)')
  assert.equal((await pedir('DELETE', `/${criado.body.id}`)).status, 204)
  assert.equal((await pedir('GET', '/')).body.length, 0)
})

test('o catálogo traz conexões da conta e as chaves que já chegaram', async () => {
  const conexao = await conectar()
  await liveData.putLiveValue(DONO, conexao, 'BTCUSDT', { price: 1 }, 300)
  await liveData.putLiveValue(DONO, conexao, 'ETHUSDT', { price: 2 }, 300)
  await liveData.flushLiveData()

  const r = await pedir('GET', '/catalog')
  assert.equal(r.status, 200)
  assert.equal(r.body.live_data.length, 1)
  assert.equal(r.body.live_data[0].label, 'WebSocket Genérico — Binance')
  assert.deepEqual(r.body.live_data[0].keys.map((k) => k.key).sort(), ['BTCUSDT', 'ETHUSDT'])
  // O catálogo não devolve valor nenhum — e muito menos credencial.
  assert.ok(!JSON.stringify(r.body).includes('segredo-de-teste-123'))
  assert.ok(!JSON.stringify(r.body).includes('price'))
})

test('a fonte de outra conta não existe: 404, e não 403', async () => {
  const conexao = await conectar()
  const minha = (await pedir('POST', '/', DEF(conexao))).body
  sessao = VIZINHO
  for (const [metodo, caminho, corpo] of [
    ['PATCH', `/${minha.id}`, { name: 'sequestrada' }],
    ['DELETE', `/${minha.id}`],
    ['GET', `/${minha.id}/value`],
  ]) {
    assert.equal((await pedir(metodo, caminho, corpo)).status, 404, `${metodo} ${caminho}`)
  }
  assert.equal((await pedir('GET', '/')).body.length, 0, 'nem aparece na listagem')
})

test('conceder e retirar a fonte de um agente pela rota da tela dele', async () => {
  const conexao = await conectar()
  const fonte = (await pedir('POST', '/', DEF(conexao))).body
  assert.deepEqual(fonte.agentIds, [])

  const concedida = await pedir('POST', `/${fonte.id}/agents/${AGENTE.toString()}`, {})
  assert.deepEqual(concedida.body.agentIds, [AGENTE.toString()])
  assert.equal((await pedir('GET', `/agent/${AGENTE.toString()}`)).body.length, 1)

  const retirada = await pedir('POST', `/${fonte.id}/agents/${AGENTE.toString()}`, { granted: false })
  assert.deepEqual(retirada.body.agentIds, [])
  assert.equal((await pedir('GET', `/agent/${AGENTE.toString()}`)).body.length, 0)
})

test('a tela do agente recebe a fonte COM o valor de agora e a idade', async () => {
  const conexao = await conectar()
  const fonte = (await pedir('POST', '/', { ...DEF(conexao), agentIds: [AGENTE.toString()] })).body
  await liveData.putLiveValue(DONO, conexao, 'BTCUSDT', { price: 64_000 }, 300)
  await liveData.flushLiveData()

  const r = await pedir('GET', `/agent/${AGENTE.toString()}`)
  assert.equal(r.body.length, 1)
  const [item] = r.body
  assert.equal(item.name, 'BTC atual')
  assert.equal(item.sourceLabel, 'WebSocket Genérico — Binance')
  assert.equal(item.key, 'BTCUSDT')
  assert.equal(item.reading.found, true)
  assert.equal(item.reading.value.price, 64_000)
  assert.equal(item.reading.stale, false)
  assert.ok(item.reading.ageMs >= 0)
  void fonte
})

test('uma definição inválida é recusada com o motivo, e nada é criado', async () => {
  const conexao = await conectar()
  const semNome = await pedir('POST', '/', { ...DEF(conexao), alias: '' })
  assert.equal(semNome.status, 400)
  const outraConta = await pedir('POST', '/', { ...DEF(await conectar('Do vizinho', VIZINHO)) })
  assert.equal(outraConta.status, 400)
  assert.match(outraConta.body.message, /não existe nesta conta/)
  assert.equal(await db.collection('realtime_sources').countDocuments({}), 0)
})

test('criar uma fonte NÃO cria histórico nenhum', async () => {
  const conexao = await conectar()
  await pedir('POST', '/', DEF(conexao))
  assert.equal(await db.collection('data_recorders').countDocuments({}), 0)
  assert.equal(await db.collection('data_history_records').countDocuments({}), 0)
})
