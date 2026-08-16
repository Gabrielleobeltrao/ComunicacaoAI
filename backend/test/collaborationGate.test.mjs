// The single collaboration gate. Pure — no database.
//
// Four implementations of "who may call whom" would drift, and the map would offer
// targets the runtime then refuses. This is the one that decides, and the order it
// decides in is the point: crossing floors is settled BEFORE either side's
// permissions, and a closed core wins over an open callerPolicy.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/gate-test'
process.env.ENCRYPTION_KEY ||= 'test-encryption-key'

const { checkCollaboration, discoverable } = await import('../dist/collaborationGate.js')
const { canCommunicate } = await import('../dist/floorCommunication.js')

const BUILDING = 'b1'
const FLOOR_A = 'floor-a'
const FLOOR_B = 'floor-b'

const caller = (over = {}) => ({
  _id: { toString: () => over.id ?? 'caller' },
  ownerId: 'owner',
  officeId: { toString: () => over.floorId ?? FLOOR_A },
  name: 'Chamador',
  delegationPolicy: over.delegationPolicy ?? 'all',
  callableAgentIds: over.callableAgentIds ?? [],
  callableSectorIds: over.callableSectorIds ?? [],
})

const target = (over = {}) => ({
  kind: over.kind ?? 'agent',
  id: over.id ?? 'target',
  ownerId: 'owner',
  buildingId: BUILDING,
  floorId: over.floorId ?? FLOOR_A,
  callerPolicy: over.callerPolicy ?? 'all',
  allowedCallerAgentIds: over.allowedCallerAgentIds ?? [],
  executable: over.executable,
  protectedBy: over.protectedBy ?? null,
})

const ctx = (over = {}) => ({
  buildingId: BUILDING,
  callerAgentId: 'caller',
  ancestry: over.ancestry ?? [],
  depth: over.depth ?? 0,
  maxDepth: over.maxDepth ?? 3,
  budget: over.budget ?? { tokensSpent: 0, tokenLimit: 1000 },
  canceled: over.canceled,
  sectorGrant: over.sectorGrant ?? null,
})

const OPEN = { mode: 'all', links: [] }
const ISOLATED = { mode: 'isolated', links: [] }

test('o caminho feliz passa', () => {
  assert.deepEqual(checkCollaboration(caller(), target(), OPEN, ctx()), { ok: true })
})

test('dono e prédio são as primeiras perguntas', () => {
  assert.equal(checkCollaboration(caller(), { ...target(), ownerId: 'outro' }, OPEN, ctx()).code, 'forbidden')
  assert.equal(checkCollaboration(caller(), { ...target(), buildingId: 'b2' }, OPEN, ctx()).code, 'forbidden')
})

// --- entre andares ----------------------------------------------------------------

test('nenhuma política atravessa um prédio isolado — nem all', () => {
  const decision = checkCollaboration(caller({ delegationPolicy: 'all' }), target({ floorId: FLOOR_B }), ISOLATED, ctx())
  assert.equal(decision.ok, false)
  assert.equal(decision.code, 'cross_floor_blocked')
})

test('sem link na direção certa, a chamada não sai', () => {
  const oneWay = { mode: 'selected', links: [{ fromFloorId: { toString: () => FLOOR_A }, toFloorId: { toString: () => FLOOR_B }, direction: 'one_way' }] }
  // A → B existe.
  assert.equal(checkCollaboration(caller({ floorId: FLOOR_A }), target({ floorId: FLOOR_B }), oneWay, ctx()).ok, true)
  // B → A não: mão única é mão única.
  const back = checkCollaboration(caller({ floorId: FLOOR_B }), target({ floorId: FLOOR_A }), oneWay, ctx())
  assert.equal(back.code, 'floor_link_required')
})

test('link de mão dupla vale nos dois sentidos', () => {
  const both = { mode: 'selected', links: [{ fromFloorId: { toString: () => FLOOR_A }, toFloorId: { toString: () => FLOOR_B }, direction: 'both' }] }
  assert.equal(canCommunicate(both, FLOOR_B, FLOOR_A), true)
  assert.equal(checkCollaboration(caller({ floorId: FLOOR_B }), target({ floorId: FLOOR_A }), both, ctx()).ok, true)
})

test('o mesmo andar nunca precisa de link', () => {
  assert.equal(checkCollaboration(caller(), target({ floorId: FLOOR_A }), ISOLATED, ctx()).ok, true)
})

