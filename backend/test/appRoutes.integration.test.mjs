// INTEGRATION: the Apps API against a REAL mongod and a REAL express app wired the
// way index.ts wires it.
//
// The load-bearing claims: a credential goes in and never comes back out; an id from
// another account resolves to nothing; a grant cannot authorise an action the
// manifest does not declare, cannot authorise a write that was not granted, and
// cannot smuggle a secret into the agent document.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { ensureAuditIndexes, listAuditEvents } = await import('../dist/audit.js')
const { auditRequests } = await import('../dist/routes/auditMiddleware.js')
const { appCatalogRouter } = await import('../dist/routes/appRoutes.js')
const { appInstallationRouter } = await import('../dist/routes/appInstallationRoutes.js')
const { appGrantRouter } = await import('../dist/routes/appGrantRoutes.js')
const express = (await import('express')).default

const OWNER = 'apps-owner'
const OTHER = 'apps-other'
const agents = () => db.collection('agents')
const connections = () => db.collection('connections')

let server
let port
let sessionOwner = OWNER
let AGENT

before(async () => {
  await mongoClient.connect()
  await ensureAuditIndexes()

  const app = express()
  app.use(express.json())
  app.use(auditRequests)
  const auth = (_req, res, next) => {
    res.locals.userId = sessionOwner
    next()
  }
  app.use('/api/apps', auth, appCatalogRouter)
  app.use('/api/app-installations', auth, appInstallationRouter)
  app.use('/api/agents/:agentId', auth, appGrantRouter)

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port
      resolve()
    })
  })
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  sessionOwner = OWNER
  await Promise.all([agents().deleteMany({}), connections().deleteMany({}), db.collection('audit_events').deleteMany({})])
  AGENT = new ObjectId()
  await agents().insertOne({ _id: AGENT, ownerId: OWNER, officeId: new ObjectId(), name: 'Atendente' })
})

