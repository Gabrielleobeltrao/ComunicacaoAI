// OS DESTINOS: para onde uma assinatura manda o que chega, e sob quais garantias.
//
// Duas coisas estão sendo protegidas aqui. A primeira é posse: um destino apontando
// para o agente de outra conta não vazaria nada sozinho, mas ficaria pendurado e um dia
// dispararia para alguém que nunca configurou aquilo.
//
// A segunda é o caminho: agente e setor rodam pelo gatilho por evento que já existe, e
// não por um executor escrito para o WebSocket. Um segundo executor perderia fila,
// idempotência, permissões, contabilidade e auditoria — e perderia em silêncio.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { assertDestinationOwned, syncManagedTrigger, archiveManagedTrigger } = await import('../dist/integrations/websocket/managedTrigger.js')
const { ValidationError } = await import('../dist/building.js')
const { getAutomation } = await import('../dist/automations/service.js')
const { createFloor } = await import('../dist/floors.js')
const { createSector } = await import('../dist/sectors.js')
const { createAgent } = await import('../dist/agents.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
const { db, mongoClient } = await import('../dist/db.js')

const DONO = 'dono-destinos'
const VIZINHO = 'vizinho-destinos'

let andar
let agente
let setor
let andarAlheio
let agenteAlheio

before(async () => {
  await ensureRunIndexes()
})

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['automations', 'automation_versions', 'automation_runs', 'agents', 'offices', 'sectors', 'buildings'])
    await db.collection(c).deleteMany({})
  await ensureDefaultBuilding(DONO)
  await ensureDefaultBuilding(VIZINHO)
  andar = await createFloor(DONO, { name: 'Térreo' })
  agente = await createAgent(DONO, andar._id, 'Ana', { objective: 'Atender bem quem chega' })
  setor = await createSector(DONO, andar._id, 'Suporte', '#3355ff', 'collaborative', [])
  andarAlheio = await createFloor(VIZINHO, { name: 'Do vizinho' })
  agenteAlheio = await createAgent(VIZINHO, andarAlheio._id, 'De outro', { objective: 'Fazer outra coisa qualquer' })
})

const assinatura = (destino, over = {}) => ({
  _id: new ObjectId(),
  ownerId: DONO,
  installationId: new ObjectId().toString(),
  name: 'Pedidos',
  subscribeMessage: '',
  unsubscribeMessage: '',
  filters: [],
  channel: '',
  active: true,
  destination: destino,
  managedAutomationId: null,
  messageCount: 0,
  lastMessageAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
})

// --- posse ---------------------------------------------------------------------------------

test('um destino desta conta é aceito', async () => {
  await assertDestinationOwned(DONO, { kind: 'agent', agentId: agente._id.toString() })
  await assertDestinationOwned(DONO, { kind: 'sector', sectorId: setor._id.toString() })
  await assertDestinationOwned(DONO, { kind: 'memory', memoryScope: 'floor', floorId: andar._id.toString() })
  // Prédio não pede id: a conta tem um, e ele é resolvido na escrita.
  await assertDestinationOwned(DONO, { kind: 'memory', memoryScope: 'building' })
  await assertDestinationOwned(DONO, { kind: 'history' })
})

test('o agente de OUTRA conta é recusado', async () => {
  await assert.rejects(() => assertDestinationOwned(DONO, { kind: 'agent', agentId: agenteAlheio._id.toString() }), ValidationError)
  await assert.rejects(
    () => assertDestinationOwned(DONO, { kind: 'memory', memoryScope: 'agent', agentId: agenteAlheio._id.toString() }),
    /não encontrado/,
  )
})

test('o andar de outra conta é recusado', async () => {
  await assert.rejects(() => assertDestinationOwned(DONO, { kind: 'memory', memoryScope: 'floor', floorId: andarAlheio._id.toString() }), /não encontrado/)
})

