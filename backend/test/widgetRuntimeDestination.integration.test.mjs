// O destino continua válido AGORA?
//
// A validação de criação prova que o destino era bom no dia em que foi escolhido. Depois
// o mundo anda: o agente é excluído, o setor é arquivado, alguém tira o coordenador. O
// widget segue apontando para um lugar que não atende, o visitante escreve, a mensagem é
// GRAVADA e a execução é DISPARADA — e o resultado é silêncio pago.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { resolveRuntimeDestination, WIDGET_DESTINATION_INVALID } = await import('../dist/widgetRuntimeDestination.js')
const { mongoClient, db } = await import('../dist/db.js')

const DONO = 'dono-destino'
const ANDAR = new ObjectId()

before(async () => {
  await mongoClient.connect()
})

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await db.collection('agents').deleteMany({})
  await db.collection('sectors').deleteMany({})
})

const criarAgente = async () => {
  const _id = new ObjectId()
  await db.collection('agents').insertOne({ _id, ownerId: DONO, name: 'Atendente', officeId: ANDAR, objective: 'atender', provider: 'anthropic' })
  return _id
}

const criarSetor = async (over = {}) => {
  const _id = new ObjectId()
  await db.collection('sectors').insertOne({
    _id,
    ownerId: DONO,
    name: 'Suporte',
    officeId: ANDAR,
    mode: 'orchestrated',
    members: [],
    ...over,
  })
  return _id
}

// --- o caminho feliz ----------------------------------------------------------------------

test('agente que existe continua atendendo', async () => {
  const agentId = await criarAgente()
  const r = await resolveRuntimeDestination({ ownerId: DONO, agentId, sectorId: null })
  assert.equal(r.ok, true)
  assert.equal(r.agentId.toString(), agentId.toString())
})

test('setor executável continua atendendo', async () => {
  const a1 = await criarAgente()
  const a2 = await criarAgente()
  const sectorId = await criarSetor({ members: [{ agentId: a1 }, { agentId: a2 }], coordinatorAgentId: a1 })
  const r = await resolveRuntimeDestination({ ownerId: DONO, agentId: null, sectorId })
  assert.equal(r.ok, true)
  assert.equal(r.sectorId.toString(), sectorId.toString())
})

// --- o que mudou DEPOIS de o widget ser criado -----------------------------------------------

test('agente excluído: 409, com motivo legível', async () => {
  const r = await resolveRuntimeDestination({ ownerId: DONO, agentId: new ObjectId(), sectorId: null })
  assert.equal(r.ok, false)
  assert.equal(r.status, 409)
  assert.equal(r.code, WIDGET_DESTINATION_INVALID)
  assert.match(r.error, /não existe mais/)
})

test('setor que perdeu o coordenador para de atender', async () => {
  const a1 = await criarAgente()
  const sectorId = await criarSetor({ members: [{ agentId: a1 }], coordinatorAgentId: null })
  const r = await resolveRuntimeDestination({ ownerId: DONO, agentId: null, sectorId })
  assert.equal(r.ok, false)
  assert.match(r.error, /coordena/)
})

test('setor esvaziado para de atender', async () => {
  const a1 = await criarAgente()
  const sectorId = await criarSetor({ members: [], coordinatorAgentId: a1 })
  assert.equal((await resolveRuntimeDestination({ ownerId: DONO, agentId: null, sectorId })).ok, false)
})

test('setor virado "só organizar" para de atender', async () => {
  const a1 = await criarAgente()
  const sectorId = await criarSetor({ mode: 'organization', members: [{ agentId: a1 }] })
  const r = await resolveRuntimeDestination({ ownerId: DONO, agentId: null, sectorId })
  assert.equal(r.ok, false)
  assert.match(r.error, /só organiza/)
})

test('pipeline com etapa apontando para agente removido para de atender', async () => {
  const sectorId = await criarSetor({ mode: 'pipeline', stages: [{ id: 'e1', name: 'Triagem', agentId: new ObjectId() }] })
  assert.equal((await resolveRuntimeDestination({ ownerId: DONO, agentId: null, sectorId })).ok, false)
})

test('setor apagado: 409, e não uma exceção', async () => {
  const r = await resolveRuntimeDestination({ ownerId: DONO, agentId: null, sectorId: new ObjectId() })
  assert.equal(r.ok, false)
  assert.equal(r.status, 409)
})

// --- os widgets LEGADOS -----------------------------------------------------------------------

test('widget antigo sem destino nenhum é recusado', async () => {
  // Ele foi criado antes de a regra existir. O que não pode é gravar mensagem e disparar
  // execução para um destino que ninguém consegue nomear.
  const r = await resolveRuntimeDestination({ ownerId: DONO, agentId: null, sectorId: null })
  assert.equal(r.ok, false)
  assert.equal(r.code, WIDGET_DESTINATION_INVALID)
  assert.match(r.error, /Escolha quem vai atender/)
})

test('widget antigo com os DOIS destinos é recusado — ninguém escolhe por ele', async () => {
  const agentId = await criarAgente()
  const sectorId = await criarSetor()
  const r = await resolveRuntimeDestination({ ownerId: DONO, agentId, sectorId })
  assert.equal(r.ok, false)
  assert.match(r.error, /não os dois/)
})

// --- a posse ------------------------------------------------------------------------------------

test('o agente de OUTRA conta não atende este widget', async () => {
  const _id = new ObjectId()
  await db.collection('agents').insertOne({ _id, ownerId: 'outra-conta', name: 'Alheio', officeId: ANDAR, objective: 'x', provider: 'anthropic' })
  const r = await resolveRuntimeDestination({ ownerId: DONO, agentId: _id, sectorId: null })
  assert.equal(r.ok, false, 'a posse é conferida na leitura, não só na criação')
})

test('o setor de OUTRA conta não atende', async () => {
  const _id = new ObjectId()
  await db.collection('sectors').insertOne({ _id, ownerId: 'outra-conta', name: 'Alheio', officeId: ANDAR, mode: 'orchestrated', members: [] })
  assert.equal((await resolveRuntimeDestination({ ownerId: DONO, agentId: null, sectorId: _id })).ok, false)
})
