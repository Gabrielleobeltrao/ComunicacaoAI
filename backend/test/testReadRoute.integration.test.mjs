// "Testar leitura" precisa RESPONDER — inclusive quando a leitura falha.
//
// A tela mostrava "Não foi possível testar agora" para tudo: para o site que exige
// JavaScript, para o endereço errado e para um defeito nosso. As três coisas são
// diferentes, e só uma delas é culpa de quem configurou. Um teste que só exercita o
// caminho feliz não pega isso — é justamente no erro que a rota tem de continuar
// falando JSON.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { mongoClient, db } = await import('../dist/db.js')
const { agentRoutineRouter } = await import('../dist/routes/agentRoutineRoutes.js')
const express = (await import('express')).default

const OWNER = 'dono-teste-leitura'
const AGENT = new ObjectId()

let server
let porta
let alvo
let portaAlvo

before(async () => {
  await mongoClient.connect()
  await db.collection('agents').insertOne({
    _id: AGENT,
    ownerId: OWNER,
    name: 'Pesquisador',
    preset: 'researcher',
    objective: 'ler',
    provider: 'anthropic',
  })

  // Um site de verdade para o teste apontar.
  alvo = createServer((req, res) => {
    if (req.url === '/artigo') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<html><head><title>Boletim</title></head><body><article>${'O boletim desta semana traz os números do período com detalhe. '.repeat(8)}</article></body></html>`)
      return
    }
    // Uma página que só existe depois do JavaScript.
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html><body><div id="root"></div><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></body></html>')
  })
  await new Promise((r) => alvo.listen(0, '127.0.0.1', r))
  portaAlvo = alvo.address().port

  // A MESMA montagem do index.ts.
  const app = express()
  app.use(express.json())
  const auth = (_req, res, next) => {
    res.locals.userId = OWNER
    next()
  }
  app.use('/api/agents/:agentId', auth, agentRoutineRouter)
  server = createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  porta = server.address().port
})

after(async () => {
  await new Promise((r) => server.close(r))
  await new Promise((r) => alvo.close(r))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const testarLeitura = async (corpo, agentId = AGENT.toString()) => {
  const res = await fetch(`http://127.0.0.1:${porta}/api/agents/${agentId}/sources/test-read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  })
  const texto = await res.text()
  let json = null
  try {
    json = JSON.parse(texto)
  } catch {
    // Deixa `json` nulo: é exatamente o que a tela faz, e é o que produz o
    // "Não foi possível testar agora" que não diz nada.
  }
  return { status: res.status, json, texto }
}

test('a página boa responde com método, tipo, status e o que foi tentado', async () => {
  const r = await testarLeitura({ url: `http://127.0.0.1:${portaAlvo}/artigo` })
  assert.equal(r.status, 200, r.texto.slice(0, 300))
  assert.ok(r.json, `a rota precisa responder JSON — veio: ${r.texto.slice(0, 300)}`)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.readMethod, 'http')
  assert.equal(r.json.status, 200)
  assert.match(r.json.contentType, /text\/html/)
  assert.equal(r.json.kind, 'article')
  assert.ok(r.json.usefulChars > 200)
  assert.deepEqual(r.json.strategies.map((t) => t.strategy), ['http'])
})

test('a leitura que FALHA continua sendo uma resposta, com o motivo com nome', async () => {
  // Este é o caso que a tela mostrava como "Não foi possível testar agora": um site que
  // não pode ser lido não é um defeito do teste.
  const r = await testarLeitura({ url: `http://127.0.0.1:${portaAlvo}/app` })
  assert.equal(r.status, 200, r.texto.slice(0, 300))
  assert.ok(r.json, `a rota precisa responder JSON — veio: ${r.texto.slice(0, 300)}`)
  assert.equal(r.json.ok, false)
  assert.equal(r.json.code, 'BROWSER_UNAVAILABLE')
  assert.match(r.json.reason, /não tem navegador configurado/)
  assert.ok(r.json.reason)
})

test('endereço inválido é recusado com um motivo, e não com um erro genérico', async () => {
  const r = await testarLeitura({ url: 'nao-e-um-endereco' })
  assert.equal(r.status, 400)
  assert.equal(r.json.code, 'INVALID_URL')
})

test('o agente de outro dono não é alcançável por aqui', async () => {
  const r = await testarLeitura({ url: `http://127.0.0.1:${portaAlvo}/artigo` }, new ObjectId().toString())
  assert.equal(r.status, 404)
})
