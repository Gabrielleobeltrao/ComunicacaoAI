// Contratar um agente já configurado, contra um mongod REAL.
//
// O que estava quebrado: `role`, `instructions`, `constraints` e `runConfig` só existiam
// no PATCH. Contratar um agente pronto exigia criar e depois editar — e o que fosse
// esquecido no segundo passo simplesmente não existia, sem nada avisando.
//
// Aqui a criação é a de verdade (`createAgent`), e as asserções são sobre o DOCUMENTO
// gravado: o que foi pedido está lá, o que não foi pedido está AUSENTE (não vazio), e a
// definição escrita na contratação já nasce protegida contra uma troca de preset.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { createAgent, getAgentById } = await import('../dist/agents.js')
const { normalizeRunConfig } = await import('../dist/runConfig.js')
const { definitionOf, resolveCache } = await import('../dist/agentDefinition.js')

const OWNER = 'criacao-owner'
const FLOOR = new ObjectId()

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  await db.collection('agents').deleteMany({})
  await db.collection('offices').deleteMany({})
  await db.collection('offices').insertOne({ _id: FLOOR, ownerId: OWNER, name: 'Térreo', status: 'active', createdAt: new Date() })
})

// --- a definição chega na criação -----------------------------------------------------

test('função, instruções e limites são gravados na contratação', async () => {
  const criado = await createAgent(OWNER, FLOOR, 'Ana', {
    objective: 'Atender o cliente',
    role: 'Analista de suporte',
    instructions: 'Confirme o pedido antes de responder.',
    constraints: 'Nunca prometa prazo.',
  })

  const salvo = await getAgentById(OWNER, criado._id)
  assert.equal(salvo.role, 'Analista de suporte')
  assert.equal(salvo.instructions, 'Confirme o pedido antes de responder.')
  assert.equal(salvo.constraints, 'Nunca prometa prazo.')
  assert.equal(salvo.objective, 'Atender o cliente')
})

test('a definição escrita na contratação já nasce marcada como editada', async () => {
  // É essa marca que impede uma troca de preset depois de passar por cima do que foi
  // dito na hora de contratar.
  const criado = await createAgent(OWNER, FLOOR, 'Ana', { role: 'Analista' })
  const salvo = await getAgentById(OWNER, criado._id)
  assert.ok(salvo.definitionEditedAt instanceof Date)
})

test('quem não escreveu definição não nasce marcado', async () => {
  // Um agente criado só pelo preset pode receber sugestões depois, sem confirmação.
  const criado = await createAgent(OWNER, FLOOR, 'Ana', { objective: 'x' })
  const salvo = await getAgentById(OWNER, criado._id)
  assert.equal(salvo.definitionEditedAt, undefined)
})

test('campo não informado fica AUSENTE, não vazio', async () => {
  // A ausência é o que faz o prompt não ganhar bloco nenhum — um `role: ''` gravado
  // seria indistinguível de "escreveram e apagaram".
  const criado = await createAgent(OWNER, FLOOR, 'Ana', { objective: 'x' })
  const salvo = await getAgentById(OWNER, criado._id)
  assert.equal('role' in salvo, false)
  assert.equal('instructions' in salvo, false)
  assert.equal('constraints' in salvo, false)
  assert.equal('runConfig' in salvo, false)

  // E o prompt dele é o de sempre.
  const def = definitionOf(salvo)
  assert.equal(def.role, '')
  assert.equal(def.constraints, '')
})

test('texto em branco não cria campo', async () => {
  const criado = await createAgent(OWNER, FLOOR, 'Ana', { role: '   ', instructions: '' })
  const salvo = await getAgentById(OWNER, criado._id)
  assert.equal('role' in salvo, false)
  assert.equal(salvo.definitionEditedAt, undefined)
})

// --- a configuração de execução chega na criação -------------------------------------------

test('a configuração de execução é gravada e já vem saneada', async () => {
  const criado = await createAgent(OWNER, FLOOR, 'Ana', {
    // 5 está fora da faixa: o servidor aperta para o limite em vez de recusar a criação.
    runConfig: normalizeRunConfig({ temperature: 5, retries: 2, cache: false }),
  })
  const salvo = await getAgentById(OWNER, criado._id)
  assert.equal(salvo.runConfig.temperature, 2)
  assert.equal(salvo.runConfig.retries, 2)
  assert.equal(salvo.runConfig.cache, false)
})

test('`cache: false` na contratação sobrevive à leitura', async () => {
  // O erro clássico do booleano opcional: um filtro por valor-verdade transformaria a
  // escolha em ausência, e o cache voltaria ligado.
  const criado = await createAgent(OWNER, FLOOR, 'Ana', { runConfig: normalizeRunConfig({ cache: false }) })
  const salvo = await getAgentById(OWNER, criado._id)
  assert.equal(resolveCache(salvo, salvo.runConfig ?? {}), false)
})

test('config vazia não cria o campo', async () => {
  const criado = await createAgent(OWNER, FLOOR, 'Ana', { runConfig: normalizeRunConfig({}) })
  const salvo = await getAgentById(OWNER, criado._id)
  assert.equal('runConfig' in salvo, false)
})

// --- compatibilidade -------------------------------------------------------------------------

test('um agente criado sem nada disso se comporta como os de antes', async () => {
  const criado = await createAgent(OWNER, FLOOR, 'Ana', { objective: 'Atender' })
  const salvo = await getAgentById(OWNER, criado._id)

  // O cache continua ligado por padrão, como sempre esteve.
  assert.equal(resolveCache(salvo, {}), true)
  // E a definição não acrescenta bloco nenhum ao prompt.
  const def = definitionOf(salvo)
  assert.equal(def.objective, 'Atender')
  assert.equal(def.role, '')
  assert.equal(def.instructions, '')
})
