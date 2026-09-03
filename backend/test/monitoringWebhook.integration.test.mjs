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

/**
 * O instante vai por padrão — é o que um provedor que assina de verdade manda.
 *
 * A fonte nasce com `timestampPolicy: 'required'`: sem instante, a assinatura não envelhece
 * e uma requisição capturada hoje valeria para sempre. `semTimestamp: true` exercita
 * justamente essa recusa.
 */
const entregar = (corpo, over = {}) =>
  wh.receiveWebhook(over.publicKey ?? credencial.publicKey, corpo, {
    'x-signature': over.signature ?? signBody(over.secret ?? credencial.secret, corpo),
    ...(over.eventId ? { 'x-event-id': over.eventId } : {}),
    ...(over.semTimestamp ? {} : { 'x-timestamp': String(over.timestamp ?? (over.agora ?? new Date()).getTime()) }),
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

// --- uma identidade por LINHA -------------------------------------------------------------

test('uma entrega com VÁRIAS linhas grava várias — não uma', async () => {
  // O mesmo `factId` para todas as linhas fazia o motor de histórico ver a segunda como
  // repetição da primeira e descartá-la. As outras sumiam sem erro nenhum.
  const emLista = await svc.createSource(DONO, {
    name: 'Pedidos em lote',
    kind: 'webhook',
    config: {},
    cadence: { mode: 'stream' },
    mapping: {
      version: 1,
      itemsPath: 'pedidos',
      fields: [{ to: 'pedido', from: 'id', required: true }, { to: 'total', from: 'valor', transforms: [{ op: 'number' }] }],
    },
    destination: { history: true },
  })
  const cred = await wh.rotateWebhookSecret(DONO, emLista._id)
  await svc.setSourceStatus(DONO, emLista._id, 'active')
  limparCacheDeRecorders()

  const corpo = JSON.stringify({ pedidos: [{ id: 'a', valor: '1' }, { id: 'b', valor: '2' }, { id: 'c', valor: '3' }] })
  const r = await wh.receiveWebhook(cred.publicKey, corpo, {
    'x-signature': signBody(cred.secret, corpo),
    'x-event-id': 'lote-1',
    'x-timestamp': String(Date.now()),
  })
  assert.equal(r.ok, true)
  assert.equal(r.recorded, 3, 'três pedidos são três fatos')

  const gravados = await db.collection('data_history_records').find({ ownerId: DONO }).toArray()
  assert.deepEqual(gravados.map((g) => g.value.pedido).sort(), ['a', 'b', 'c'])
})

test('o mesmo LOTE reenviado continua sendo um só — a identidade por linha é estável', async () => {
  const emLista = await svc.createSource(DONO, {
    name: 'Lote repetido',
    kind: 'webhook',
    config: {},
    cadence: { mode: 'stream' },
    mapping: { version: 1, itemsPath: 'pedidos', fields: [{ to: 'pedido', from: 'id', required: true }] },
    destination: { history: true },
  })
  const cred = await wh.rotateWebhookSecret(DONO, emLista._id)
  await svc.setSourceStatus(DONO, emLista._id, 'active')
  limparCacheDeRecorders()

  const corpo = JSON.stringify({ pedidos: [{ id: 'a' }, { id: 'b' }] })
  const cabecalhos = () => ({ 'x-signature': signBody(cred.secret, corpo), 'x-event-id': 'lote-2', 'x-timestamp': String(Date.now()) })
  assert.equal((await wh.receiveWebhook(cred.publicKey, corpo, cabecalhos())).recorded, 2)
  assert.equal((await wh.receiveWebhook(cred.publicKey, corpo, cabecalhos())).reason, 'duplicate')
  assert.equal(await db.collection('data_history_records').countDocuments({ ownerId: DONO }), 2)
})

// --- política de instante -----------------------------------------------------------------

test('AMEAÇA: sem instante, a fonte estrita recusa — o replay é só reenviar os mesmos bytes', async () => {
  const r = await entregar(CORPO, { eventId: 'sem-ts', semTimestamp: true })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'unauthorized')
  assert.equal(await db.collection('data_history_records').countDocuments({ ownerId: DONO }), 0)
})

test('a fonte que ESCOLHEU aceitar sem instante continua funcionando', async () => {
  // Provedor que não manda instante existe. Recusar a entrega dele seria trocar um risco
  // por uma fonte que não funciona — a escolha fica gravada onde dá para auditar.
  const frouxa = await svc.createSource(DONO, {
    name: 'Provedor sem instante',
    kind: 'webhook',
    config: { timestampPolicy: 'optional' },
    cadence: { mode: 'stream' },
    mapping: { version: 1, fields: [{ to: 'pedido', from: 'id', required: true }] },
    destination: { history: true },
  })
  assert.equal(frouxa.config.timestampPolicy, 'optional')
  const cred = await wh.rotateWebhookSecret(DONO, frouxa._id)
  await svc.setSourceStatus(DONO, frouxa._id, 'active')
  limparCacheDeRecorders()

  const corpo = JSON.stringify({ id: 'x-1' })
  const r = await wh.receiveWebhook(cred.publicKey, corpo, { 'x-signature': signBody(cred.secret, corpo) })
  assert.equal(r.ok, true)
})

test('uma fonte de webhook nasce EXIGINDO o instante', async () => {
  assert.equal(fonte.config.timestampPolicy, 'required')
})

// --- o reenvio corrigido ------------------------------------------------------------------

test('entrega malformada NÃO bloqueia o reenvio corrigido do mesmo evento', async () => {
  // O registro de idempotência é gravado antes de olhar o corpo, e tem que ser. Mas
  // mantê-lo depois de uma recusa corrigível transformava o mesmo `x-event-id` corrigido em
  // "duplicado" para sempre: do outro lado, alguém reenviava o evento certo e ouvia silêncio.
  const quebrada = await entregar('{isso nao e json', { eventId: 'e-corrige' })
  assert.equal(quebrada.reason, 'mapping')

  const corrigida = await entregar(CORPO, { eventId: 'e-corrige' })
  assert.equal(corrigida.ok, true, 'o reenvio corrigido precisa passar')
  assert.equal(corrigida.recorded, 1)
})

test('entrega sem campo obrigatório também não queima o event-id', async () => {
  const semCampo = await entregar(JSON.stringify({ valor: '9' }), { eventId: 'e-falta' })
  assert.equal(semCampo.reason, 'schema')

  const completa = await entregar(CORPO, { eventId: 'e-falta' })
  assert.equal(completa.ok, true)
})

test('a entrega BOA continua bloqueando o replay dela mesma', async () => {
  assert.equal((await entregar(CORPO, { eventId: 'e-boa' })).ok, true)
  assert.equal((await entregar(CORPO, { eventId: 'e-boa' })).reason, 'duplicate')
})

test('editar um webhook NÃO apaga o endereço que o outro lado já configurou', async () => {
  // A chave pública nasce no servidor e é o endereço configurado do outro lado. Ela não vem
  // no formulário — uma edição a mandaria de volta como `null`, e o endereço deixaria de
  // existir sem ninguém ter pedido isso.
  const antes = (await svc.getSource(DONO, fonte._id)).config.webhookPublicKey
  assert.ok(antes)

  await svc.updateSource(DONO, fonte._id, {
    name: 'Pedidos da loja (revisado)',
    kind: 'webhook',
    config: {},
    cadence: { mode: 'stream' },
    mapping: { version: 1, fields: [{ to: 'pedido', from: 'id', required: true }] },
    destination: { history: true },
  })

  const depois = await svc.getSource(DONO, fonte._id)
  assert.equal(depois.name, 'Pedidos da loja (revisado)')
  assert.equal(depois.config.webhookPublicKey, antes, 'o endereço precisa sobreviver à edição')

  // E a entrega continua chegando no mesmo endereço, com o mesmo segredo.
  const corpo = JSON.stringify({ id: 'depois-da-edicao', valor: '3' })
  const r = await wh.receiveWebhook(antes, corpo, {
    'x-signature': signBody(credencial.secret, corpo),
    'x-event-id': 'pos-edicao',
    'x-timestamp': String(Date.now()),
  })
  assert.equal(r.ok, true)
})

test('AMEAÇA: informar uma chave pública na edição não sequestra o endereço de outra fonte', async () => {
  const outra = await svc.createSource(DONO, {
    name: 'Outra loja',
    kind: 'webhook',
    config: {},
    cadence: { mode: 'stream' },
    mapping: { version: 1, fields: [{ to: 'pedido', from: 'id', required: true }] },
    destination: { history: true },
  })
  const credOutra = await wh.rotateWebhookSecret(DONO, outra._id)

  await svc.updateSource(DONO, fonte._id, {
    name: 'Pedidos da loja',
    kind: 'webhook',
    config: { webhookPublicKey: credOutra.publicKey },
    cadence: { mode: 'stream' },
    mapping: { version: 1, fields: [{ to: 'pedido', from: 'id', required: true }] },
    destination: { history: true },
  })

  const depois = await svc.getSource(DONO, fonte._id)
  assert.equal(depois.config.webhookPublicKey, credencial.publicKey, 'a chave informada pelo cliente é ignorada')
  assert.notEqual(depois.config.webhookPublicKey, credOutra.publicKey)
})
