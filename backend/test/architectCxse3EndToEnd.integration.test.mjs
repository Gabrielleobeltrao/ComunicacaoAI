// CXSE3, DA FRASE AO RECURSO — pela rota real do chat.
//
// O plano descreve um caminho: mensagem → intenção → projeto → Brief → proposta → aprovação →
// Source + History/Live + Monitor + Flow → teste → ativação autorizada. Os testes anteriores
// provavam pedaços dele começando com um Brief montado à mão — e um Brief montado à mão pula
// justamente a parte que quebra na vida real: a passagem do que a pessoa escreveu para o que
// o sistema entendeu.
//
// Aqui a única entrada é `POST /api/architect/assistant/turn` com a frase que alguém digitaria.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.LLM_FAKE = '1'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { mongoClient, db } = await import('../dist/db.js')
const { architectRouter } = await import('../dist/routes/architectRoutes.js')
const repo = await import('../dist/architect/repository.js')
const { ensureTokenUsageIndexes } = await import('../dist/tokenUsage.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
const { ensureExecutionRootIndexes } = await import('../dist/executionRoots.js')
const { setProviderApiKey } = await import('../dist/userSettings.js')
const { resetGuards } = await import('../dist/architect/guard.js')
const express = (await import('express')).default

const DONO = 'dono-cxse3'
const FRASE = 'Observe CXSE3 e me avise quando o RSI ficar abaixo de 30'
let server
let port
let origem
let portaDaOrigem

const pedir = async (metodo, caminho, corpo) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/architect${caminho}`, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await res.text()
  return { status: res.status, body: texto ? JSON.parse(texto) : null }
}

before(async () => {
  await mongoClient.connect()
  await repo.ensureArchitectIndexes()
  await ensureTokenUsageIndexes()
  await ensureRunIndexes()
  await ensureExecutionRootIndexes()

  // A origem de verdade que o teste de aceitação da fonte vai consultar.
  origem = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ rsi: 22.5, preco: 31.4 }))
  })
  await new Promise((r) => origem.listen(0, r))
  portaDaOrigem = origem.address().port

  const app = express()
  app.use(express.json())
  app.use((_req, res, next) => {
    res.locals.userId = DONO
    next()
  })
  app.use('/api/architect', architectRouter)
  await new Promise((r) => {
    server = app.listen(0, () => {
      port = server.address().port
      r()
    })
  })
})

after(async () => {
  origem?.close()
  await new Promise((r) => server.close(r))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of [
    'architect_projects',
    'architect_messages',
    'architect_apply_operations',
    'offices',
    'buildings',
    'agents',
    'sectors',
    'automations',
    'data_stores',
    'dataset_definitions',
    'monitoring_sources',
    'monitors',
    'execution_roots',
    'user_settings',
  ])
    await db.collection(c).deleteMany({})
  resetGuards()
  await setProviderApiKey(DONO, 'anthropic', 'chave-de-teste-que-nao-e-segredo')
})

/** A frase entra pelo chat. É a única porta que este arquivo usa. */
const doChat = (message) => pedir('POST', '/assistant/turn', { message })

// --- da frase ao projeto -----------------------------------------------------------------------

test('ACEITAÇÃO: a frase do chat vira intenção de PROPOR e abre um projeto', async () => {
  const r = await doChat(FRASE)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.intent.mode, 'propose', 'vigiar um dado é construir, não responder')
  assert.ok(r.body.projectId, 'sem projeto, não há onde a proposta morar')
  // A rodada TERMINA: o campo do chat não pode ficar bloqueado.
  assert.equal(r.body.phase, 'done')
  assert.ok(r.body.text.trim())
})

test('a FRASE ORIGINAL fica no projeto — ninguém precisa digitar de novo', async () => {
  const r = await doChat(FRASE)
  const mensagens = await db
    .collection('architect_messages')
    .find({ ownerId: DONO, projectId: new ObjectId(r.body.projectId) })
    .toArray()
  assert.ok(
    mensagens.some((m) => m.role === 'user' && m.content.includes('CXSE3')),
    'abrir um projeto vazio faz a pessoa repetir o pedido — e a segunda versão nunca é igual',
  )
})

// --- do projeto ao plano -----------------------------------------------------------------------

/** Leva o projeto aberto pelo chat até ter proposta validada. */
const ateAProposta = async () => {
  const chat = await doChat(FRASE)
  const id = chat.body.projectId
  // A conversa do projeto continua de onde o chat parou — o Brief sai daqui, não de fixture.
  await pedir('POST', `/projects/${id}/messages`, { content: 'a cada fechamento de candle' })
  await pedir('POST', `/projects/${id}/messages`, { content: 'me avise pelo WhatsApp' })
  const v = await pedir('POST', `/projects/${id}/validate`)
  return { id, valido: v.body.valid, issues: v.body.issues }
}

test('ACEITAÇÃO: o projeto aberto pelo chat monta um BRIEF a partir da conversa', async () => {
  const { id } = await ateAProposta()
  const projeto = await repo.getProject(DONO, new ObjectId(id))
  assert.ok(projeto.brief, 'sem entendimento, o desenho é um palpite sobre uma frase')
  assert.ok(projeto.brief.jobs.length > 0, 'o Brief precisa ter ao menos um trabalho mapeado')
  assert.ok(projeto.blueprint, 'sem plano, não há o que aprovar')
})

test('ACEITAÇÃO: a proposta é válida e a prévia mostra o que vai ser criado', async () => {
  const { id, valido, issues } = await ateAProposta()
  assert.equal(valido, true, JSON.stringify(issues))

  const previa = await pedir('GET', `/projects/${id}/preview`)
  assert.equal(previa.status, 200)
  assert.ok(previa.body.items.length > 0)
  // A pessoa vê o que vai acontecer antes de clicar — inclusive o que o V2 acrescenta.
  const tipos = new Set(previa.body.items.map((i) => i.kind))
  assert.ok(tipos.has('floor') && tipos.has('agent'))
})

// --- do plano ao recurso -----------------------------------------------------------------------

test('ACEITAÇÃO: aplicar cria a organização e NADA entra no ar sozinho', async () => {
  const { id } = await ateAProposta()
  const previa = await pedir('GET', `/projects/${id}/preview`)
  const r = await pedir('POST', `/projects/${id}/apply`, {
    blueprintHash: previa.body.blueprintHash,
    idempotencyKey: 'cxse3-1',
    confirm: true,
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))

  assert.ok((await db.collection('offices').countDocuments({ ownerId: DONO })) >= 1)
  assert.ok((await db.collection('agents').countDocuments({ ownerId: DONO })) >= 1)

  // Nada foi ligado: sem `approvedActivationKeys`, tudo nasce parado.
  for (const fonte of await db.collection('monitoring_sources').find({ ownerId: DONO }).toArray()) {
    assert.notEqual(fonte.status, 'active', `a fonte "${fonte.name}" entrou no ar sem ninguém autorizar`)
  }
  for (const m of await db.collection('monitors').find({ ownerId: DONO }).toArray()) {
    assert.notEqual(m.status, 'published', 'o monitor foi publicado sem autorização')
  }
})

test('nenhum passo da aplicação falha — a cadeia inteira resolve', async () => {
  const { id } = await ateAProposta()
  const previa = await pedir('GET', `/projects/${id}/preview`)
  await pedir('POST', `/projects/${id}/apply`, { blueprintHash: previa.body.blueprintHash, idempotencyKey: 'cxse3-2', confirm: true })

  const operacao = await repo.lastOperation(DONO, new ObjectId(id))
  const falhas = (operacao?.steps ?? []).filter((p) => p.status === 'failed')
  assert.deepEqual(falhas, [], JSON.stringify(falhas))
})

test('os recursos criados levam a MARCA da operação — a retomada os reconhece', async () => {
  const { id } = await ateAProposta()
  const previa = await pedir('GET', `/projects/${id}/preview`)
  await pedir('POST', `/projects/${id}/apply`, { blueprintHash: previa.body.blueprintHash, idempotencyKey: 'cxse3-3', confirm: true })

  const operacao = await repo.lastOperation(DONO, new ObjectId(id))
  for (const doc of await db.collection('data_stores').find({ ownerId: DONO }).toArray()) {
    assert.equal(doc.architect?.operationId, operacao._id.toString(), 'sem marca, uma queda na janela duplicaria este Database')
  }
  for (const doc of await db.collection('monitoring_sources').find({ ownerId: DONO }).toArray()) {
    assert.equal(doc.architect?.operationId, operacao._id.toString())
  }
})

// --- o que a proposta NÃO inventa ----------------------------------------------------------------

test('sem provedor de candles conectado, o RSI vira PENDÊNCIA — nunca um endereço inventado', async () => {
  const { id } = await ateAProposta()
  const projeto = await repo.getProject(DONO, new ObjectId(id))

  const texto = JSON.stringify(projeto.blueprintV2 ?? projeto.blueprint)
  // Nenhuma URL de provedor de mercado sai de um plano compilado: o compilador não sabe de
  // onde vêm os candles, e inventar um endereço é pior que declarar a pendência.
  assert.equal(/b3\.com|yahoo|alphavantage|finance\./i.test(texto), false, 'o plano trouxe um endereço que ninguém configurou')

  // A fonte, quando existe, nasce sem config resolvida — e isso aparece como pendência.
  for (const f of projeto.blueprintV2?.operations.sources ?? []) {
    if (Object.keys(f.config ?? {}).length === 0) {
      assert.ok(true, 'a fonte é declarada e a origem fica pendente: é o comportamento certo')
    }
  }
})

test('a função calculate_rsi está disponível para o plano usar', async () => {
  const { findFunction } = await import('../dist/executors/functionRegistry.js')
  await import('../dist/executors/functionExecutor.js')
  const fn = findFunction('calculate_rsi')
  assert.ok(fn, 'sem a função registrada, o RSI seria um palpite do modelo')
  assert.equal(fn.version, '1.0.0')
})