const call = async (method, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const connectSlack = (url = 'https://hooks.slack.com/services/SECRETO') =>
  call('POST', '/api/app-installations', { appKey: 'slack', name: 'Vendas', config: { webhookUrl: url } })

// --- catálogo -------------------------------------------------------------------

test('o catálogo mostra o que o dono precisa saber antes de conectar', async () => {
  const { status, body } = await call('GET', '/api/apps/catalog')
  assert.equal(status, 200)
  const google = body.find((a) => a.key === 'google')
  assert.ok(google.allowedDomains.length > 0)
  assert.ok(google.actions.every((a) => a.risk))
  assert.ok(google.dataAccess.length > 0)
  assert.equal(google.connected, false)
  // Nada do que é interno sai daqui.
  assert.ok(!JSON.stringify(body).includes('adapter'))
})

test('o detalhe do App lista as conexões do dono e nenhuma de outro', async () => {
  await connectSlack()
  sessionOwner = OTHER
  const alheio = await call('GET', '/api/apps/catalog/slack')
  assert.deepEqual(alheio.body.installations, [])
  sessionOwner = OWNER
  const meu = await call('GET', '/api/apps/catalog/slack')
  assert.equal(meu.body.installations.length, 1)
  assert.equal(meu.body.connected, true)
})

test('App desconhecido é 404', async () => {
  assert.equal((await call('GET', '/api/apps/catalog/inexistente')).status, 404)
})

// --- instalações ----------------------------------------------------------------

test('conectar guarda a credencial cifrada e nunca a devolve', async () => {
  const { status, body } = await connectSlack()
  assert.equal(status, 201)
  assert.equal(body.name, 'Vendas')
  assert.equal(body.status, 'connected')
  assert.ok(!JSON.stringify(body).includes('SECRETO'))

  const raw = await connections().findOne({ _id: new ObjectId(body.id) })
  assert.ok(!raw.encryptedConfig.includes('SECRETO'))

  const lista = await call('GET', '/api/app-installations')
  assert.ok(!JSON.stringify(lista.body).includes('SECRETO'))
  assert.ok(!JSON.stringify(lista.body).includes('encryptedConfig'))
})

test('campo obrigatório ausente é 400, não uma conexão quebrada', async () => {
  const { status, body } = await call('POST', '/api/app-installations', { appKey: 'slack', config: {} })
  assert.equal(status, 400)
  assert.match(body.message, /Webhook/)
  assert.equal(await connections().countDocuments({}), 0)
})

test('App conectado por OAuth não aceita credencial digitada', async () => {
  const { status } = await call('POST', '/api/app-installations', { appKey: 'google', config: { token: 'x' } })
  assert.equal(status, 400)
})

test('a instalação de outro dono é 404, não 403', async () => {
  const { body } = await connectSlack()
  sessionOwner = OTHER
  assert.equal((await call('GET', `/api/app-installations/${body.id}`)).status, 404)
  assert.equal((await call('PATCH', `/api/app-installations/${body.id}`, { name: 'roubada' })).status, 404)
  assert.equal((await call('DELETE', `/api/app-installations/${body.id}`)).status, 404)
})

test('renomear não apaga a credencial e omitir o campo mantém a atual', async () => {
  const { body } = await connectSlack()
  const renamed = await call('PATCH', `/api/app-installations/${body.id}`, { name: 'Canal novo' })
  assert.equal(renamed.body.name, 'Canal novo')
  const test = await call('POST', `/api/app-installations/${body.id}/test`)
  assert.equal(test.body.ok, true)
})

test('desconectar revoga sem apagar a linha; purge é uma ação separada', async () => {
  const { body } = await connectSlack()
  const revoked = await call('DELETE', `/api/app-installations/${body.id}`)
  assert.deepEqual(revoked.body, { revoked: true })
  assert.equal(await connections().countDocuments({}), 1)
  const after = await call('GET', `/api/app-installations/${body.id}`)
  assert.equal(after.body.status, 'revoked')

  const purged = await call('DELETE', `/api/app-installations/${body.id}?purge=true`)
  assert.deepEqual(purged.body, { deleted: true })
  assert.equal(await connections().countDocuments({}), 0)
})

test('testar uma conexão revogada não finge que está tudo bem', async () => {
  const { body } = await connectSlack()
  await call('DELETE', `/api/app-installations/${body.id}`)
  const { status, body: result } = await call('POST', `/api/app-installations/${body.id}/test`)
  assert.equal(status, 400)
  assert.equal(result.ok, false)
})

test('reconectar explica como, sem executar troca de credencial', async () => {
  const { body } = await connectSlack()
  const { body: how } = await call('POST', `/api/app-installations/${body.id}/reconnect`)
  assert.equal(how.kind, 'credential')
  assert.ok(how.fields.some((f) => f.key === 'webhookUrl'))
  // A definição do campo viaja; o valor não.
  assert.ok(!JSON.stringify(how).includes('SECRETO'))
})

test('a lista avisa quantos agentes dependem da conexão', async () => {
  const { body } = await connectSlack()
  await call('PATCH', `/api/agents/${AGENT}/app-grants`, {
    grants: [{ installationId: body.id, actionKeys: ['slack_notificar'], autonomousWriteActionKeys: ['slack_notificar'] }],
  })
  const { body: lista } = await call('GET', '/api/app-installations')
  assert.equal(lista[0].agentCount, 1)
})

test('conectar, testar e desconectar ficam na trilha de auditoria', async () => {
  const { body } = await connectSlack()
  await call('POST', `/api/app-installations/${body.id}/test`)
  await call('DELETE', `/api/app-installations/${body.id}`)
  const { items } = await listAuditEvents(OWNER, {}, { limit: 25 })
  const actions = items.map((e) => e.action)
  assert.ok(actions.includes('create'))
  assert.ok(actions.includes('test'))
  assert.ok(actions.includes('disconnect'))
  assert.ok(!JSON.stringify(items).includes('SECRETO'))
})

// --- grants ----------------------------------------------------------------------

const grant = (over = {}) => ({ actionKeys: ['slack_notificar'], resourceConfig: {}, autonomousWriteActionKeys: [], ...over })

test('conceder uma ação exige uma conexão real do dono', async () => {
  const alheia = new ObjectId().toString()
  const { status } = await call('PATCH', `/api/agents/${AGENT}/app-grants`, { grants: [grant({ installationId: alheia })] })
  assert.equal(status, 400)
})

test('não é possível conceder uma ação que o manifesto não declara', async () => {
  const { body } = await connectSlack()
  const { status, body: err } = await call('PATCH', `/api/agents/${AGENT}/app-grants`, {
    grants: [grant({ installationId: body.id, actionKeys: ['slack_apagar_workspace'] })],
  })
  assert.equal(status, 400)
  assert.match(err.message, /desconhecida/)
})

test('não é possível autorizar escrita que não foi concedida', async () => {
  const { body } = await connectSlack()
  const { status } = await call('PATCH', `/api/agents/${AGENT}/app-grants`, {
    grants: [grant({ installationId: body.id, actionKeys: [], autonomousWriteActionKeys: ['slack_notificar'] })],
  })
  assert.equal(status, 400)
})

test('uma credencial não pode ser salva no documento do agente', async () => {
  const { body } = await connectSlack()
  const { status, body: err } = await call('PATCH', `/api/agents/${AGENT}/app-grants`, {
    grants: [grant({ installationId: body.id, resourceConfig: { webhookUrl: 'https://hooks.slack.com/services/OUTRO' } })],
  })
  assert.equal(status, 400)
  assert.match(err.message, /[Cc]redencial/)
  const agent = await agents().findOne({ _id: AGENT })
  assert.ok(!JSON.stringify(agent).includes('hooks.slack.com'))
})

test('seleção de recurso não declarada é descartada em silêncio', async () => {
  await connections().insertOne({
    _id: new ObjectId('66aa00000000000000000001'),
    ownerId: OWNER,
    appKey: 'google',
    appVersion: '1.0.0',
    name: 'Google',
    status: 'connected',
    encryptedConfig: '',
    publicMetadata: {},
    grantedScopes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const { status, body } = await call('PATCH', `/api/agents/${AGENT}/app-grants`, {
    grants: [
      {
        installationId: '66aa00000000000000000001',
        actionKeys: ['google_agenda_listar_eventos'],
        resourceConfig: { calendarId: 'agenda@x', qualquerCoisa: 'ignorado' },
        autonomousWriteActionKeys: [],
      },
    ],
  })
  assert.equal(status, 200)
  assert.deepEqual(body[0].resourceConfig, { calendarId: 'agenda@x' })
})

test('campo de recurso obrigatório é exigido antes de conceder a ação', async () => {
  await connections().insertOne({
    _id: new ObjectId('66aa00000000000000000002'),
    ownerId: OWNER,
    appKey: 'google',
    appVersion: '1.0.0',
    name: 'Google',
    status: 'connected',
    encryptedConfig: '',
    publicMetadata: {},
    grantedScopes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const { status, body } = await call('PATCH', `/api/agents/${AGENT}/app-grants`, {
    grants: [
      { installationId: '66aa00000000000000000002', actionKeys: ['google_sheets_registrar'], resourceConfig: {}, autonomousWriteActionKeys: [] },
    ],
  })
  assert.equal(status, 400)
  assert.match(body.message, /planilha/i)
})

test('revogar a permissão substitui o conjunto inteiro de uma vez', async () => {
  const { body } = await connectSlack()
  await call('PATCH', `/api/agents/${AGENT}/app-grants`, {
    grants: [grant({ installationId: body.id, autonomousWriteActionKeys: ['slack_notificar'] })],
  })
  const cleared = await call('PATCH', `/api/agents/${AGENT}/app-grants`, { grants: [] })
  assert.deepEqual(cleared.body, [])
  const agent = await agents().findOne({ _id: AGENT })
  assert.deepEqual(agent.appGrants, [])
})

test('o agente de outro dono não é encontrado', async () => {
  sessionOwner = OTHER
  assert.equal((await call('GET', `/api/agents/${AGENT}/app-grants`)).status, 404)
  assert.equal((await call('PATCH', `/api/agents/${AGENT}/app-grants`, { grants: [] })).status, 404)
})
