// As três portas públicas, com a casa fechada.
//
// O que se prova aqui não é o código de status: é que uma recusa NÃO GRAVA e NÃO GERA.
// Uma recusa que persiste a mensagem deixa a conversa com uma pergunta que nunca teve
// para onde ir; uma que chama o modelo custa dinheiro para dizer não.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { webChatAccessFor } = await import('../dist/apps/publicChannelAccess.js')
const { resolveRuntimeDestination } = await import('../dist/widgetRuntimeDestination.js')
const { mongoClient, db } = await import('../dist/db.js')
const express = (await import('express')).default

const DONO = 'dono-rotas'
const CHAVE = 'chave-publica'
const ANDAR = new ObjectId()

let servidor
let base
/** Quantas vezes o "modelo" foi chamado. Zero é o número que importa nas recusas. */
let inferencias = 0
let gravadas = []

before(async () => {
  await mongoClient.connect()

  // As MESMAS verificações da aplicação, na mesma ordem, sobre um POST que grava e
  // "responde". O duplo é o que torna observável o que a rota real faz por dentro.
  const app = express()
  app.use(express.json())
  const carregarWidget = async (chave) => db.collection('widgets').findOne({ publicKey: chave })

  app.post('/api/public/widgets/:publicKey/messages', async (req, res) => {
    const widget = await carregarWidget(req.params.publicKey)
    if (!widget) return res.status(404).json({ error: 'Widget not found' })

    const acesso = await webChatAccessFor(widget.ownerId)
    if (!acesso.ok) return res.status(acesso.status).json({ error: acesso.error, code: acesso.code })

    const destino = await resolveRuntimeDestination(widget)
    if (!destino.ok) return res.status(destino.status).json({ error: destino.error, code: destino.code })

    gravadas.push(req.body?.content)
    inferencias += 1
    res.status(201).json([{ _id: 'm1', content: req.body?.content }])
  })

  servidor = createServer(app)
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${servidor.address().port}`
})

after(async () => {
  await new Promise((r) => servidor.close(r))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await db.collection('widgets').deleteMany({})
  await db.collection('connections').deleteMany({})
  await db.collection('agents').deleteMany({})
  inferencias = 0
  gravadas = []
})

const comApp = (status) =>
  db.collection('connections').insertOne({ ownerId: DONO, appKey: 'web_chat', status, name: 'Chat Web', createdAt: new Date(), updatedAt: new Date() })

const criarAgente = async () => {
  const _id = new ObjectId()
  await db.collection('agents').insertOne({ _id, ownerId: DONO, name: 'Atendente', officeId: ANDAR, objective: 'x', provider: 'anthropic' })
  return _id
}

const criarWidget = async (over = {}) => {
  await db.collection('widgets').insertOne({ ownerId: DONO, publicKey: CHAVE, name: 'Chat', channel: 'web', agentId: null, sectorId: null, ...over })
}

const enviar = () =>
  fetch(`${base}/api/public/widgets/${CHAVE}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: 'c1', content: 'bom dia' }),
  })

test('tudo em ordem: a mensagem entra e a execução acontece', async () => {
  await comApp('connected')
  await criarWidget({ agentId: await criarAgente() })
  const res = await enviar()

  assert.equal(res.status, 201)
  assert.deepEqual(gravadas, ['bom dia'])
  assert.equal(inferencias, 1)
})

test('App revogado: 410, ZERO gravação e ZERO inferência', async () => {
  await comApp('revoked')
  await criarWidget({ agentId: await criarAgente() })
  const res = await enviar()

  assert.equal(res.status, 410)
  assert.equal((await res.json()).code, 'web_chat_inactive')
  assert.deepEqual(gravadas, [], 'a mensagem não pode ficar guardada esperando um atendimento que não vem')
  assert.equal(inferencias, 0, 'uma recusa que custa uma inferência não é uma recusa')
})

test('sem App nenhum: idem', async () => {
  await criarWidget({ agentId: await criarAgente() })
  const res = await enviar()
  assert.equal(res.status, 410)
  assert.equal(inferencias, 0)
})

test('destino inválido: 409, ZERO gravação e ZERO inferência', async () => {
  await comApp('connected')
  // Agente que não existe mais — o caso de quem excluiu o agente depois de criar o chat.
  await criarWidget({ agentId: new ObjectId() })
  const res = await enviar()

  assert.equal(res.status, 409)
  const corpo = await res.json()
  assert.equal(corpo.code, 'widget_destination_invalid')
  assert.match(corpo.error, /não existe mais/, 'o motivo precisa ser legível por quem administra')
  assert.deepEqual(gravadas, [])
  assert.equal(inferencias, 0)
})

test('widget legado sem destino: recusado, sem gravar', async () => {
  await comApp('connected')
  await criarWidget()
  const res = await enviar()

  assert.equal(res.status, 409)
  assert.deepEqual(gravadas, [])
  assert.equal(inferencias, 0)
})

test('a ordem importa: App inativo vence destino inválido', async () => {
  // Os dois errados ao mesmo tempo. A resposta é a do App, porque é a que o dono
  // resolve primeiro — e porque a checagem mais barata vem antes.
  await comApp('revoked')
  await criarWidget()
  assert.equal((await enviar()).status, 410)
})

test('reativar o App devolve o atendimento, com o widget intacto', async () => {
  await comApp('revoked')
  await criarWidget({ agentId: await criarAgente() })
  assert.equal((await enviar()).status, 410)

  await db.collection('connections').updateOne({ ownerId: DONO }, { $set: { status: 'connected' } })
  assert.equal((await enviar()).status, 201, 'nada foi apagado: voltar o status basta')
  assert.equal(inferencias, 1)
})

test('chave desconhecida continua 404 — a chave é que está errada', async () => {
  const res = await fetch(`${base}/api/public/widgets/nao-existe/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: 'c1', content: 'oi' }),
  })
  assert.equal(res.status, 404)
})
