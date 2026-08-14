// Runner: usage really flows up (step + run totals) and a retry is visible as
// attempts — the two facts the telemetry fix depends on.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { runDefinition } = await import('../dist/automations/runner.js')

const agentStep = (over = {}) => ({
  id: 's1',
  name: 'Executar',
  type: 'agent.execute',
  enabled: true,
  dependsOn: [],
  inputMapping: {},
  config: { agentId: 'a1', instruction: 'faça', format: 'markdown' },
  timeoutMs: 0,
  retryPolicy: { maxAttempts: 3, backoffMs: 0 },
  continueOnError: false,
  ...over,
})
const def = (steps) => ({ trigger: { type: 'manual' }, inputs: [], steps, resultFormat: 'markdown', deliveries: [], limits: {} })
const baseDeps = (runAgent) => ({ fetchUrl: async () => ({ body: '', contentType: '' }), runAgent, deliver: async () => ({ providerMessageId: null }), now: () => 0 })

test('usage flows from runAgent to the step record and the run total', async () => {
  const out = await runDefinition(
    def([agentStep()]),
    baseDeps(async () => ({ output: 'ok', usage: { inputTokens: 10, outputTokens: 5 } })),
  )
  assert.equal(out.status, 'succeeded')
  assert.deepEqual(out.steps[0].usage, { inputTokens: 10, outputTokens: 5 })
  assert.deepEqual(out.usage, { inputTokens: 10, outputTokens: 5 })
})

test('a retry accumulates the REAL consumption of every attempt and ends succeeded', async () => {
  const attempts = []
  const out = await runDefinition(
    def([agentStep()]),
    baseDeps(async (call) => {
      attempts.push(call.attempt)
      // The first attempt burns tokens and fails; the second succeeds.
      if (call.attempt === 1) throw Object.assign(new Error('provider blip'), { kind: 'provider' })
      return { output: 'ok', usage: { inputTokens: 8, outputTokens: 4 } }
    }),
  )
  assert.equal(out.status, 'succeeded') // the earlier failure must not win
  assert.deepEqual(attempts, [1, 2]) // attempt is passed through, so charging can be per-attempt
  assert.equal(out.steps[0].attempts, 2)
  assert.deepEqual(out.usage, { inputTokens: 8, outputTokens: 4 })
})

test('a failed step still reports the usage its attempts consumed', async () => {
  const out = await runDefinition(
    def([agentStep({ retryPolicy: { maxAttempts: 2, backoffMs: 0 } })]),
    baseDeps(async () => {
      throw Object.assign(new Error('down'), { kind: 'provider' })
    }),
  )
  assert.equal(out.status, 'failed')
  assert.equal(out.steps[0].attempts, 2)
  assert.deepEqual(out.usage, { inputTokens: 0, outputTokens: 0 })
})

test('sums usage across several steps', async () => {
  const out = await runDefinition(
    def([agentStep({ id: 'a' }), agentStep({ id: 'b' })]),
    baseDeps(async () => ({ output: 'ok', usage: { inputTokens: 3, outputTokens: 2 } })),
  )
  assert.deepEqual(out.usage, { inputTokens: 6, outputTokens: 4 })
})
