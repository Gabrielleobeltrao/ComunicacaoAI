// AS ROTAS do App de WebSocket, com o Express de verdade.
//
// O que precisa ser exercitado aqui é o CICLO — criar, editar, pausar, remover — porque
// é nele que moram as duas coisas que quebram calado: uma assinatura fantasma (cancelada
// com a configuração errada, ou nunca cancelada) e um destino apontando para o que não
// é desta conta.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'
import { startFakeWs } from './helpers/fakeWsServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { mongoClient, db } = await import('../dist/db.js')
const { websocketRouter } = await import('../dist/routes/websocketRoutes.js')
const { getApp } = await import('../dist/apps/registry.js')
const { createInstallation } = await import('../dist/apps/installations.js')
const { writeConnectionConfig, websocketAdapterFor } = await import('../dist/integrations/websocket/service.js')
const { normalizeConnectionConfig } = await import('../dist/apps/official/websocket/config.js')
const { StreamManager, setStreamManager } = await import('../dist/streams/manager.js')
const { createRealSocket } = await import('../dist/streams/socket.js')
const { ensureStreamIndexes, upsertStream } = await import('../dist/streams/repository.js')
const { streamCredentials } = await import('../dist/streams/service.js')
const repo = await import('../dist/integrations/websocket/repository.js')
const { createFloor } = await import('../dist/floors.js')
const { createAgent } = await import('../dist/agents.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
const express = (await import('express')).default

const DONO = 'dono-rotas-ws'
const VIZINHO = 'vizinho-rotas-ws'
let servidor
let server
let port
let gerente
let sessao = DONO

before(async () => {
  await mongoClient.connect()
  await ensureStreamIndexes()
  await repo.ensureWebSocketIndexes()
  await ensureRunIndexes()

  const app = express()
  app.use(express.json())
  app.use((_req, res, next) => {
    res.locals.userId = sessao
    next()
  })
  app.use('/api/websocket', websocketRouter)
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port
      resolve()
    })
  })
})

after(async () => {
  await servidor?.close()
  await new Promise((resolve) => server.close(resolve))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['connections', 'market_streams', 'websocket_subscriptions', 'websocket_messages', 'websocket_logs', 'automations', 'automation_versions', 'agents', 'offices', 'buildings'])
    await db.collection(c).deleteMany({})
  sessao = DONO
  await servidor?.close()
  servidor = await startFakeWs()
  gerente = new StreamManager({
    adapters: new Map(),
    adapterFor: websocketAdapterFor,
    createSocket: createRealSocket,
    credentialsOf: streamCredentials,
  })
  setStreamManager(gerente)
})

const chamar = (metodo, caminho, corpo) =>
  fetch(`http://127.0.0.1:${port}/api/websocket${caminho}`, {
    method: metodo,
    ...(corpo ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) } : {}),
  })

async function conexao(dono = DONO) {
  return createInstallation(dono, getApp('websocket'), {
    name: 'Serviço',
    config: { token: 'credencial-de-teste-longa' },
    publicMetadata: writeConnectionConfig(normalizeConnectionConfig({ endpoint: servidor.url })),
  })
}

const ligar = async (inst) => {
  const record = await upsertStream({ ownerId: DONO, installationId: inst._id.toString(), appKey: 'websocket', environment: 'default', symbols: [] })
  await gerente.start(record)
  return record
}

