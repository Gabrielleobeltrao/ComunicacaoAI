// QUEM ALCANÇA UMA FONTE — com a mesma precedência do resto do produto.
//
// A regra não é nova de propósito: `deny` vence qualquer `allow`, e entre permissões a
// mais específica ganha. Inventar uma precedência própria faria a mesma pergunta ter duas
// respostas dependendo do recurso — e a errada seria descoberta em produção.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const svc = await import('../dist/monitoring/service.js')
const acesso = await import('../dist/monitoring/access.js')

const DONO = 'dono-grants'
const BUILDING = new ObjectId()
const FLOOR = new ObjectId()
const SECTOR = new ObjectId()
let fonte
let agentId

before(async () => {
  await mongoClient.connect()
  await svc.ensureMonitoringIndexes()
  await acesso.ensureSourceGrantIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['monitoring_sources', 'monitoring_source_grants', 'agents', 'sectors', 'offices', 'buildings'])
    await db.collection(c).deleteMany({})

  await db.collection('buildings').insertOne({ _id: BUILDING, ownerId: DONO, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: FLOOR, ownerId: DONO, buildingId: BUILDING, name: 'Térreo', status: 'active', createdAt: new Date() })
  agentId = new ObjectId()
  // A associação de setor mora no SETOR, e não no agente: é a associação real, lida agora.
  // Guardá-la no agente criaria uma segunda verdade que envelhece na primeira troca de
  // equipe — e o resolvedor canônico lê daqui.
  await db.collection('sectors').insertOne({
    _id: SECTOR,
    ownerId: DONO,
    officeId: FLOOR,
    name: 'Análise',
    members: [{ agentId }],
    createdAt: new Date(),
  })
  await db.collection('agents').insertOne({
    _id: agentId,
    ownerId: DONO,
    name: 'Marina',
    objective: 'analisar',
    provider: 'anthropic',
    officeId: FLOOR,
    createdAt: new Date(),
  })

  fonte = await svc.createSource(DONO, {
    name: 'Preço',
    kind: 'api_polling',
    config: { url: 'https://exemplo.test/p' },
    cadence: { mode: 'interval', intervalMs: 60_000 },
    mapping: { version: 1, fields: [{ to: 'preco', from: 'p' }] },
    destination: { history: true },
  })
  await db.collection('monitoring_sources').updateOne({ _id: fonte._id }, { $set: { status: 'active', 'telemetry.lastOkAt': new Date() } })
})

const conceder = (subjectType, subjectId, capabilities, effect) =>
  acesso.putSourceGrant(DONO, { sourceId: fonte._id, subjectType, subjectId, capabilities, ...(effect ? { effect } : {}) })

const perguntar = (over = {}) => acesso.resolveSourceAccess({ accountId: DONO, sourceId: fonte._id, agentId, ...over })

// --- o básico -------------------------------------------------------------------------

test('quem administra a conta administra as fontes dela', async () => {
  const r = await acesso.resolveSourceAccess({ accountId: DONO, sourceId: fonte._id })
  assert.equal(r.allowed, true)
  assert.deepEqual(r.capabilities.sort(), ['configure', 'read'])
})

test('sem grant, o agente NÃO alcança', async () => {
  const r = await perguntar()
  assert.equal(r.allowed, false)
  assert.match(r.reason, /não alcança/)
})

test('grant ao agente concede', async () => {
  await conceder('agent', agentId.toString(), ['read'])
  const r = await perguntar()
  assert.equal(r.allowed, true)
  assert.equal(r.origin, 'concedido ao agente')
})

test('grant ao SETOR alcança o agente do setor', async () => {
  await conceder('sector', SECTOR.toString(), ['read'])
  const r = await perguntar()
  assert.equal(r.allowed, true)
  assert.equal(r.origin, 'pelo setor')
})

test('grant ao ANDAR e ao PRÉDIO também alcançam', async () => {
  await conceder('floor', FLOOR.toString(), ['read'])
  assert.equal((await perguntar()).origin, 'pelo andar')

  await acesso.deleteSourceGrant(DONO, fonte._id, 'floor', FLOOR.toString())
  await conceder('building', BUILDING.toString(), ['read'])
  assert.equal((await perguntar()).origin, 'pelo prédio')
})

