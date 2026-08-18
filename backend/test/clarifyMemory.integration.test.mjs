// INTEGRAÇÃO: não perguntar duas vezes a mesma coisa.
//
// Sem memória do que foi esclarecido, o sistema é amnésico: você explica hoje que "a
// proposta" é a que enviamos, e amanhã perguntam de novo. A segunda pergunta é pior que a
// primeira — a primeira era cuidado, a segunda é a prova de que ninguém prestou atenção.
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()

const { clarificationKey, recallClarifications, rememberClarification } = await import('../dist/clarifyMemory.js')
const { ensureMemoryIndexes } = await import('../dist/memory/records.js')
const { mongoClient, db } = await import('../dist/db.js')

const DONO = 'dono-1'
const AGENTE = new ObjectId()
const SETOR = new ObjectId()

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  await db.collection('memories').deleteMany({})
  await ensureMemoryIndexes()
})

test('o par pergunta→resposta fica guardado e volta como dica', async () => {
  await rememberClarification({ ownerId: DONO, agentId: AGENTE }, 'Qual proposta? A que enviamos ou a que recebemos?', 'A que enviamos')

  const dica = await recallClarifications({ ownerId: DONO, agentId: AGENTE })
  assert.match(dica, /não pergunte de novo/i)
  assert.match(dica, /A que enviamos/)
})

test('esclarecer a MESMA dúvida de novo atualiza, em vez de empilhar', async () => {
  // Quem mudou de ideia mudou de ideia, e a última é a que vale.
  const pergunta = 'Qual período?'
  await rememberClarification({ ownerId: DONO, agentId: AGENTE }, pergunta, '30 dias')
  await rememberClarification({ ownerId: DONO, agentId: AGENTE }, pergunta, '7 dias')

  const registros = await db.collection('memories').find({ key: clarificationKey(pergunta) }).toArray()
  assert.equal(registros.length, 1, 'uma dúvida, um registro')
  assert.match(JSON.stringify(registros[0].payload), /7 dias/)
})

test('a chave vem da PERGUNTA: a mesma dúvida escrita igual cai no mesmo lugar', () => {
  assert.equal(clarificationKey('Qual período?'), clarificationKey('  qual PERÍODO?  '))
  assert.notEqual(clarificationKey('Qual período?'), clarificationKey('Qual produto?'))
})

test('num setor, o time inteiro aprende junto', async () => {
  const outroAgente = new ObjectId()
  await rememberClarification({ ownerId: DONO, agentId: AGENTE, sectorId: SETOR }, 'Qual carteira?', 'A conservadora')

  // Um colega do mesmo setor enxerga o que foi esclarecido.
  const dica = await recallClarifications({ ownerId: DONO, agentId: outroAgente, sectorId: SETOR })
  assert.match(dica, /A conservadora/)
})

test('sem nada esclarecido, não há dica — e não uma frase vazia no prompt', async () => {
  assert.equal(await recallClarifications({ ownerId: DONO, agentId: AGENTE }), null)
})

test('o que foi esclarecido numa conta não vaza para outra', async () => {
  await rememberClarification({ ownerId: DONO, agentId: AGENTE }, 'Qual cliente?', 'O do plano empresarial')
  assert.equal(await recallClarifications({ ownerId: 'outro-dono', agentId: AGENTE }), null)
})

test('resposta vazia não vira registro', async () => {
  await rememberClarification({ ownerId: DONO, agentId: AGENTE }, 'Qual período?', '   ')
  assert.equal(await db.collection('memories').countDocuments({}), 0)
})
