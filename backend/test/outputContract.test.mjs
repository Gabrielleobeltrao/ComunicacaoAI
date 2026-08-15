// An output contract that nothing enforces is a wish. These pin the executable half:
// the contracts reach the model, a JSON answer is parsed AND validated, an invalid
// one earns exactly ONE correction (charged), and a second failure ends the task as
// `validation` instead of delivering something that does not honour the shape.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { buildTaskObjective, boundedSchema, executeAgentTask, schemaDepth } = await import('../dist/agentRuntime.js')

const SCHEMA = {
  type: 'object',
  properties: { titulo: { type: 'string' }, itens: { type: 'array' } },
  required: ['titulo'],
  additionalProperties: false,
}

const req = (over = {}) => ({ objective: 'Resumir o dia', instructions: 'Use os dados recebidos.', ...over })

// A reply function that answers with the queued texts, one per call.
function replyWith(...texts) {
  const calls = []
  const fn = async (objective, knowledge, memory, history) => {
    calls.push({ objective, history })
    const text = texts[calls.length - 1] ?? texts[texts.length - 1]
    return { text, usage: { inputTokens: 10, outputTokens: 5 }, toolCalls: [] }
  }
  fn.calls = calls
  return fn
}

// --- the contracts reach the model --------------------------------------------------

test('input and output contracts are part of the instruction', () => {
  const objective = buildTaskObjective(req({ contracts: { input: 'Um tema para pesquisar', output: 'Lista com fontes' } }))
  assert.match(objective, /O que você recebe: Um tema para pesquisar/)
  assert.match(objective, /O que você deve produzir: Lista com fontes/)
})

test('an agent without contracts produces the same objective as before', () => {
  const objective = buildTaskObjective(req())
  assert.ok(!objective.includes('O que você recebe'))
  assert.ok(!objective.includes('O que você deve produzir'))
})

test('a JSON schema is included as an instruction when it is small enough', () => {
  const objective = buildTaskObjective(req({ output: { format: 'json', jsonSchema: SCHEMA } }))
  assert.match(objective, /JSON Schema/)
  assert.match(objective, /titulo/)
})

test('an oversized or too deep schema is still enforced, just not pasted', () => {
  const deep = (levels) => (levels === 0 ? { type: 'string' } : { type: 'object', properties: { n: deep(levels - 1) } })
  assert.equal(boundedSchema(deep(20)), null, 'too deep to be an instruction')
  assert.ok(schemaDepth(deep(3)) >= 3)
  const huge = { type: 'object', properties: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`campo${i}`, { type: 'string', description: 'x'.repeat(40) }])) }
  assert.equal(boundedSchema(huge), null)
  // And the objective simply omits it rather than blowing up the prompt.
  const objective = buildTaskObjective(req({ output: { format: 'json', jsonSchema: huge } }))
  assert.match(objective, /EXCLUSIVAMENTE com um único objeto JSON/)
  assert.ok(!objective.includes('campo1'))
})

// --- JSON is validated, corrected once, and never delivered invalid ------------------

test('a valid JSON answer passes on the first try', async () => {
  const reply = replyWith('{"titulo":"Resumo","itens":[]}')
  const result = await executeAgentTask(req({ output: { format: 'json', jsonSchema: SCHEMA } }), reply)
  assert.deepEqual(result.json, { titulo: 'Resumo', itens: [] })
  assert.equal(reply.calls.length, 1, 'no correction was needed')
  assert.deepEqual(result.format, { requested: 'json', valid: true, repaired: false })
})

test('an answer that breaks the schema earns ONE correction, and its tokens are charged', async () => {
  // First: valid JSON, wrong shape (missing the required field).
  const reply = replyWith('{"resumo":"sem titulo"}', '{"titulo":"Agora sim"}')
  const result = await executeAgentTask(req({ output: { format: 'json', jsonSchema: SCHEMA } }), reply)

  assert.equal(reply.calls.length, 2, 'exactly one correction round-trip')
  assert.deepEqual(result.json, { titulo: 'Agora sim' })
  assert.equal(result.format.repaired, true)
  // Both calls are paid for: 10+10 in, 5+5 out.
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 10 })

  // The correction told the model what was wrong, and carried its own answer back.
  const repairTurn = reply.calls[1].history.at(-1)
  assert.equal(repairTurn.role, 'user')
  assert.match(repairTurn.content, /não é um JSON válido para o contrato pedido/)
  assert.equal(reply.calls[1].history.at(-2).role, 'assistant')
})

test('unparseable JSON is corrected the same way', async () => {
  const reply = replyWith('claro! aqui está: {isso não é json}', '{"titulo":"ok"}')
  const result = await executeAgentTask(req({ output: { format: 'json', jsonSchema: SCHEMA } }), reply)
  assert.equal(reply.calls.length, 2)
  assert.equal(result.json.titulo, 'ok')
})

test('a second failure ends the task as validation — nothing invalid is delivered', async () => {
  const reply = replyWith('{"resumo":"errado"}', '{"ainda":"errado"}')
  await assert.rejects(
    () => executeAgentTask(req({ output: { format: 'json', jsonSchema: SCHEMA } }), reply),
    (error) => {
      assert.equal(error.name, 'AgentRunError')
      assert.equal(error.kind, 'validation')
      return true
    },
  )
  assert.equal(reply.calls.length, 2, 'and it does not keep trying')
})

test('without a schema, JSON only has to parse', async () => {
  const reply = replyWith('{"qualquer":"coisa"}')
  const result = await executeAgentTask(req({ output: { format: 'json' } }), reply)
  assert.deepEqual(result.json, { qualquer: 'coisa' })
  assert.equal(reply.calls.length, 1)
})

test('text and markdown are untouched by any of this', async () => {
  for (const format of ['text', 'markdown']) {
    const reply = replyWith('uma resposta em prosa')
    const result = await executeAgentTask(req({ output: { format } }), reply)
    assert.equal(result.output, 'uma resposta em prosa')
    assert.equal(result.json, undefined)
    assert.equal(reply.calls.length, 1)
    assert.deepEqual(result.format, { requested: format, valid: true, repaired: false })
  }
})

test('a JSON input reaches the model as data, not as a lost object', async () => {
  const reply = replyWith('{"titulo":"ok"}')
  await executeAgentTask(req({ input: { pedido: 'A-1', itens: [1, 2] }, output: { format: 'json', jsonSchema: SCHEMA } }), reply)
  const userTurn = reply.calls[0].history.at(-1)
  assert.match(userTurn.content, /"pedido"/)
  assert.match(userTurn.content, /A-1/)
})