async function ate(condicao, oque = 'condição', tentativas = 400) {
  for (let i = 0; i < tentativas; i += 1) {
    if (await condicao()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`esperei demais por: ${oque}`)
}

// --- o ciclo de edição --------------------------------------------------------------------

test('editar uma assinatura ATIVA cancela com a configuração antiga e assina com a nova', async () => {
  /**
   * O defeito clássico daqui: cancelar com a configuração NOVA. Trocar de canal mandaria
   * o cancelamento do canal novo — que ninguém assinou — e deixaria o antigo assinado
   * para sempre. Uma assinatura fantasma continua chegando e não aparece em lugar nenhum.
   */
  const inst = await conexao()
  const criada = await chamar('POST', '/subscriptions', {
    installationId: inst._id.toString(),
    name: 'Pedidos',
    subscribeMessage: JSON.stringify({ sub: 'antigo' }),
    unsubscribeMessage: JSON.stringify({ unsub: 'antigo' }),
  }).then((r) => r.json())

  await ligar(inst)
  await ate(async () => servidor.estado.recebidas.length === 1, 'a inscrição inicial')
  assert.deepEqual(JSON.parse(servidor.estado.recebidas[0]), { sub: 'antigo' })

  const r = await chamar('PATCH', `/subscriptions/${criada.id}`, {
    subscribeMessage: JSON.stringify({ sub: 'novo' }),
    unsubscribeMessage: JSON.stringify({ unsub: 'novo' }),
  })
  assert.equal(r.status, 200)

  await ate(async () => servidor.estado.recebidas.length === 3, 'o cancelamento e a nova inscrição')
  // O cancelamento é o ANTIGO — é ele que estava assinado.
  assert.deepEqual(JSON.parse(servidor.estado.recebidas[1]), { unsub: 'antigo' })
  assert.deepEqual(JSON.parse(servidor.estado.recebidas[2]), { sub: 'novo' })
})

test('trocar só o nome não mexe nas inscrições', async () => {
  // Cancelar e reassinar por causa de um nome seria uma janela sem assinatura à toa.
  const inst = await conexao()
  const criada = await chamar('POST', '/subscriptions', {
    installationId: inst._id.toString(),
    name: 'Pedidos',
    subscribeMessage: JSON.stringify({ sub: 'x' }),
  }).then((r) => r.json())
  await ligar(inst)
  await ate(async () => servidor.estado.recebidas.length === 1, 'a inscrição')

  await chamar('PATCH', `/subscriptions/${criada.id}`, { name: 'Outro nome' })
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(servidor.estado.recebidas.length, 1, 'nada foi remandado')
})

test('pausar manda o cancelamento; reativar manda a inscrição', async () => {
  const inst = await conexao()
  const criada = await chamar('POST', '/subscriptions', {
    installationId: inst._id.toString(),
    name: 'Pedidos',
    subscribeMessage: JSON.stringify({ sub: 'x' }),
    unsubscribeMessage: JSON.stringify({ unsub: 'x' }),
  }).then((r) => r.json())
  await ligar(inst)
  await ate(async () => servidor.estado.recebidas.length === 1, 'a inscrição')

  await chamar('PATCH', `/subscriptions/${criada.id}`, { active: false })
  await ate(async () => servidor.estado.recebidas.length === 2, 'o cancelamento')
  assert.deepEqual(JSON.parse(servidor.estado.recebidas[1]), { unsub: 'x' })

  await chamar('PATCH', `/subscriptions/${criada.id}`, { active: true })
  await ate(async () => servidor.estado.recebidas.length === 3, 'a reinscrição')
  assert.deepEqual(JSON.parse(servidor.estado.recebidas[2]), { sub: 'x' })
})

test('remover manda o cancelamento antes de apagar', async () => {
  // Depois de apagar não haveria mais o que mandar, e o serviço continuaria enviando.
  const inst = await conexao()
  const criada = await chamar('POST', '/subscriptions', {
    installationId: inst._id.toString(),
    name: 'Pedidos',
    subscribeMessage: JSON.stringify({ sub: 'x' }),
    unsubscribeMessage: JSON.stringify({ unsub: 'x' }),
  }).then((r) => r.json())
  await ligar(inst)
  await ate(async () => servidor.estado.recebidas.length === 1, 'a inscrição')

  assert.equal((await chamar('DELETE', `/subscriptions/${criada.id}`)).status, 204)
  await ate(async () => servidor.estado.recebidas.length === 2, 'o cancelamento')
  assert.deepEqual(JSON.parse(servidor.estado.recebidas[1]), { unsub: 'x' })
  assert.equal(await db.collection('websocket_subscriptions').countDocuments({}), 0)
})

// --- posse e validação ------------------------------------------------------------------------

test('a inscrição precisa ser JSON quando a conexão é JSON', async () => {
  const inst = await conexao()
  const r = await chamar('POST', '/subscriptions', { installationId: inst._id.toString(), name: 'X', subscribeMessage: 'não é json' })
  assert.equal(r.status, 400)
  assert.match((await r.json()).message, /JSON/)
})

test('um destino de outra conta é recusado na gravação', async () => {
  await ensureDefaultBuilding(VIZINHO)
  const andarAlheio = await createFloor(VIZINHO, { name: 'Do vizinho' })
  const agenteAlheio = await createAgent(VIZINHO, andarAlheio._id, 'De outro', { objective: 'Fazer outra coisa' })
  const inst = await conexao()
  const r = await chamar('POST', '/subscriptions', {
    installationId: inst._id.toString(),
    name: 'X',
    destination: { kind: 'agent', agentId: agenteAlheio._id.toString() },
  })
  assert.equal(r.status, 400)
  assert.match((await r.json()).message, /não encontrado/)
  assert.equal(await db.collection('websocket_subscriptions').countDocuments({}), 0, 'e nada foi gravado')
})

test('a conexão de outra conta simplesmente não existe', async () => {
  const alheia = await conexao(VIZINHO)
  const r = await chamar('POST', '/subscriptions', { installationId: alheia._id.toString(), name: 'X' })
  assert.equal(r.status, 400)
})

test('a assinatura de outra conta não é editável nem removível', async () => {
  const inst = await conexao()
  const criada = await chamar('POST', '/subscriptions', { installationId: inst._id.toString(), name: 'Minha' }).then((r) => r.json())
  sessao = VIZINHO
  assert.equal((await chamar('PATCH', `/subscriptions/${criada.id}`, { name: 'Roubada' })).status, 404)
  assert.equal((await chamar('DELETE', `/subscriptions/${criada.id}`)).status, 404)
  assert.equal((await chamar('POST', `/subscriptions/${criada.id}/test`)).status, 404)
})

test('os alvos oferecidos são só os desta conta', async () => {
  await ensureDefaultBuilding(DONO)
  const andar = await createFloor(DONO, { name: 'Térreo' })
  await createAgent(DONO, andar._id, 'Ana', { objective: 'Atender bem quem chega' })
  await ensureDefaultBuilding(VIZINHO)
  const andarAlheio = await createFloor(VIZINHO, { name: 'Do vizinho' })
  await createAgent(VIZINHO, andarAlheio._id, 'De outro', { objective: 'Fazer outra coisa' })

  const alvos = await chamar('GET', '/targets').then((r) => r.json())
  assert.deepEqual(alvos.agents.map((a) => a.name), ['Ana'])
  assert.deepEqual(alvos.floors.map((f) => f.name), ['Térreo'])
})

// --- o gatilho gerenciado, pelas rotas -----------------------------------------------------------

test('escolher um agente cria o gatilho, e voltar para "só guardar" o arquiva', async () => {
  await ensureDefaultBuilding(DONO)
  const andar = await createFloor(DONO, { name: 'Térreo' })
  const agente = await createAgent(DONO, andar._id, 'Ana', { objective: 'Atender bem quem chega' })
  const inst = await conexao()

  const criada = await chamar('POST', '/subscriptions', {
    installationId: inst._id.toString(),
    name: 'Para a Ana',
    destination: { kind: 'agent', agentId: agente._id.toString() },
  }).then((r) => r.json())
  assert.ok(criada.managedAutomationId, 'a relação fica explícita na assinatura')

  const depois = await chamar('PATCH', `/subscriptions/${criada.id}`, { destination: { kind: 'history' } }).then((r) => r.json())
  assert.equal(depois.managedAutomationId, null)
  const automacao = await db.collection('automations').findOne({ _id: new ObjectId(criada.managedAutomationId) })
  assert.equal(automacao.status, 'archived')
})
