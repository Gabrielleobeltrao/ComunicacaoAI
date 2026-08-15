// Grounding as a contract: what the retrieval is asked, what it may return, and what
// happens when it cannot answer at all.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/grounding-test'

const { buildRetrievalQuery } = await import('../dist/retrievalQuery.js')
const { executeRoutineStep, KnowledgeUnavailableError } = await import('../dist/automations/routineExecution.js')

test('the question includes the objective, the instructions AND the input', () => {
  const query = buildRetrievalQuery({ objective: 'Atender pedidos', instructions: 'Resuma o pedido', input: 'pedido A-1' })
  assert.match(query, /Atender pedidos/)
  assert.match(query, /Resuma o pedido/)
  assert.match(query, /pedido A-1/)
})

test('a JSON input is serialized instead of being dropped', () => {
  // This is the case that used to retrieve nothing: a webhook payload or a previous
  // step's structured output.
  const query = buildRetrievalQuery({ objective: 'x', instructions: 'y', input: { pedido: 'A-1', cliente: 'Ana' } })
  assert.match(query, /A-1/)
  assert.match(query, /Ana/)
  assert.match(buildRetrievalQuery({ objective: '', instructions: '', input: [1, 2, 3] }), /\[1,2,3\]/)
})

test('the question is bounded', () => {
  assert.ok(buildRetrievalQuery({ objective: 'x'.repeat(5000), instructions: '', input: '' }).length <= 2000)
})

test('nothing to ask about yields an empty question, not "undefined"', () => {
  assert.equal(buildRetrievalQuery({ objective: null, instructions: null, input: null }), '')
  assert.equal(buildRetrievalQuery({}), '')
})

// --- the routine step honours the grounding status --------------------------------

const AGENT = new ObjectId()
const OWNER = 'grounding-owner'

const deps = (over = {}) => ({
  loadAgent: async () => ({ _id: AGENT, ownerId: OWNER, name: 'Ana', objective: 'Atender', provider: 'anthropic', model: null, preset: 'custom', inputContract: 'um pedido', outputContract: 'um resumo', ...over.agent }),
  resolveOwnedSectorId: async () => null,
  retrieveContext: async () => ({ context: [], failed: false, status: 'empty' }),
  resolveTools: async () => [],
  apiKeyFor: async () => 'k',
  runTask: async () => ({ output: 'pronto', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  charge: async () => true,
  chargeKeyFor: () => 'charge',
  finalizeEvent: async () => undefined,
  eventKeyFor: () => 'event',
  sleep: async () => undefined,
  ...over,
})

const call = { agentId: AGENT.toString(), objective: 'Resumir', instructions: 'Resuma', input: { pedido: 'A-1' }, context: [], format: 'text', stepId: 's1', attempt: 1 }
const ctx = { ownerId: OWNER, runId: 'run-1', buildingId: new ObjectId(), floorId: new ObjectId() }

test('the retrieval is asked the full question, input included', async () => {
  let asked = ''
  await executeRoutineStep(call, ctx, deps({ retrieveContext: async (_id, query) => ((asked = query), { context: [], failed: false, status: 'empty' }) }))
  assert.match(asked, /Resuma/)
  assert.match(asked, /A-1/, 'the JSON input is part of the question')
})

test('by default a failed retrieval does not stop the run, and never invents context', async () => {
  let passedContext = null
  const result = await executeRoutineStep(
    call,
    ctx,
    deps({
      retrieveContext: async () => ({ context: [], failed: true, status: 'unavailable' }),
      runTask: async (req) => ((passedContext = req.context), { output: 'pronto', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
    }),
  )
  assert.equal(result.output, 'pronto')
  assert.deepEqual(passedContext, [], 'no context is better than an invented one')
})

test('with grounding required, an unavailable base fails the step instead of guessing', async () => {
  let ran = false
  await assert.rejects(
    () =>
      executeRoutineStep(
        call,
        ctx,
        deps({
          agent: { requireGrounding: true },
          retrieveContext: async () => ({ context: [], failed: true, status: 'unavailable' }),
          runTask: async () => ((ran = true), { output: 'x', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
        }),
      ),
    (error) => {
      assert.ok(error instanceof KnowledgeUnavailableError)
      assert.equal(error.kind, 'knowledge_unavailable')
      assert.equal(error.retryable, true, 'the base may answer on the next attempt')
      return true
    },
  )
  assert.equal(ran, false, 'and nothing was spent on the model')
})

test('with grounding required, an empty base also refuses — nothing relevant is not knowledge', async () => {
  await assert.rejects(
    () => executeRoutineStep(call, ctx, deps({ agent: { requireGrounding: true }, retrieveContext: async () => ({ context: [], failed: false, status: 'empty' }) })),
    (error) => error instanceof KnowledgeUnavailableError,
  )
})

test('with grounding required and passages found, the step runs normally', async () => {
  const result = await executeRoutineStep(
    call,
    ctx,
    deps({ agent: { requireGrounding: true }, retrieveContext: async () => ({ context: ['política de trocas: 30 dias'], failed: false, status: 'ok' }) }),
  )
  assert.equal(result.output, 'pronto')
})

test('the telemetry carries counts and statuses, never content', async () => {
  const events = []
  const result = await executeRoutineStep(
    call,
    ctx,
    deps({
      retrieveContext: async () => ({ context: ['um trecho curado'], failed: false, status: 'ok' }),
      finalizeEvent: async (event) => events.push(event),
    }),
  )
  // The telemetry is written by `settle`, which the runner awaits outside the step
  // timeout — so the assertion has to wait for it too.
  assert.equal(await result.settle, true)
  const final = events.at(-1)
  assert.equal(final.metadata.grounding, 'ok')
  assert.equal(final.metadata.ragChunks, 1)
  assert.equal(final.metadata.outputFormat, 'text')
  assert.equal(final.metadata.outputRepaired, false)
  const serialized = JSON.stringify(events)
  assert.ok(!serialized.includes('um trecho curado'), 'a passage is never telemetry')
  assert.ok(!serialized.includes('pronto'), 'nor is the answer')
})

test("the agent's contracts and default format reach the model", async () => {
  let request = null
  await executeRoutineStep(
    { ...call, format: undefined },
    ctx,
    deps({
      agent: { defaultOutputFormat: 'json', outputJsonSchema: { type: 'object', properties: {} }, inputContract: 'um pedido', outputContract: 'um resumo' },
      runTask: async (req) => ((request = req), { output: '{}', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
    }),
  )
  assert.equal(request.contracts.input, 'um pedido')
  assert.equal(request.contracts.output, 'um resumo')
  assert.equal(request.output.format, 'json', "the agent's default applies when the step asks for nothing")
  assert.ok(request.output.jsonSchema)
})

test("the step's own format still wins over the agent default", async () => {
  let request = null
  await executeRoutineStep(
    { ...call, format: 'markdown' },
    ctx,
    deps({ agent: { defaultOutputFormat: 'json' }, runTask: async (req) => ((request = req), { output: 'x', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }) }),
  )
  assert.equal(request.output.format, 'markdown')
  assert.equal(request.output.jsonSchema, null)
})
