// A FLAG do Blueprint V2 — e a única coisa que ela não pode fazer: mudar o que já existe.
//
// Desligada, nada acontece: o projeto não ganha `blueprintV2`, a saga não roda o passo do V2
// e o hash é exatamente o que já era. É isso que faz o rollback ser uma variável de ambiente
// em vez de um deploy.
//
// Ligada, os dois documentos têm que descrever UM escritório. O risco concreto: se o V2
// inventasse as próprias `key`s de andar, o Flow dele apontaria para um andar que ninguém
// criou — e a aplicação falharia num passo que não tem defeito.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.LLM_FAKE = '1'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { architectRouter } = await import('../dist/routes/architectRoutes.js')
const repo = await import('../dist/architect/repository.js')
const { architectV2Enabled } = await import('../dist/architect/flags.js')
const { ensureTokenUsageIndexes } = await import('../dist/tokenUsage.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
const { setProviderApiKey } = await import('../dist/userSettings.js')
const { resetGuards } = await import('../dist/architect/guard.js')
const express = (await import('express')).default

const DONO = 'dono-flag-v2'
let server
let port

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
  delete process.env.ARCHITECT_BLUEPRINT_V2
  await new Promise((r) => server.close(r))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['architect_projects', 'architect_messages', 'architect_apply_operations', 'agents', 'sectors', 'offices', 'buildings', 'automations', 'data_stores', 'monitoring_sources', 'monitors'])
    await db.collection(c).deleteMany({})
  resetGuards()
  delete process.env.ARCHITECT_BLUEPRINT_V2
  await setProviderApiKey(DONO, 'anthropic', 'chave-de-teste')
})

const proposta = async () => {
  const criado = await pedir('POST', '/projects', { objective: 'Quero automatizar o atendimento do meu restaurante' })
  const id = criado.body.id
  await pedir('POST', `/projects/${id}/messages`, { content: 'quero automatizar' })
  await pedir('POST', `/projects/${id}/messages`, { content: 'pelo site' })
  return id
}

// --- a flag em si ------------------------------------------------------------------------------

test('a flag nasce DESLIGADA, e um valor qualquer não a liga', () => {
  delete process.env.ARCHITECT_BLUEPRINT_V2
  assert.equal(architectV2Enabled(), false)
  for (const v of ['0', 'false', 'off', 'talvez', '']) {
    process.env.ARCHITECT_BLUEPRINT_V2 = v
    assert.equal(architectV2Enabled(), false, `"${v}" não pode ligar`)
  }
  for (const v of ['1', 'true', 'ON']) {
    process.env.ARCHITECT_BLUEPRINT_V2 = v
    assert.equal(architectV2Enabled(), true, `"${v}" tinha que ligar`)
  }
  delete process.env.ARCHITECT_BLUEPRINT_V2
})

test('DESLIGADA: o projeto continua exatamente como era', async () => {
  const id = await proposta()
  const projeto = await repo.getProject(DONO, new ObjectId(id))
  assert.ok(projeto.blueprint, 'o plano V1 continua sendo montado')
  assert.equal(projeto.blueprintV2, undefined, 'nada de V2 é gravado com a flag desligada')
  assert.equal(projeto.blueprintVersion, 1)
})

test('LIGADA: o projeto ganha o plano V2, sem perder o V1', async () => {
  process.env.ARCHITECT_BLUEPRINT_V2 = '1'
  const id = await proposta()
  const projeto = await repo.getProject(DONO, new ObjectId(id))
  assert.ok(projeto.blueprint, 'o V1 continua existindo: é ele que a saga aplica')
  assert.ok(projeto.blueprintV2, 'o V2 tinha que ser compilado')
  assert.equal(projeto.blueprintVersion, 2)
  assert.equal(projeto.blueprintV2.version, 2)
})

// --- a garantia que evita dois escritórios ---------------------------------------------------------

test('LIGADA: os dois planos descrevem UM escritório — as chaves de andar batem', async () => {
  process.env.ARCHITECT_BLUEPRINT_V2 = '1'
  const id = await proposta()
  const projeto = await repo.getProject(DONO, new ObjectId(id))

  const doV1 = new Set(projeto.blueprint.floors.map((f) => f.key))
  const doV2 = new Set(projeto.blueprintV2.organization.floors.map((f) => f.key))
  assert.deepEqual([...doV2], [...doV1], 'chave de andar diferente cria dois escritórios lado a lado')

  // E tudo que o V2 aponta para um andar aponta para um que o V1 cria.
  const referencias = [
    ...projeto.blueprintV2.organization.agents.map((a) => a.floorKey),
    ...projeto.blueprintV2.operations.flows.map((f) => f.floorKey),
  ].filter(Boolean)
  for (const ref of referencias) assert.ok(doV1.has(ref), `o V2 aponta para o andar "${ref}", que o V1 não cria`)
})

test('LIGADA: aplicar cria UM andar, e não um por plano', async () => {
  process.env.ARCHITECT_BLUEPRINT_V2 = '1'
  const id = await proposta()
  const v = await pedir('POST', `/projects/${id}/validate`)
  assert.equal(v.body.valid, true, JSON.stringify(v.body.issues))
  const previa = await pedir('GET', `/projects/${id}/preview`)

  const r = await pedir('POST', `/projects/${id}/apply`, { blueprintHash: previa.body.blueprintHash, idempotencyKey: 'op-flag', confirm: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(await db.collection('offices').countDocuments({ ownerId: DONO }), 1, 'dois andares seriam o escritório duplicado')
})

test('LIGADA: nenhum passo do V2 falha por andar inexistente', async () => {
  process.env.ARCHITECT_BLUEPRINT_V2 = '1'
  const id = await proposta()
  await pedir('POST', `/projects/${id}/validate`)
  const previa = await pedir('GET', `/projects/${id}/preview`)
  await pedir('POST', `/projects/${id}/apply`, { blueprintHash: previa.body.blueprintHash, idempotencyKey: 'op-flag2', confirm: true })

  const operacao = await repo.lastOperation(DONO, new ObjectId(id))
  const falhas = (operacao?.steps ?? []).filter((p) => p.status === 'failed')
  assert.deepEqual(falhas, [], JSON.stringify(falhas))
})

// --- o rollback da flag -----------------------------------------------------------------------------

test('desligar a flag DEPOIS não quebra um projeto que já tem plano V2', async () => {
  process.env.ARCHITECT_BLUEPRINT_V2 = '1'
  const id = await proposta()
  assert.ok((await repo.getProject(DONO, new ObjectId(id))).blueprintV2)

  // O plano V2 continua gravado; a saga continua sabendo aplicá-lo. Desligar a flag para de
  // COMPILAR planos novos — não apaga nem invalida os que já existem.
  delete process.env.ARCHITECT_BLUEPRINT_V2
  const v = await pedir('POST', `/projects/${id}/validate`)
  assert.equal(v.body.valid, true, JSON.stringify(v.body.issues))
  const previa = await pedir('GET', `/projects/${id}/preview`)
  const r = await pedir('POST', `/projects/${id}/apply`, { blueprintHash: previa.body.blueprintHash, idempotencyKey: 'op-off', confirm: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))
})
