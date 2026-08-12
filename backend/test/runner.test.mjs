// Linear runner tests (plan §10/§11). IO is faked; RSS parsing + template
// rendering are the real modules. No Redis/Mongo.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { runDefinition } = await import('../dist/automations/runner.js')

const RSS = `<rss><channel><item><title>N1</title><link>https://ex.com/1</link><guid>g1</guid><pubDate>Wed, 12 Aug 2026 08:00:00 GMT</pubDate></item></channel></rss>`

const step = (id, type, config, dependsOn = [], retryPolicy = { maxAttempts: 1, backoffMs: 0 }, continueOnError = false) => ({
  id,
  name: id,
  type,
  enabled: true,
  dependsOn,
  inputMapping: {},
  config,
  timeoutMs: 0,
  retryPolicy,
  continueOnError,
})
const def = (steps) => ({ trigger: { type: 'manual' }, inputs: [], steps, resultFormat: 'markdown', deliveries: [], limits: {} })

const baseDeps = () => ({
  fetchUrl: async () => ({ body: RSS, contentType: 'application/xml' }),
  runAgent: async () => ({ output: 'RESUMO' }),
  deliver: async () => ({ providerMessageId: 'm1' }),
  now: () => Date.parse('2026-08-12T10:00:00Z'),
})

test('runs rss -> agent -> transform end to end', async () => {
  const out = await runDefinition(
    def([
      step('s1', 'source.rss', { url: 'https://ex.com/feed' }),
      step('s2', 'agent.execute', { agentId: 'a1', instruction: 'resuma' }, ['s1']),
      step('s3', 'transform.template', { template: 'Resultado: {{s2}}' }, ['s2']),
    ]),
    baseDeps(),
  )
  assert.equal(out.status, 'succeeded')
  assert.equal(out.finalOutput, 'Resultado: RESUMO')
  assert.equal(out.steps.length, 3)
})

test('retries a transient step error then succeeds', async () => {
  const deps = baseDeps()
  let calls = 0
  deps.fetchUrl = async () => {
    calls++
    if (calls < 2) throw new Error('network blip')
    return { body: RSS, contentType: 'xml' }
  }
  const out = await runDefinition(def([step('s1', 'source.rss', { url: 'x' }, [], { maxAttempts: 3, backoffMs: 0 })]), deps)
  assert.equal(out.status, 'succeeded')
  assert.equal(out.steps[0].attempts, 2)
})

test('a non-retryable failure stops the run', async () => {
  const out = await runDefinition(
    def([step('s1', 'transform.template', { template: '{{missing}}' }), step('s2', 'transform.template', { template: 'never' })]),
    baseDeps(),
  )
  assert.equal(out.status, 'failed')
  assert.equal(out.steps.length, 1) // stopped before s2
  assert.equal(out.steps[0].errorKind, 'validation')
})

test('continueOnError keeps going but the run is still failed', async () => {
  const out = await runDefinition(
    def([
      step('s1', 'transform.template', { template: '{{missing}}' }, [], { maxAttempts: 1, backoffMs: 0 }, true),
      step('s2', 'transform.template', { template: 'ok' }),
    ]),
    baseDeps(),
  )
  assert.equal(out.status, 'failed')
  assert.equal(out.steps.length, 2)
  assert.equal(out.finalOutput, 'ok')
})

test('cancellation stops remaining steps cooperatively', async () => {
  let n = 0
  const deps = { ...baseDeps(), isCanceled: () => n++ >= 1 }
  const out = await runDefinition(
    def([step('s1', 'transform.template', { template: 'a' }), step('s2', 'transform.template', { template: 'b' })]),
    deps,
  )
  assert.equal(out.status, 'canceled')
  assert.equal(out.steps[1].status, 'canceled')
})
