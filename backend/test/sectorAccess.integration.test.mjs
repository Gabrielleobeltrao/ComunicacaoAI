// INTEGRATION: the sector's entry boundary, against a REAL mongod.
//
// The hole this closes: without it, an outside agent could call a pipeline STAGE
// directly and walk into the middle of a flow, skipping the coordinator, the order
// and the contract the sector exists to enforce. What is pinned: every participant is
// protected (not only `members`), the refusal happens before any inference and names
// the sector to call instead, the sector's own run is exempt, and an existing sector's
// behaviour never changes by itself.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const {
  accessConfigOf,
  checkSectorEntry,
  protectedAgentIds,
  validateAccessConfig,
  suggestedEntryPolicy,
  sectorEntryDecisionFor,
  accessImpact,
} = await import('../dist/sectorAccess.js')

const OWNER = 'access-owner'
const COORD = new ObjectId()
const STAGE_AGENT = new ObjectId()
const OUTSIDER = new ObjectId()
const sectors = () => db.collection('sectors')
const agents = () => db.collection('agents')

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  await Promise.all([sectors().deleteMany({}), agents().deleteMany({})])
})

const sectorDoc = (over = {}) => ({
  _id: over._id ?? new ObjectId(),
  ownerId: OWNER,
  officeId: new ObjectId(),
  name: over.name ?? 'Cozinha',
  color: '#fff',
  mode: over.mode ?? 'pipeline',
  members: over.members ?? [{ agentId: COORD }],
  coordinatorAgentId: over.coordinatorAgentId ?? COORD,
  stages: over.stages ?? [{ id: 'e1', name: 'Preparar', agentId: STAGE_AGENT, instruction: '', dependsOn: [] }],
  entryPolicy: over.entryPolicy,
  exposedAgentIds: over.exposedAgentIds,
  createdAt: new Date(),
})

// --- quem o setor protege ---------------------------------------------------------

test('o setor protege membros, coordenador E etapas — não só a lista de membros', () => {
  const ids = protectedAgentIds(sectorDoc())
  assert.ok(ids.includes(COORD.toString()))
  // Esta é a brecha: uma etapa fora de `members` continuaria alcançável de fora.
  assert.ok(ids.includes(STAGE_AGENT.toString()))
})

test('um setor antigo, sem política, continua aberto como sempre foi', () => {
  const config = accessConfigOf(sectorDoc({ entryPolicy: undefined }))
  assert.equal(config.entryPolicy, 'open_members')
  assert.equal(checkSectorEntry(sectorDoc({ entryPolicy: undefined }), STAGE_AGENT.toString()).ok, true)
})

test('novo setor executável nasce fechado; novo grupo nasce aberto', () => {
  assert.equal(suggestedEntryPolicy('pipeline'), 'sector_only')
  assert.equal(suggestedEntryPolicy('orchestrated'), 'sector_only')
  assert.equal(suggestedEntryPolicy('organization'), 'open_members')
})

// --- a decisão -------------------------------------------------------------------

test('núcleo fechado recusa chamada direta e diz qual setor chamar', () => {
  const sector = sectorDoc({ entryPolicy: 'sector_only' })
  const decision = checkSectorEntry(sector, STAGE_AGENT.toString())
  assert.equal(decision.ok, false)
  assert.equal(decision.code, 'sector_entry_required')
  assert.equal(decision.sectorName, 'Cozinha')
  assert.match(decision.reason, /pelo próprio setor/)
})

test('quem não participa do setor não é afetado', () => {
  assert.equal(checkSectorEntry(sectorDoc({ entryPolicy: 'sector_only' }), OUTSIDER.toString()).ok, true)
})

test('selected_members libera só quem foi exposto', () => {
  const sector = sectorDoc({ entryPolicy: 'selected_members', exposedAgentIds: [STAGE_AGENT] })
  assert.equal(checkSectorEntry(sector, STAGE_AGENT.toString()).ok, true)
  assert.equal(checkSectorEntry(sector, COORD.toString()).ok, false)
})

