// Quem executa este agente — uma escolha, num lugar só.
//
// Espalhar essa decisão por cada chamador é garantir que um deles fique para trás quando
// um tipo novo aparecer — e o que ficar para trás vai tratar um agente de função como se
// fosse de modelo, chamando o provedor por nada.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { dispatchAgentExecution, fromLlmResult } = await import('../dist/executors/dispatcher.js')

const pedido = { agentId: new ObjectId(), ownerId: 'dono', objective: 'trabalhar' }

const resultadoDoModelo = (over = {}) => ({
  output: 'a resposta em prosa',
  usage: { inputTokens: 10, outputTokens: 20 },
  toolCalls: [],
  ...over,
})

test('agente ANTIGO, sem nenhum campo novo, vai para o modelo — como sempre foi', async () => {
  let chamou = 0
  const r = await dispatchAgentExecution({ _id: new ObjectId(), ownerId: 'dono', name: 'A' }, pedido, {
    runLlm: async () => {
      chamou += 1
      return resultadoDoModelo()
    },
  })
  assert.equal(chamou, 1)
  assert.equal(r.ok, true)
  assert.equal(r.text, 'a resposta em prosa')
})

test('agente de FUNÇÃO não chama o modelo', async () => {
  let chamou = 0
  const r = await dispatchAgentExecution(
    { _id: new ObjectId(), ownerId: 'dono', name: 'F', executorKind: 'function', executorConfig: { kind: 'function', functionName: 'math.summary' } },
    { ...pedido, input: { values: [1, 2, 3] } },
    { runLlm: async () => ((chamou += 1), resultadoDoModelo()) },
  )
  assert.equal(chamou, 0, 'chamar o provedor para uma soma é caro e não determinístico')
  assert.equal(r.ok, true)
  assert.deepEqual(r.structured.data, { count: 3, sum: 6, average: 2, min: 1, max: 3 })
})

test('tipo declarado sem a configuração correspondente é recusado', async () => {
  const r = await dispatchAgentExecution(
    // `executorKind: 'function'` com configuração de outro tipo: `agentContractOf`
    // normaliza para `function` sem nome, e o executor recusa.
    { _id: new ObjectId(), ownerId: 'dono', name: 'F', executorKind: 'function', executorConfig: { kind: 'llm' } },
    pedido,
    {},
  )
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_configured')
})

test('sem runtime de modelo injetado, o agente llm recusa em vez de fingir', async () => {
  const r = await dispatchAgentExecution({ _id: new ObjectId(), ownerId: 'dono', name: 'A' }, pedido, {})
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_configured')
})

// --- a tradução do resultado do modelo ----------------------------------------------------------

test('o resultado do modelo separa DADO de TEXTO', () => {
  // Hoje quem consome recebe uma string e reparseia; com os dois campos, quem precisa do
  // dado pega o dado.
  const r = fromLlmResult(resultadoDoModelo({ json: { titulo: 'x' }, format: { requested: 'json', valid: true, repaired: false } }), Date.now())
  assert.deepEqual(r.structured.data, { titulo: 'x' })
  assert.equal(r.structured.repaired, false)
  assert.equal(r.text, 'a resposta em prosa')
})

test('resposta reparada é entregue MARCADA como reparada', () => {
  const r = fromLlmResult(resultadoDoModelo({ json: { a: 1 }, format: { requested: 'json', valid: true, repaired: true } }), Date.now())
  assert.equal(r.structured.repaired, true, 'quem consome precisa saber que houve correção')
})

test('sem json, não há `structured` — e não uma string fingindo estrutura', () => {
  const r = fromLlmResult(resultadoDoModelo(), Date.now())
  assert.equal(r.structured, undefined)
  assert.equal(r.text, 'a resposta em prosa')
})

test('a conta do modelo vai na telemetria', () => {
  const r = fromLlmResult(resultadoDoModelo({ toolCalls: [{ ok: true }, { ok: false }] }), Date.now())
  assert.equal(r.telemetry.inputTokens, 10)
  assert.equal(r.telemetry.outputTokens, 20)
  assert.equal(r.telemetry.externalCalls, 2)
  assert.equal(r.metadata.toolsExecuted, 1, 'executadas conta as que COMPLETARAM')
})
