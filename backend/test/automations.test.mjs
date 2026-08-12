// Automation definition validation + hashing (plan §8.6/§8.7/§21.1). Pure — the
// module imports only types + node:crypto, so no MongoDB is needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { validateDefinition, computeDefinitionHash } = await import('../dist/automations/validate.js')

const step = (over = {}) => ({
  id: 's1',
  name: 'step',
  type: 'source.rss',
  enabled: true,
  dependsOn: [],
  inputMapping: {},
  config: { url: 'https://example.com/feed.xml' },
  timeoutMs: 1000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  continueOnError: false,
  ...over,
})

const def = (over = {}) => ({
  trigger: { type: 'manual' },
  inputs: [],
  steps: [
    step({ id: 's1', type: 'source.rss', config: { url: 'https://example.com/feed.xml' } }),
    step({ id: 's2', type: 'agent.execute', dependsOn: ['s1'], config: { agentId: 'a1', instruction: 'resuma' } }),
  ],
  resultFormat: 'markdown',
  deliveries: [],
  limits: { maxSteps: 20, maxToolCalls: 20, maxOutputChars: 1000, maxTokens: null },
  ...over,
})

test('a well-formed definition validates', () => {
  assert.equal(validateDefinition(def()).valid, true)
})

test('unknown step types are rejected (never silently accepted)', () => {
  const r = validateDefinition(def({ steps: [step({ type: 'source.ftp' })] }))
  assert.equal(r.valid, false)
  assert.ok(r.errors.some((e) => /unknown step type/.test(e.message)))
})

test('per-type config is validated', () => {
  assert.equal(validateDefinition(def({ steps: [step({ type: 'source.rss', config: {} })] })).valid, false)
  assert.equal(validateDefinition(def({ steps: [step({ type: 'agent.execute', config: { agentId: 'a' } })] })).valid, false)
})

test('empty steps and duplicate ids are rejected', () => {
  assert.equal(validateDefinition(def({ steps: [] })).valid, false)
  const dup = validateDefinition(def({ steps: [step({ id: 'x' }), step({ id: 'x', type: 'transform.template', config: { template: 't' } })] }))
  assert.ok(dup.errors.some((e) => /duplicate/.test(e.message)))
})

test('dependency cycles and unknown deps are caught', () => {
  const cyc = validateDefinition(
    def({
      steps: [
        step({ id: 'a', dependsOn: ['b'] }),
        step({ id: 'b', type: 'transform.template', dependsOn: ['a'], config: { template: 't' } }),
      ],
    }),
  )
  assert.ok(cyc.errors.some((e) => /cycle/.test(e.message)))
  const unknown = validateDefinition(def({ steps: [step({ id: 'a', dependsOn: ['ghost'] })] }))
  assert.ok(unknown.errors.some((e) => /unknown step: ghost/.test(e.message)))
})

test('definition hash is deterministic, key-order independent and change-sensitive', () => {
  const d = def()
  const h = computeDefinitionHash(d)
  assert.equal(computeDefinitionHash(structuredClone(d)), h)
  // reordered top-level keys hash identically
  const reordered = { limits: d.limits, deliveries: d.deliveries, resultFormat: d.resultFormat, steps: d.steps, inputs: d.inputs, trigger: d.trigger }
  assert.equal(computeDefinitionHash(reordered), h)
  // any change yields a new hash → forces a new immutable version
  assert.notEqual(computeDefinitionHash(def({ resultFormat: 'json' })), h)
})
