// A FONTE DE WEBHOOK — assinatura, janela e replay, sem criptografia nova.
//
// Assinar, conferir em tempo constante e derivar a chave de idempotência já existe nos
// Flows, testado. O que estes casos cobrem é o que muda: a entrega vira FATO, e as recusas
// que impedem um reenvio de virar um segundo dado.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const svc = await import('../dist/monitoring/service.js')
const wh = await import('../dist/monitoring/webhookSource.js')
const { signBody } = await import('../dist/automations/webhook.js')
const { ensureDataHistoryIndexes, limparCacheDeRecorders } = await import('../dist/dataHistory/store.js').then(async (m) => ({
  ...m,
  limparCacheDeRecorders: (await import('../dist/dataHistory/engine.js')).limparCacheDeRecorders,
}))

const DONO = 'dono-webhook'
let fonte
let credencial

before(async () => {
  await mongoClient.connect()
  await svc.ensureMonitoringIndexes()
  await wh.ensureWebhookIndexes()
  await ensureDataHistoryIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['monitoring_sources', 'monitoring_webhook_deliveries', 'data_recorders', 'data_history_records'])
    await db.collection(c).deleteMany({})
  limparCacheDeRecorders()
  fonte = await svc.createSource(DONO, {
    name: 'Pedidos da loja',
    kind: 'webhook',
    config: {},
    cadence: { mode: 'stream' },
    mapping: { version: 1, fields: [{ to: 'pedido', from: 'id', required: true }, { to: 'total', from: 'valor', transforms: [{ op: 'number' }] }] },
    destination: { history: true },
  })
  credencial = await wh.rotateWebhookSecret(DONO, fonte._id)
  await svc.setSourceStatus(DONO, fonte._id, 'active')
  limparCacheDeRecorders()
})

const entregar = (corpo, over = {}) =>
  wh.receiveWebhook(over.publicKey ?? credencial.publicKey, corpo, {
    'x-signature': over.signature ?? signBody(over.secret ?? credencial.secret, corpo),
    ...(over.eventId ? { 'x-event-id': over.eventId } : {}),
    ...(over.timestamp ? { 'x-timestamp': String(over.timestamp) } : {}),
  }, over.agora)

const CORPO = JSON.stringify({ id: 'p-1', valor: '10,50' })

// --- o caminho feliz -----------------------------------------------------------------

test('ACEITAÇÃO: entrega assinada vira FATO no histórico', async () => {
  const r = await entregar(CORPO)
  assert.equal(r.ok, true)
  assert.equal(r.recorded, 1)
  const registro = await db.collection('data_history_records').findOne({ ownerId: DONO })
  assert.equal(registro.value.pedido, 'p-1')
  assert.equal(registro.value.total, 10.5)
})

test('o segredo NUNCA volta: ele existe cifrado depois de mostrado', async () => {
  const doc = await db.collection('monitoring_sources').findOne({ _id: fonte._id })
  assert.ok(doc.webhookSecretEncrypted)
  assert.ok(!JSON.stringify(doc).includes(credencial.secret), 'um segredo que a tela reexibe vaza no primeiro print')
})

// --- as recusas ------------------------------------------------------------------------

test('AMEAÇA: assinatura errada responde igual a fonte inexistente', async () => {
  // Dizer "existe, mas a assinatura está errada" entrega meia informação a quem está
  // adivinhando endereços.
  const errada = await entregar(CORPO, { secret: 'outro-segredo' })
  const inexistente = await entregar(CORPO, { publicKey: 'nao-existe' })
  assert.equal(errada.reason, 'not_found')
  assert.equal(inexistente.reason, 'not_found')
})

test('AMEAÇA: sem assinatura não entra', async () => {
  const r = await wh.receiveWebhook(credencial.publicKey, CORPO, {})
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'not_found')
})

test('AMEAÇA: corpo alterado derruba a assinatura', async () => {
  const assinado = signBody(credencial.secret, CORPO)
  const r = await wh.receiveWebhook(credencial.publicKey, JSON.stringify({ id: 'p-2', valor: '99' }), { 'x-signature': assinado })
  assert.equal(r.reason, 'not_found')
})

test('AMEAÇA: REPLAY do mesmo evento não vira segundo fato', async () => {
  const primeira = await entregar(CORPO, { eventId: 'evt-1' })
  const repetida = await entregar(CORPO, { eventId: 'evt-1' })
  assert.equal(primeira.ok, true)
  assert.equal(repetida.reason, 'duplicate')
  assert.equal(await db.collection('data_history_records').countDocuments({ ownerId: DONO }), 1)
})

test('AMEAÇA: sem event-id, o HASH do corpo é a identidade', async () => {
  await entregar(CORPO)
  const repetida = await entregar(CORPO)
  assert.equal(repetida.reason, 'duplicate')
})

test('AMEAÇA: entrega velha é recusada — a assinatura não envelhece sozinha', async () => {
  const antiga = await entregar(CORPO, { eventId: 'e-velho', timestamp: Date.now() - 30 * 60_000 })
  assert.equal(antiga.reason, 'unauthorized')
  assert.equal(await db.collection('data_history_records').countDocuments({ ownerId: DONO }), 0)
})

test('entrega dentro da janela passa', async () => {
  const r = await entregar(CORPO, { eventId: 'e-novo', timestamp: Date.now() })
  assert.equal(r.ok, true)
})

test('fonte PAUSADA não recebe', async () => {
  await svc.setSourceStatus(DONO, fonte._id, 'paused')
  const r = await entregar(CORPO, { eventId: 'e-pausada' })
  assert.equal(r.reason, 'paused')
})

test('corpo que não bate com o schema é recusado, e não gravado pela metade', async () => {
  const r = await entregar(JSON.stringify({ valor: '9' }), { eventId: 'e-sem-id' })
  assert.equal(r.reason, 'schema')
  assert.equal(await db.collection('data_history_records').countDocuments({ ownerId: DONO }), 0)
})

test('corpo que não é JSON é recusado', async () => {
  const r = await entregar('isto não é json', { eventId: 'e-texto' })
  assert.equal(r.reason, 'mapping')
})

// --- a rotação -------------------------------------------------------------------------

test('girar o segredo mantém a URL: o outro lado não precisa ser reconfigurado', async () => {
  const nova = await wh.rotateWebhookSecret(DONO, fonte._id)
  assert.equal(nova.publicKey, credencial.publicKey, 'trocar a URL junto seria obrigar o outro lado por um motivo nosso')
  assert.notEqual(nova.secret, credencial.secret)

  // O segredo velho para de valer na mesma hora.
  assert.equal((await entregar(CORPO, { secret: credencial.secret, eventId: 'e-velho-segredo' })).reason, 'not_found')
  assert.equal((await entregar(CORPO, { secret: nova.secret, eventId: 'e-novo-segredo' })).ok, true)
})

test('girar o segredo de fonte de outra conta não acontece', async () => {
  assert.equal(await wh.rotateWebhookSecret('vizinho', fonte._id), null)
})

test('girar o segredo de uma fonte que não é webhook é recusado', async () => {
  const api = await svc.createSource(DONO, {
    name: 'API',
    kind: 'api_polling',
    config: { url: 'https://exemplo.test/x' },
    cadence: { mode: 'interval', intervalMs: 60_000 },
    mapping: { version: 1, fields: [{ to: 'a', from: 'a' }] },
    destination: { history: true },
  })
  await assert.rejects(() => wh.rotateWebhookSecret(DONO, api._id), /não é um webhook/)
})
