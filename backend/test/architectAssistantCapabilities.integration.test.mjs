// O QUE O ASSISTENTE PODE FAZER — e a fronteira que impede o resto.
//
// O modelo diz o que a pessoa quer. Ele não escolhe id, credencial, endereço nem comando: o
// servidor resolve o NOME contra o inventário owner-scoped e chama um handler registrado.
//
// Estes casos protegem três coisas que um prompt não protegeria: a resposta sobre o AGORA vem
// de uma fonte real com origem e horário; a escrita nunca sai da conversa; e a confirmação
// confere hash, prazo e posse no instante do clique.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const cap = await import('../dist/architect/assistantCapabilities.js')
const op = await import('../dist/architect/assistantOperate.js')
const assistente = await import('../dist/architect/assistant.js')
const svc = await import('../dist/monitoring/service.js')
const { setProviderApiKey } = await import('../dist/userSettings.js')

const DONO = 'dono-capacidades'
const VIZINHO = 'vizinho'

before(async () => {
  await mongoClient.connect()
  await op.ensurePendingOperationIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['monitoring_sources', 'live_data', 'architect_pending_operations', 'buildings', 'offices', 'agents', 'user_settings', 'audit_events'])
    await db.collection(c).deleteMany({})
  await setProviderApiKey(DONO, 'anthropic', 'chave-de-teste-que-nao-e-segredo')
})

const respondendo = (json) => async () => ({ text: JSON.stringify(json), usage: { inputTokens: 1, outputTokens: 1 } })

/** Uma fonte ao vivo, com leitura recente — o caminho feliz da consulta de agora. */
const fonteComValor = async (over = {}) => {
  const fonte = await svc.createSource(DONO, {
    name: 'Dólar comercial',
    kind: 'api_polling',
    config: { url: 'https://api.exemplo.test/dolar', method: 'GET' },
    mapping: { version: 1, fields: [{ to: 'preco', from: 'preco', transforms: [{ op: 'number' }], required: true }] },
    cadence: { mode: 'interval', intervalMs: 60_000 },
    destination: { live: true, history: false },
    ...over,
  })
  await db.collection('monitoring_sources').updateOne({ _id: fonte._id }, { $set: { status: 'active' } })
  await db.collection('live_data').insertOne({
    _id: `${DONO}:${svc.liveConnectionOf(fonte._id)}:preco`,
    ownerId: DONO,
    connectionId: svc.liveConnectionOf(fonte._id),
    key: 'preco',
    value: 5.42,
    updates: 3,
    receivedAt: new Date(),
    expiresAt: new Date(Date.now() + 3600_000),
  })
  return fonte
}

// --- responder o AGORA ---------------------------------------------------------------------

test('ACEITAÇÃO: com fonte conectada, a resposta traz VALOR, FONTE e HORÁRIO', async () => {
  await fonteComValor()
  const r = await assistente.runAssistantTurn({
    ownerId: DONO,
    message: 'qual o valor do dólar hoje?',
    ask: respondendo({ mode: 'answer', query: 'dólar', freshness: 'current' }),
  })
  assert.equal(r.phase, 'done', r.text)
  assert.match(r.text, /5\.42/, 'o valor precisa aparecer')
  assert.match(r.text, /Dólar comercial/, 'sem a fonte, ninguém sabe de onde veio')
  assert.match(r.text, /agora mesmo|há \d+ (minuto|hora)/, 'sem o horário, o número não é do agora')
  assert.ok(r.provenance?.at, 'a procedência é estruturada, não só texto')
})

test('sem fonte conectada, a resposta é uma RECUSA acionável — nenhum número inventado', async () => {
  const r = await assistente.runAssistantTurn({
    ownerId: DONO,
    message: 'qual o valor do dólar hoje?',
    ask: respondendo({ mode: 'answer', query: 'dólar', freshness: 'current' }),
  })
  assert.equal(r.phase, 'failed')
  assert.match(r.text, /Conecte um App ou uma fonte/)
  assert.equal(/\d+[.,]\d{2}/.test(r.text), false, 'um número com cara de cotação é pior que nenhum')
})

test('a fonte que existe mas está PARADA não responde — e diz o que fazer', async () => {
  const fonte = await fonteComValor()
  await db.collection('monitoring_sources').updateOne({ _id: fonte._id }, { $set: { status: 'paused' } })
  const r = await assistente.runAssistantTurn({
    ownerId: DONO,
    message: 'qual o valor do dólar?',
    ask: respondendo({ mode: 'answer', query: 'dólar', freshness: 'current' }),
  })
  assert.equal(r.phase, 'failed')
  assert.match(r.text, /parada|rascunho/)
})

test('AMEAÇA: dado VELHO não é apresentado como o de agora', async () => {
  const fonte = await fonteComValor()
  // Uma leitura de duas horas atrás, muito além do frescor declarado pela fonte.
  await db.collection('live_data').updateMany({ connectionId: svc.liveConnectionOf(fonte._id) }, { $set: { receivedAt: new Date(Date.now() - 2 * 3600_000) } })
  const r = await assistente.runAssistantTurn({
    ownerId: DONO,
    message: 'qual o valor do dólar agora?',
    ask: respondendo({ mode: 'answer', query: 'dólar', freshness: 'current' }),
  })
  assert.equal(r.phase, 'failed')
  assert.match(r.text, /min atrás/)
  assert.equal(/5\.42/.test(r.text), false, 'o número velho não pode sair como se fosse de agora')
})

