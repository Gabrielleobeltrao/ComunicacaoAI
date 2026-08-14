// The timeout/retry boundary for agent.execute, exercised through runDefinition —
// the real path the worker takes, not just executeRoutineStep.
//
// The rule under test: the step timeout guards the EXTERNAL work (the model call).
// Once runTask has returned, the accounting handed back as `settle` finishes outside
// that window, so a slow database can never be mistaken for a slow inference and
// trigger a second (paid) model call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { runDefinition } = await import('../dist/automations/runner.js')
const { executeRoutineStep, RoutineConfigurationError } = await import('../dist/automations/routineExecution.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const AGENT_ID = new ObjectId().toString()

const agentStep = (over = {}) => ({
  id: 's1',
  name: 'Executar',
  type: 'agent.execute',
  enabled: true,
  dependsOn: [],
  inputMapping: {},
  config: { agentId: AGENT_ID, instruction: 'faça', format: 'markdown' },
  timeoutMs: 300,
  retryPolicy: { maxAttempts: 3, backoffMs: 0 },
  continueOnError: false,
  ...over,
})
const def = (steps) => ({ trigger: { type: 'manual' }, inputs: [], steps, resultFormat: 'markdown', deliveries: [], limits: {} })
const baseDeps = (runAgent) => ({ fetchUrl: async () => ({ body: '', contentType: '' }), runAgent, deliver: async () => ({ providerMessageId: null }), now: () => 0 })

// A stub agent + deps for executeRoutineStep, so these tests exercise the REAL
// wiring (runDefinition → runAgent → executeRoutineStep) without Mongo or an LLM.
const stubAgent = () => ({ _id: new ObjectId(), ownerId: 'owner-A', officeId: new ObjectId(), name: 'A', objective: '', provider: 'anthropic', model: null, preset: 'custom' })

function routineDeps(agent, over = {}) {
  const calls = { runTask: 0, charge: 0, events: 0, retrieve: 0 }
  return {
    calls,
    deps: {
      loadAgent: async () => agent,
      resolveOwnedSectorId: over.resolveOwnedSectorId ?? (async () => null),
      retrieveContext: async () => {
        calls.retrieve++
        return { context: [], failed: false }
      },
      resolveTools: async () => [],
      apiKeyFor: async () => 'k',
      runTask:
        over.runTask ??
        (async () => {
          calls.runTask++
          return { output: 'ok', usage: { inputTokens: 10, outputTokens: 5 }, toolCalls: [] }
        }),
      charge:
        over.charge ??
        (async () => {
          calls.charge++
          return true
        }),
      chargeKeyFor: (runId, stepId, agentId, attempt) => `${runId}:${stepId}:${agentId}:a${attempt}`,
      finalizeEvent:
        over.finalizeEvent ??
        (async () => {
          calls.events++
        }),
      eventKeyFor: (runId, stepId, agentId) => `${runId}:${stepId}:${agentId}`,
      sleep: async () => {}, // no real backoff in tests
    },
  }
}

// Wire runDefinition to executeRoutineStep exactly like the worker does.
const runnerFor = (agent, deps) =>
  baseDeps(async (call) => {
    const step = await executeRoutineStep(call, { ownerId: 'owner-A', runId: 'run1', buildingId: new ObjectId(), floorId: new ObjectId() }, deps)
    return { output: step.output, usage: step.usage, settle: step.settle }
  })

test('slow persistence does NOT re-run the model (timeout covers the AI only)', async () => {
  const agent = stubAgent()
  // The model answers fast; the charge takes far longer than the step timeout.
  let chargeCalls = 0
  const f = routineDeps(agent, {
    charge: async () => {
      chargeCalls++
      await sleep(600) // > timeoutMs (300)
      return true
    },
  })
  const started = Date.now()
  const out = await runDefinition(def([agentStep({ timeoutMs: 300 })]), runnerFor(agent, f.deps))

  assert.equal(out.status, 'succeeded') // the slow database is not a step failure
  assert.equal(f.calls.runTask, 1) // and above all: the model ran EXACTLY once
  assert.equal(out.steps[0].attempts, 1)
  assert.equal(chargeCalls, 1)
  assert.equal(f.calls.events, 1)
  // The run really waited for the slow accounting instead of confirming early.
  assert.ok(Date.now() - started >= 500, 'the runner awaited the slow persistence')
  assert.deepEqual(out.usage, { inputTokens: 10, outputTokens: 5 })
})

test('a REAL timeout during the inference still follows retryPolicy', async () => {
  const agent = stubAgent()
  let attempts = 0
  const f = routineDeps(agent, {
    runTask: async () => {
      attempts++
      if (attempts === 1) await sleep(600) // first inference genuinely overruns
      return { output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })
  const out = await runDefinition(def([agentStep({ timeoutMs: 300, retryPolicy: { maxAttempts: 3, backoffMs: 0 } })]), runnerFor(agent, f.deps))

  assert.equal(out.status, 'succeeded')
  assert.equal(out.steps[0].attempts, 2) // the slow inference WAS retried
  assert.equal(attempts, 2)
})

test('a real timeout that never recovers exhausts retryPolicy and fails the step', async () => {
  const agent = stubAgent()
  const f = routineDeps(agent, {
    runTask: async () => {
      await sleep(600)
      return { output: 'never', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })
  const out = await runDefinition(def([agentStep({ timeoutMs: 200, retryPolicy: { maxAttempts: 2, backoffMs: 0 } })]), runnerFor(agent, f.deps))
  assert.equal(out.status, 'failed')
  assert.equal(out.steps[0].attempts, 2)
  assert.equal(out.steps[0].errorKind, 'timeout')
})

test('a transient persistence failure is retried without a second inference', async () => {
  const agent = stubAgent()
  let chargeCalls = 0
  const f = routineDeps(agent, {
    charge: async () => {
      chargeCalls++
      if (chargeCalls === 1) throw new Error('temporary write failure')
      return true
    },
  })
  const out = await runDefinition(def([agentStep()]), runnerFor(agent, f.deps))

  assert.equal(out.status, 'succeeded')
  assert.equal(chargeCalls, 2) // the charge was retried...
  assert.equal(f.calls.runTask, 1) // ...and the model was NOT called again
})

test('persistence that keeps failing still completes the step, once', async () => {
  const agent = stubAgent()
  const f = routineDeps(agent, {
    charge: async () => {
      throw new Error('down')
    },
  })
  const out = await runDefinition(def([agentStep()]), runnerFor(agent, f.deps))
  assert.equal(out.status, 'succeeded') // the work is not thrown away
  assert.equal(f.calls.runTask, 1) // exactly one inference
})

test('a foreign sector fails BEFORE the inference and is not retried', async () => {
  const agent = stubAgent()
  const f = routineDeps(agent, { resolveOwnedSectorId: async () => null }) // never owned
  const out = await runDefinition(
    def([agentStep({ config: { agentId: AGENT_ID, instruction: 'faça', format: 'markdown', sectorId: new ObjectId().toString() }, retryPolicy: { maxAttempts: 3, backoffMs: 0 } })]),
    runnerFor(agent, f.deps),
  )

  assert.equal(out.status, 'failed')
  assert.equal(f.calls.runTask, 0) // no model call
  assert.equal(f.calls.retrieve, 0) // no knowledge retrieval
  assert.equal(f.calls.charge, 0) // no charge
  assert.equal(out.steps[0].attempts, 1) // a configuration error is NOT retried
  assert.equal(out.steps[0].errorKind, 'validation')
})

test('RoutineConfigurationError never reveals whether the id exists', () => {
  const e = new RoutineConfigurationError()
  assert.equal(e.retryable, false)
  assert.equal(e.kind, 'validation')
  assert.ok(!/exist|found|outra conta|owner/i.test(e.message))
})