// --- políticas dos dois lados -------------------------------------------------------

test('a política de saída do chamador é respeitada', () => {
  assert.equal(checkCollaboration(caller({ delegationPolicy: 'none' }), target(), OPEN, ctx()).code, 'unauthorized')
  assert.equal(checkCollaboration(caller({ delegationPolicy: 'selected', callableAgentIds: ['outro'] }), target(), OPEN, ctx()).code, 'unauthorized')
  assert.equal(checkCollaboration(caller({ delegationPolicy: 'selected', callableAgentIds: ['target'] }), target(), OPEN, ctx()).ok, true)
})

test('a política floor alcança o próprio andar e nada além', () => {
  const c = caller({ delegationPolicy: 'floor' })
  assert.equal(checkCollaboration(c, target({ floorId: FLOOR_A }), OPEN, ctx()).ok, true)
  assert.equal(checkCollaboration(c, target({ floorId: FLOOR_B }), OPEN, ctx()).code, 'unauthorized')
})

test('a política de entrada do alvo também decide', () => {
  assert.equal(checkCollaboration(caller(), target({ callerPolicy: 'selected', allowedCallerAgentIds: [] }), OPEN, ctx()).code, 'unauthorized')
  assert.equal(checkCollaboration(caller(), target({ callerPolicy: 'selected', allowedCallerAgentIds: ['caller'] }), OPEN, ctx()).ok, true)
})

// --- núcleo fechado -----------------------------------------------------------------

test('nenhum callerPolicy all abre um agente protegido por núcleo fechado', () => {
  const decision = checkCollaboration(caller(), target({ callerPolicy: 'all', protectedBy: { sectorId: 's1', sectorName: 'Cozinha' } }), OPEN, ctx())
  assert.equal(decision.ok, false)
  assert.equal(decision.code, 'sector_entry_required')
  assert.equal(decision.sectorName, 'Cozinha')
})

test('a execução do próprio setor passa pelo grant, não pela lista de membros', () => {
  const protectedTarget = target({ protectedBy: { sectorId: 's1', sectorName: 'Cozinha' } })
  assert.equal(checkCollaboration(caller(), protectedTarget, OPEN, ctx()).ok, false)
  assert.equal(checkCollaboration(caller(), protectedTarget, OPEN, ctx({ sectorGrant: { sectorId: 's1', memberIds: ['target'] } })).ok, true)
})

test('setor que só organiza não é alvo executável', () => {
  const decision = checkCollaboration(caller(), target({ kind: 'sector', executable: false }), OPEN, ctx())
  assert.equal(decision.code, 'unauthorized')
  assert.match(decision.reason, /não executa como unidade/)
})

// --- o resto da cadeia ---------------------------------------------------------------

test('profundidade, ciclo, orçamento e cancelamento continuam valendo', () => {
  assert.equal(checkCollaboration(caller(), target(), OPEN, ctx({ depth: 3, maxDepth: 3 })).code, 'depth_exceeded')
  assert.equal(checkCollaboration(caller(), target(), OPEN, ctx({ ancestry: ['target'] })).code, 'cycle')
  assert.equal(checkCollaboration(caller(), target(), OPEN, ctx({ budget: { tokensSpent: 10, tokenLimit: 10 } })).code, 'budget_exceeded')
  assert.equal(checkCollaboration(caller(), target(), OPEN, ctx({ canceled: true })).code, 'canceled')
})

test('a ordem importa: o bloqueio entre andares vem antes das permissões dos dois lados', () => {
  // Chamador sem permissão E andares isolados: a resposta é sobre o andar, que é a
  // decisão mais absoluta — e não revela nada sobre as permissões do alvo.
  const decision = checkCollaboration(caller({ delegationPolicy: 'none' }), target({ floorId: FLOOR_B }), ISOLATED, ctx())
  assert.equal(decision.code, 'cross_floor_blocked')
})

// --- descoberta ----------------------------------------------------------------------

test('a descoberta esconde o que seria recusado, em vez de deixar falhar depois', () => {
  const targets = [
    target({ id: 'ok' }),
    target({ id: 'fechado', protectedBy: { sectorId: 's1', sectorName: 'Cozinha' } }),
    target({ id: 'outro-andar', floorId: FLOOR_B }),
  ]
  const visible = discoverable(caller(), targets, ISOLATED, ctx()).map((t) => t.id)
  assert.deepEqual(visible, ['ok'])
})