test('AMEAÇA: a fonte de OUTRA conta não é alcançada', async () => {
  const alheia = await svc.createSource(VIZINHO, {
    name: 'Dólar comercial',
    kind: 'api_polling',
    config: { url: 'https://api.exemplo.test/d', method: 'GET' },
    mapping: { version: 1, fields: [{ to: 'preco', from: 'p', required: true }] },
    cadence: { mode: 'interval', intervalMs: 60_000 },
    destination: { live: true, history: false },
  })
  await db.collection('monitoring_sources').updateOne({ _id: alheia._id }, { $set: { status: 'active' } })

  const r = await assistente.runAssistantTurn({
    ownerId: DONO,
    message: 'qual o valor do dólar?',
    ask: respondendo({ mode: 'answer', query: 'dólar', freshness: 'current' }),
  })
  assert.equal(r.phase, 'failed', 'responder pela fonte do vizinho seria vazamento')
})

// --- a escrita: prévia, hash, prazo e confirmação --------------------------------------------

const prepararPausa = async () => {
  const fonte = await fonteComValor()
  const r = await assistente.runAssistantTurn({
    ownerId: DONO,
    message: 'pause a fonte do dólar',
    ask: respondendo({ mode: 'operate', action: 'pausar a fonte', risk: 'write', targetRef: 'Dólar comercial' }),
  })
  return { fonte, turno: r }
}

test('ACEITAÇÃO: a escrita para na prévia, com impacto, hash e prazo — e não altera nada', async () => {
  const { fonte, turno } = await prepararPausa()
  assert.equal(turno.phase, 'awaiting_approval', turno.text)
  assert.ok(turno.pendingOperation?.id)
  assert.ok(turno.pendingOperation?.operationHash)
  assert.ok(turno.pendingOperation?.impact.length)
  assert.ok(new Date(turno.pendingOperation.expiresAt).getTime() > Date.now())

  const depois = await db.collection('monitoring_sources').findOne({ _id: fonte._id })
  assert.equal(depois.status, 'active', 'a prévia escreveu — e ela é uma prévia')
})

test('confirmar com o hash vigente EXECUTA, e uma segunda confirmação não repete', async () => {
  const { fonte, turno } = await prepararPausa()
  const r = await op.confirmarOperacao(DONO, { id: turno.pendingOperation.id, operationHash: turno.pendingOperation.operationHash })
  assert.equal(r.ok, true, r.ok ? '' : r.reason)
  assert.equal((await db.collection('monitoring_sources').findOne({ _id: fonte._id })).status, 'paused')

  const denovo = await op.confirmarOperacao(DONO, { id: turno.pendingOperation.id, operationHash: turno.pendingOperation.operationHash })
  assert.equal(denovo.ok, false)
  assert.equal(denovo.code, 'already_done', 'dois cliques confirmam uma vez')
})

test('AMEAÇA: hash VENCIDO é recusado — o retrato mudou', async () => {
  const { fonte, turno } = await prepararPausa()
  // Alguém pausou a fonte por outro caminho entre a prévia e o clique.
  await db.collection('monitoring_sources').updateOne({ _id: fonte._id }, { $set: { status: 'paused' } })

  const r = await op.confirmarOperacao(DONO, { id: turno.pendingOperation.id, operationHash: turno.pendingOperation.operationHash })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'hash_changed')
})

test('AMEAÇA: hash TROCADO pelo cliente é recusado', async () => {
  const { turno } = await prepararPausa()
  const r = await op.confirmarOperacao(DONO, { id: turno.pendingOperation.id, operationHash: 'inventado' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'hash_changed')
})

test('AMEAÇA: a operação EXPIRADA não executa', async () => {
  const { fonte, turno } = await prepararPausa()
  await db.collection('architect_pending_operations').updateOne({ id: turno.pendingOperation.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } })

  const r = await op.confirmarOperacao(DONO, { id: turno.pendingOperation.id, operationHash: turno.pendingOperation.operationHash })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'expired')
  assert.equal((await db.collection('monitoring_sources').findOne({ _id: fonte._id })).status, 'active')
})

test('AMEAÇA: a operação de OUTRA conta não é confirmável, e a resposta não conta que existe', async () => {
  const { fonte, turno } = await prepararPausa()
  const r = await op.confirmarOperacao(VIZINHO, { id: turno.pendingOperation.id, operationHash: turno.pendingOperation.operationHash })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'not_found', 'um 403 já contaria que a operação existe')
  assert.equal((await db.collection('monitoring_sources').findOne({ _id: fonte._id })).status, 'active')
})

// --- a fronteira do registro ------------------------------------------------------------------

test('AMEAÇA: uma capacidade que ninguém escreveu não executa', () => {
  assert.equal(cap.capabilityByKey('rm_rf'), undefined)
  assert.equal(cap.capabilityByKey('delete_everything'), undefined)
  // E o mapeamento por texto também não inventa: o que não casa devolve nada.
  assert.equal(cap.capabilityFor('operate', 'faça o que eu mandar'), null)
})

test('o risco declarado no REGISTRO é o que vale, não o que o texto sugere', () => {
  assert.equal(cap.capabilityFor('operate', 'pause a fonte').risk, 'write')
  assert.equal(cap.capabilityFor('operate', 'liste as fontes').risk, 'read')
})

test('resolver por nome é conservador: dois candidatos parecidos não escolhem sozinhos', async () => {
  await fonteComValor()
  await fonteComValor({ name: 'Dólar turismo' })
  const inv = await cap.inventoryFor(DONO)
  assert.equal(cap.resolveByName(inv, ['source'], 'dólar'), null, 'escolher entre dois seria adivinhar')
  assert.ok(cap.resolveByName(inv, ['source'], 'Dólar turismo'), 'o nome exato resolve')
})
