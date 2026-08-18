// INTEGRAÇÃO: quem está numa ETAPA está no setor — e num setor só.
//
// `members` e `stages` eram duas listas independentes. O editor de pipeline gravava
// `members: []` de propósito ao salvar as etapas, e toda tela que pergunta "quem trabalha
// aqui" lê `members`. Resultado: setor em etapas com "0 agentes", coluna vazia ao lado do
// fluxo desenhado, sala vazia no mapa, "Sem setor" na página do agente.
//
// E a mesma raiz tinha um segundo efeito, pior: a regra de "um agente, um setor"
// (`enforceSingleMembership`) também lê `members`. Com a lista vazia, ela era um no-op —
// o mesmo agente podia ser etapa de quantos pipelines quisesse, ao mesmo tempo.
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()

const { createSector, updateSector, membersFromStages, stageConflicts, enforceSingleMembership, getSectorById } = await import(
  '../dist/sectors.js'
)
const { mongoClient, db } = await import('../dist/db.js')

const DONO = 'dono-1'
const ANDAR = new ObjectId()

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  await db.collection('sectors').deleteMany({})
})

const etapa = (id, nome, agentId, dependsOn = []) => ({
  id,
  name: nome,
  agentId,
  instruction: '',
  dependsOn,
  inputMapping: {},
  expectedOutput: '',
  retryPolicy: { maxAttempts: 1, backoffMs: 2000 },
  onError: 'stop',
})

const membro = (agentId, over = {}) => ({
  agentId,
  sector: '',
  routingDescription: '',
  advanceWhen: '',
  transitions: [],
  isDefault: false,
  ...over,
})

// --- a derivação -----------------------------------------------------------------------

test('criar um pipeline com etapas grava os agentes das etapas como membros', async () => {
  const a1 = new ObjectId()
  const a2 = new ObjectId()
  const setor = await createSector(DONO, ANDAR, 'Esteira', '#fff', 'pipeline', [], {
    stages: [etapa('s1', 'Coleta', a1), etapa('s2', 'Análise', a2, ['s1'])],
  })

  assert.deepEqual(
    setor.members.map((m) => m.agentId.toString()),
    [a1.toString(), a2.toString()],
    'a tela pergunta "quem trabalha aqui" para `members` — e a resposta não pode ser vazia',
  )
  // O nome da etapa explica por que o agente está ali.
  assert.equal(setor.members[0].routingDescription, 'Coleta')
})

test('salvar as etapas NÃO apaga os agentes, mesmo com members: [] no corpo', async () => {
  const a1 = new ObjectId()
  const setor = await createSector(DONO, ANDAR, 'Esteira', '#fff', 'pipeline', [], { stages: [etapa('s1', 'Coleta', a1)] })

  // Exatamente o que o formulário mandava: etapas cheias, membros zerados.
  const atualizado = await updateSector(DONO, setor._id, { members: [], stages: [etapa('s1', 'Coleta', a1)] })

  assert.equal(atualizado.members.length, 1, 'o `[]` do formulário não pode zerar o setor')
  assert.equal(atualizado.members[0].agentId.toString(), a1.toString())
})

test('trocar o agente de uma etapa troca o membro junto', async () => {
  const antigo = new ObjectId()
  const novo = new ObjectId()
  const setor = await createSector(DONO, ANDAR, 'Esteira', '#fff', 'pipeline', [], { stages: [etapa('s1', 'Coleta', antigo)] })

  const atualizado = await updateSector(DONO, setor._id, { stages: [etapa('s1', 'Coleta', novo)] })
  assert.deepEqual(atualizado.members.map((m) => m.agentId.toString()), [novo.toString()])
})

test('o mesmo agente em duas etapas do MESMO fluxo é um membro só', async () => {
  // Dentro de um fluxo, repetir é legítimo: revisar e depois conferir de novo.
  const a1 = new ObjectId()
  const derivados = membersFromStages([etapa('s1', 'Escrever', a1), etapa('s2', 'Revisar', a1)])
  assert.equal(derivados.length, 1)
})

test('um setor orquestrado continua com a lista que o dono montou', async () => {
  const a1 = new ObjectId()
  const setor = await createSector(DONO, ANDAR, 'Time', '#fff', 'orchestrated', [membro(a1, { isDefault: true })], {})
  assert.equal(setor.members.length, 1)
  assert.equal(setor.members[0].isDefault, true, 'a derivação de pipeline não pode vazar para os outros modos')
})

// --- um agente, um lugar --------------------------------------------------------------------

test('a exclusividade passa a alcançar quem está numa etapa', async () => {
  const a1 = new ObjectId()
  const antigo = await createSector(DONO, ANDAR, 'Setor antigo', '#fff', 'orchestrated', [membro(a1, { isDefault: true })], {})
  const novo = await createSector(DONO, ANDAR, 'Esteira', '#fff', 'pipeline', [], { stages: [etapa('s1', 'Coleta', a1)] })

  // É a lista GRAVADA que vale — antes ela vinha vazia e a regra não fazia nada.
  await enforceSingleMembership(DONO, novo._id, novo.members.map((m) => m.agentId))

  const depois = await getSectorById(DONO, antigo._id)
  assert.equal(depois.members.length, 0, 'entrar num setor tira do anterior')
})

test('quem já é etapa de outro setor é apontado com nome e etapa', async () => {
  const a1 = new ObjectId()
  const existente = await createSector(DONO, ANDAR, 'Cozinha', '#fff', 'pipeline', [], { stages: [etapa('s1', 'Preparar', a1)] })

  const conflitos = await stageConflicts(DONO, null, [a1])
  assert.equal(conflitos.length, 1)
  assert.equal(conflitos[0].sectorName, 'Cozinha')
  assert.equal(conflitos[0].stageName, 'Preparar')
  assert.equal(conflitos[0].sectorId, existente._id.toString())
})

test('o próprio setor não conflita consigo mesmo ao ser re-salvo', async () => {
  const a1 = new ObjectId()
  const setor = await createSector(DONO, ANDAR, 'Cozinha', '#fff', 'pipeline', [], { stages: [etapa('s1', 'Preparar', a1)] })
  assert.deepEqual(await stageConflicts(DONO, setor._id, [a1]), [])
})

test('o conflito não atravessa contas', async () => {
  const a1 = new ObjectId()
  await createSector('outro-dono', ANDAR, 'Cozinha alheia', '#fff', 'pipeline', [], { stages: [etapa('s1', 'Preparar', a1)] })
  assert.deepEqual(await stageConflicts(DONO, null, [a1]), [], 'o setor do vizinho não existe para esta conta')
})