test('estar na lista de membros NÃO basta para fingir contexto interno', () => {
  const sector = sectorDoc({ entryPolicy: 'sector_only' })
  // Sem o grant da execução daquele setor, a chamada é externa.
  assert.equal(checkSectorEntry(sector, COORD.toString()).ok, false)
  // Com o grant (runtime do próprio setor), passa.
  assert.equal(checkSectorEntry(sector, COORD.toString(), { internal: true }).ok, true)
})

// --- validação --------------------------------------------------------------------

test('setor que só organiza não pode ser núcleo fechado', () => {
  assert.throws(
    () => validateAccessConfig(sectorDoc({ mode: 'organization' }), { entryPolicy: 'sector_only' }, { entryPolicy: 'open_members', exposedAgentIds: [] }),
    /não executa como unidade/,
  )
})

test('não é possível expor quem não participa do setor', () => {
  assert.throws(
    () => validateAccessConfig(sectorDoc(), { exposedAgentIds: [OUTSIDER.toString()] }, { entryPolicy: 'sector_only', exposedAgentIds: [] }),
    /participam deste setor/,
  )
})

test('trocar de política não perde a lista de expostos', () => {
  const current = { entryPolicy: 'selected_members', exposedAgentIds: [STAGE_AGENT] }
  const next = validateAccessConfig(sectorDoc(), { entryPolicy: 'sector_only' }, current)
  assert.equal(next.entryPolicy, 'sector_only')
  assert.equal(next.exposedAgentIds.length, 1)
})

// --- a decisão contra o banco -----------------------------------------------------

test('a decisão encontra o setor que protege o agente', async () => {
  await sectors().insertOne(sectorDoc({ entryPolicy: 'sector_only' }))
  const blocked = await sectorEntryDecisionFor(OWNER, STAGE_AGENT.toString())
  assert.equal(blocked.blocked, true)
  assert.equal(blocked.sectorName, 'Cozinha')

  const free = await sectorEntryDecisionFor(OWNER, OUTSIDER.toString())
  assert.equal(free.blocked, false)
})

test('o setor de outro dono não protege ninguém aqui', async () => {
  await sectors().insertOne({ ...sectorDoc({ entryPolicy: 'sector_only' }), ownerId: 'outro' })
  assert.equal((await sectorEntryDecisionFor(OWNER, STAGE_AGENT.toString())).blocked, false)
})

// --- impacto ----------------------------------------------------------------------

test('o impacto diz quem perde acesso ANTES de salvar', async () => {
  const sector = sectorDoc({ entryPolicy: 'open_members' })
  await sectors().insertOne(sector)
  await agents().insertMany([
    { _id: COORD, ownerId: OWNER, name: 'Coordenador', officeId: sector.officeId },
    { _id: STAGE_AGENT, ownerId: OWNER, name: 'Preparador', officeId: sector.officeId },
    { _id: OUTSIDER, ownerId: OWNER, name: 'Vendas', officeId: sector.officeId, callableAgentIds: [STAGE_AGENT.toString()] },
  ])

  const impact = await accessImpact(OWNER, sector, { entryPolicy: 'sector_only', exposedAgentIds: [] })
  assert.equal(impact.protectedAgents.length, 2)
  assert.equal(impact.affectedCallers.length, 1)
  assert.equal(impact.affectedCallers[0].name, 'Vendas')
  assert.deepEqual(impact.affectedCallers[0].targets, ['Preparador'])
})

test('expor o agente tira ele da lista de impacto', async () => {
  const sector = sectorDoc({ entryPolicy: 'open_members' })
  await sectors().insertOne(sector)
  await agents().insertMany([
    { _id: STAGE_AGENT, ownerId: OWNER, name: 'Preparador', officeId: sector.officeId },
    { _id: OUTSIDER, ownerId: OWNER, name: 'Vendas', officeId: sector.officeId, callableAgentIds: [STAGE_AGENT.toString()] },
  ])
  const impact = await accessImpact(OWNER, sector, { entryPolicy: 'selected_members', exposedAgentIds: [STAGE_AGENT] })
  assert.deepEqual(impact.affectedCallers, [])
})