// --- a precedência ------------------------------------------------------------------------

test('o mais ESPECÍFICO ganha entre permissões', async () => {
  await conceder('building', BUILDING.toString(), ['read'])
  await conceder('agent', agentId.toString(), ['read', 'configure'])
  const r = await perguntar()
  assert.equal(r.origin, 'concedido ao agente')
  assert.deepEqual(r.capabilities.sort(), ['configure', 'read'])
})

test('DENY vence qualquer allow — inclusive um mais específico', async () => {
  await conceder('agent', agentId.toString(), ['read', 'configure'])
  await conceder('sector', SECTOR.toString(), ['configure'], 'deny')
  const r = await perguntar()
  assert.equal(r.allowed, true)
  assert.deepEqual(r.capabilities, ['read'], 'a negação do setor tira a capacidade, mesmo o allow sendo do agente')
})

test('deny de tudo nega, e diz por quê', async () => {
  await conceder('agent', agentId.toString(), ['read'])
  await conceder('building', BUILDING.toString(), ['read'], 'deny')
  const r = await perguntar()
  assert.equal(r.allowed, false)
  assert.match(r.reason, /negadas explicitamente/)
})

test('a capacidade pedida é conferida', async () => {
  await conceder('agent', agentId.toString(), ['read'])
  assert.equal((await perguntar({ capability: 'read' })).allowed, true)
  const r = await perguntar({ capability: 'configure' })
  assert.equal(r.allowed, false)
  assert.match(r.reason, /não inclui "configure"/)
})

// --- isolamento e revogação ------------------------------------------------------------------

test('AMEAÇA: agente de OUTRA conta não devolve a política dele', async () => {
  // Perguntar "o agente X pode?" com um id de outra conta já seria vazamento, mesmo sem ler.
  const alheio = new ObjectId()
  await db.collection('agents').insertOne({ _id: alheio, ownerId: 'vizinho', name: 'Alheio', provider: 'anthropic', createdAt: new Date() })
  await conceder('agent', alheio.toString(), ['read'])
  const r = await acesso.resolveSourceAccess({ accountId: DONO, sourceId: fonte._id, agentId: alheio })
  assert.equal(r.allowed, false)
})

test('AMEAÇA: fonte de outra conta não é alcançada nem pelo administrador', async () => {
  const r = await acesso.resolveSourceAccess({ accountId: 'vizinho', sourceId: fonte._id })
  assert.equal(r.allowed, false)
  assert.match(r.reason, /não está disponível para esta conta/)
})

test('REVOGAÇÃO vale na hora: o grant apagado não alcança mais', async () => {
  await conceder('agent', agentId.toString(), ['read'])
  assert.equal((await perguntar()).allowed, true)

  assert.equal(await acesso.deleteSourceGrant(DONO, fonte._id, 'agent', agentId.toString()), true)
  // Entre conceder e usar cabe uma revogação: a conferência é imediatamente antes do uso.
  assert.equal((await perguntar()).allowed, false)
})

test('fonte PAUSADA não é alcançada por agente, mesmo com grant', async () => {
  await conceder('agent', agentId.toString(), ['read'])
  await db.collection('monitoring_sources').updateOne({ _id: fonte._id }, { $set: { status: 'paused' } })
  const r = await perguntar()
  assert.equal(r.allowed, false)
  assert.match(r.reason, /pausada/)
})

test('conceder duas vezes ATUALIZA em vez de duplicar', async () => {
  await conceder('agent', agentId.toString(), ['read'])
  await conceder('agent', agentId.toString(), ['read', 'configure'])
  const lista = await acesso.listSourceGrants(DONO, fonte._id)
  assert.equal(lista.length, 1)
  assert.deepEqual(lista[0].capabilities.sort(), ['configure', 'read'])
})

test('grant sem capacidade nenhuma é recusado', async () => {
  await assert.rejects(() => conceder('agent', agentId.toString(), []), /ao menos uma capacidade/)
  await assert.rejects(() => conceder('agent', agentId.toString(), ['inventada']), /ao menos uma capacidade/)
})
