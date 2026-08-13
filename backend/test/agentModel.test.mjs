// Pure tests for the agent-as-primary-unit additive model (Phase 1): field parsing
// and legacy-safe defaults. A dummy MONGODB_URI lets agents.js import without
// connecting (MongoClient is lazy).
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { AGENT_PRESETS, ACTIVATION_MODES, parseAgentModelFields, withAgentDefaults } = await import('../dist/agents.js')

test('AGENT_PRESETS + ACTIVATION_MODES expose the expected sets', () => {
  assert.deepEqual(AGENT_PRESETS, ['manager', 'secretary', 'researcher', 'analyst', 'operator', 'communicator', 'custom'])
  assert.deepEqual(ACTIVATION_MODES, ['manual', 'scheduled', 'event', 'channel', 'agent_only'])
})

test('parseAgentModelFields accepts a valid preset + activation modes (deduped)', () => {
  const { fields, error } = parseAgentModelFields({ preset: 'researcher', activationModes: ['agent_only', 'agent_only', 'manual'] })
  assert.equal(error, undefined)
  assert.equal(fields.preset, 'researcher')
  assert.deepEqual(fields.activationModes, ['agent_only', 'manual'])
})

test('parseAgentModelFields rejects an unknown preset / bad activation mode', () => {
  assert.equal(parseAgentModelFields({ preset: 'boss' }).error, 'Unknown preset')
  assert.match(parseAgentModelFields({ activationModes: ['whenever'] }).error, /activationModes/)
})

test('parseAgentModelFields trims + dedupes id/capability lists and rejects non-strings', () => {
  const { fields } = parseAgentModelFields({ capabilities: [' pesquisa ', 'pesquisa', 'web'], callableAgentIds: ['a', 'a', 'b'] })
  assert.deepEqual(fields.capabilities, ['pesquisa', 'web'])
  assert.deepEqual(fields.callableAgentIds, ['a', 'b'])
  assert.match(parseAgentModelFields({ callableSectorIds: [1, 2] }).error, /callableSectorIds/)
})

test('parseAgentModelFields is a true partial — absent keys are not set', () => {
  const { fields, error } = parseAgentModelFields({ inputContract: 'recebe {tema}' })
  assert.equal(error, undefined)
  assert.deepEqual(Object.keys(fields), ['inputContract'])
  assert.equal(fields.inputContract, 'recebe {tema}')
})

test('withAgentDefaults backfills legacy agents but preserves set values', () => {
  const legacy = withAgentDefaults({ name: 'Old', activationModes: undefined })
  assert.equal(legacy.preset, 'custom')
  assert.deepEqual(legacy.activationModes, ['manual', 'channel'])
  assert.deepEqual(legacy.capabilities, [])
  const set = withAgentDefaults({ name: 'New', preset: 'manager', capabilities: ['orquestrar'], activationModes: ['manual', 'scheduled'] })
  assert.equal(set.preset, 'manager')
  assert.deepEqual(set.capabilities, ['orquestrar'])
  assert.deepEqual(set.activationModes, ['manual', 'scheduled'])
})
