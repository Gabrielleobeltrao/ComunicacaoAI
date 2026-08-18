// INTEGRAÇÃO: onde os tokens foram gastos, por MODELO.
//
// É a resposta para "a economia é real?". O contador de tokens não responde: trocar um
// agente do modelo caro para o barato não muda um único token — muda o preço de cada um.
// Antes deste campo, a diferença só existia na fatura do provedor.
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()

const { recordAgentEvent, tokensByModelSince, ensureAgentEventIndexes } = await import('../dist/agentEvents.js')
const { mongoClient, db } = await import('../dist/db.js')

const DONO = 'dono-1'
const ANDAR = new ObjectId()
const AGENTE = new ObjectId()
const ONTEM = new Date(Date.now() - 24 * 60 * 60_000)

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  await db.collection('agent_execution_events').deleteMany({})
})

const evento = (over = {}) => ({
  eventKey: `e${Math.random()}`,
  ownerId: DONO,
  agentId: AGENTE,
  buildingId: new ObjectId().toString(),
  floorId: ANDAR,
  source: 'manual',
  preset: 'custom',
  status: 'succeeded',
  startedAt: new Date(),
  finishedAt: new Date(),
  inputTokens: 100,
  outputTokens: 50,
  toolCalls: 0,
  parentEventKey: null,
  rootEventKey: null,
  metadata: {},
  ...over,
})

test('o modelo fica gravado no evento da execução', async () => {
  await ensureAgentEventIndexes()
  await recordAgentEvent(evento({ model: 'claude-haiku-4-5' }))
  const gravado = await db.collection('agent_execution_events').findOne({ ownerId: DONO })
  assert.equal(gravado.model, 'claude-haiku-4-5')
})

test('a soma separa os tokens por modelo, do maior gasto para o menor', async () => {
  await recordAgentEvent(evento({ model: 'claude-sonnet-5', inputTokens: 1000, outputTokens: 500 }))
  await recordAgentEvent(evento({ model: 'claude-haiku-4-5', inputTokens: 100, outputTokens: 50 }))
  await recordAgentEvent(evento({ model: 'claude-haiku-4-5', inputTokens: 200, outputTokens: 100 }))

  const linhas = await tokensByModelSince(DONO, ONTEM)
  assert.deepEqual(
    linhas.map((l) => [l.model, l.inputTokens + l.outputTokens, l.runs]),
    [
      ['claude-sonnet-5', 1500, 1],
      ['claude-haiku-4-5', 450, 2],
    ],
  )
})

test('execuções antigas, sem o campo, aparecem como desconhecido', async () => {
  // Atribuí-las a um modelo que ninguém registrou seria inventar exatamente o dado que
  // esta função existe para mostrar.
  await recordAgentEvent(evento())
  const linhas = await tokensByModelSince(DONO, ONTEM)
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].model, 'desconhecido')
})

test('a soma não atravessa contas', async () => {
  await recordAgentEvent(evento({ model: 'gpt-5.1' }))
  assert.deepEqual(await tokensByModelSince('outro-dono', ONTEM), [])
})

test('o recorte por agente e por andar é respeitado', async () => {
  const outroAgente = new ObjectId()
  const outroAndar = new ObjectId()
  await recordAgentEvent(evento({ model: 'gpt-5.1' }))
  await recordAgentEvent(evento({ model: 'gpt-5-mini', agentId: outroAgente, floorId: outroAndar }))

  const doAgente = await tokensByModelSince(DONO, ONTEM, { agentId: AGENTE })
  assert.deepEqual(doAgente.map((l) => l.model), ['gpt-5.1'])

  const doAndar = await tokensByModelSince(DONO, ONTEM, { floorId: outroAndar })
  assert.deepEqual(doAndar.map((l) => l.model), ['gpt-5-mini'])
})

test('fora da janela não entra na conta', async () => {
  const antigo = new Date(Date.now() - 40 * 24 * 60 * 60_000)
  await recordAgentEvent(evento({ model: 'gpt-5.1', startedAt: antigo, finishedAt: antigo }))
  assert.deepEqual(await tokensByModelSince(DONO, ONTEM), [])
})

test('uma nova tentativa da MESMA execução não troca o modelo nem duplica a linha', async () => {
  // O modelo descreve a execução; tentar de novo roda no mesmo. Somá-lo seria absurdo, e
  // contar duas execuções onde houve uma inflaria o gasto.
  const chave = 'mesma-execucao'
  await recordAgentEvent(evento({ eventKey: chave, model: 'gpt-5.1', attemptCount: 1 }))
  await recordAgentEvent(evento({ eventKey: chave, model: 'gpt-5.1', attemptCount: 2 }))

  const linhas = await tokensByModelSince(DONO, ONTEM)
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].model, 'gpt-5.1')
  assert.equal(linhas[0].runs, 1, 'uma execução, não duas')
})