test('um id que não existe é recusado, e um id malformado também', async () => {
  // Referência pendurada é pior que erro: ela salva, parece configurada e nunca dispara.
  await assert.rejects(() => assertDestinationOwned(DONO, { kind: 'agent', agentId: new ObjectId().toString() }), /não encontrado/)
  await assert.rejects(() => assertDestinationOwned(DONO, { kind: 'agent', agentId: 'nem-é-um-id' }), /inválido/)
  await assert.rejects(() => assertDestinationOwned(DONO, { kind: 'routine', automationId: '' }), /inválido/)
})

// --- o gatilho gerenciado ---------------------------------------------------------------------

test('destino de agente cria um gatilho por evento — o caminho de sempre', async () => {
  const s = assinatura({ kind: 'agent', agentId: agente._id.toString() })
  const criada = await syncManagedTrigger(DONO, s)
  assert.ok(criada, 'a automação foi criada')

  const automacao = await getAutomation(DONO, new ObjectId(criada))
  assert.ok(automacao)
  assert.equal(automacao.status, 'active')
  // É um gatilho INTERNO ouvindo o evento do WebSocket, filtrado por esta conexão.
  const definicao = automacao.draftDefinition
  assert.equal(definicao.trigger.type, 'internal_event')
  assert.equal(definicao.trigger.eventType, 'integration.websocket.message')
  assert.equal(definicao.trigger.installationId, s.installationId)
  // E ela roda o agente escolhido, pelo executor de sempre.
  const passo = definicao.steps.find((p) => p.type === 'agent.execute')
  assert.ok(passo, 'a execução é do agente, e não de um executor paralelo')
  assert.equal(passo.config.agentId, agente._id.toString())
})

test('destino que não executa não cria automação nenhuma', async () => {
  for (const destino of [{ kind: 'history' }, { kind: 'memory', memoryScope: 'building' }, { kind: 'routine', automationId: new ObjectId().toString() }]) {
    assert.equal(await syncManagedTrigger(DONO, assinatura(destino)), null, destino.kind)
  }
  assert.equal(await db.collection('automations').countDocuments({}), 0)
})

test('trocar o destino atualiza a automação em vez de criar outra', async () => {
  const s = assinatura({ kind: 'agent', agentId: agente._id.toString() })
  const primeira = await syncManagedTrigger(DONO, s)
  const segunda = await syncManagedTrigger(DONO, { ...s, name: 'Outro nome' }, primeira)
  assert.equal(segunda, primeira, 'a mesma automação, atualizada')
  assert.equal(await db.collection('automations').countDocuments({}), 1)
})

test('sair de agente para "só guardar" arquiva a automação', async () => {
  // Ela não é apagada: o histórico de execuções que produziu continua fazendo sentido,
  // e apagar transformaria aquelas execuções em referências mortas.
  const s = assinatura({ kind: 'agent', agentId: agente._id.toString() })
  const criada = await syncManagedTrigger(DONO, s)
  const depois = await syncManagedTrigger(DONO, { ...s, destination: { kind: 'history' } }, criada)
  assert.equal(depois, null)
  const automacao = await getAutomation(DONO, new ObjectId(criada))
  assert.equal(automacao.status, 'archived')
})

test('uma assinatura pausada nasce com o gatilho pausado', async () => {
  const s = assinatura({ kind: 'agent', agentId: agente._id.toString() }, { active: false })
  const criada = await syncManagedTrigger(DONO, s)
  assert.equal((await getAutomation(DONO, new ObjectId(criada))).status, 'paused')
})

test('remover a assinatura arquiva o gatilho dela', async () => {
  const s = assinatura({ kind: 'agent', agentId: agente._id.toString() })
  const criada = await syncManagedTrigger(DONO, s)
  await archiveManagedTrigger(DONO, criada)
  assert.equal((await getAutomation(DONO, new ObjectId(criada))).status, 'archived')
})

test('arquivar a automação de outra conta não faz nada', async () => {
  const s = assinatura({ kind: 'agent', agentId: agente._id.toString() })
  const criada = await syncManagedTrigger(DONO, s)
  await archiveManagedTrigger(VIZINHO, criada)
  // O dono está na consulta: o vizinho simplesmente não a encontra.
  assert.equal((await getAutomation(DONO, new ObjectId(criada))).status, 'active')
})
