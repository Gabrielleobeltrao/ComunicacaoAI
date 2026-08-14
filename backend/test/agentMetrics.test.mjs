// Agent operational KPIs (pure): the metric catalog (resolve/label/availability),
// the stats composition (null vs real zero), and the deterministic idempotency key.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { resolveMetricKey, kpiLabel, availableMetricKeys, metricKeyAvailable, composeAgentStats, periodSince, PERIODS } = await import('../dist/agentMetrics.js')
const { runEventKey } = await import('../dist/agentEvents.js')

function mkAgent(over = {}) {
  return { preset: 'custom', metricProfile: 'auto', delegationPolicy: 'none', tools: [], builtinTools: [], structuredOutputEnabled: false, activationModes: [], ...over }
}

test('resolveMetricKey: auto derives from preset', () => {
  assert.equal(resolveMetricKey(mkAgent({ preset: 'manager' }), false), 'delegations')
  assert.equal(resolveMetricKey(mkAgent({ preset: 'secretary' }), false), 'delegations')
  assert.equal(resolveMetricKey(mkAgent({ preset: 'researcher' }), false), 'executions')
  assert.equal(resolveMetricKey(mkAgent({ preset: 'operator', tools: [{}] }), false), 'tool_actions')
  assert.equal(resolveMetricKey(mkAgent({ preset: 'monitor' }), false), 'executions')
  // custom + channel-linked prefers conversations
  assert.equal(resolveMetricKey(mkAgent({ preset: 'custom' }), true), 'conversations')
  assert.equal(resolveMetricKey(mkAgent({ preset: 'custom' }), false), 'executions')
})

test('resolveMetricKey: a manual choice wins over the preset default and survives a preset change', () => {
  // manager with a manual 'executions' choice → executions (not delegations)
  assert.equal(resolveMetricKey(mkAgent({ preset: 'manager', metricProfile: 'executions' }), false), 'executions')
  // changing the preset does not change a manual choice
  assert.equal(resolveMetricKey(mkAgent({ preset: 'researcher', metricProfile: 'delegations', delegationPolicy: 'all' }), false), 'delegations')
})

test('resolveMetricKey: a manual choice with no data source falls back to executions', () => {
  // leads chosen but no structured capture / no channel → falls back
  assert.equal(resolveMetricKey(mkAgent({ metricProfile: 'leads' }), false), 'executions')
})

test('metricKeyAvailable / availableMetricKeys respect the data source', () => {
  const base = mkAgent()
  assert.equal(metricKeyAvailable(base, 'executions', false), true)
  assert.equal(metricKeyAvailable(base, 'delegations', false), false) // policy none
  assert.equal(metricKeyAvailable(mkAgent({ delegationPolicy: 'all' }), 'delegations', false), true)
  assert.equal(metricKeyAvailable(base, 'tool_actions', false), false)
  assert.equal(metricKeyAvailable(mkAgent({ builtinTools: [{}] }), 'tool_actions', false), true)
  assert.equal(metricKeyAvailable(base, 'conversations', false), false)
  assert.equal(metricKeyAvailable(base, 'conversations', true), true)
  assert.equal(metricKeyAvailable(mkAgent({ structuredOutputEnabled: true }), 'leads', true), true)
  assert.equal(metricKeyAvailable(mkAgent({ structuredOutputEnabled: true }), 'leads', false), false) // needs channel
  // no leads for a non-channel agent even with structured output
  assert.deepEqual(availableMetricKeys(mkAgent({ delegationPolicy: 'all', tools: [{}] }), false).sort(), ['delegations', 'executions', 'tool_actions'].sort())
})

test('kpiLabel: preset-flavoured for the auto default, generic otherwise', () => {
  assert.equal(kpiLabel(mkAgent({ preset: 'researcher' }), 'executions'), 'Pesquisas concluídas')
  assert.equal(kpiLabel(mkAgent({ preset: 'monitor' }), 'executions'), 'Verificações realizadas')
  assert.equal(kpiLabel(mkAgent({ preset: 'secretary' }), 'delegations'), 'Encaminhamentos')
  // a manual choice uses the generic label
  assert.equal(kpiLabel(mkAgent({ preset: 'researcher', metricProfile: 'delegations' }), 'delegations'), 'Delegações concluídas')
})

test('composeAgentStats: null derived metrics with no telemetry, real numbers otherwise', () => {
  const agent = mkAgent({ preset: 'researcher' })
  const empty = composeAgentStats(agent, undefined, false, () => null)
  assert.equal(empty.executions, 0)
  assert.equal(empty.avgDurationMs, null)
  assert.equal(empty.avgTokensPerExecution, null)
  assert.equal(empty.successRate, null)
  assert.equal(empty.activeTimeMs, 0)
  assert.equal(empty.specific.value, null)
  assert.equal(empty.specific.key, 'executions')

  const ev = { executions: 4, succeeded: 3, toolActions: 1, totalDurationMs: 8000, totalInputTokens: 100, totalOutputTokens: 60 }
  const full = composeAgentStats(agent, ev, false, () => 3)
  assert.equal(full.executions, 4)
  assert.equal(full.avgDurationMs, 2000)
  assert.equal(full.totalTokens, 160)
  assert.equal(full.avgTokensPerExecution, 40)
  assert.equal(full.successRate, 0.75)
  assert.equal(full.specific.value, 3)
  assert.equal(full.specific.label, 'Pesquisas concluídas')
})

test('periodSince + PERIODS', () => {
  assert.deepEqual([...PERIODS], ['7d', '30d', 'all'])
  assert.equal(periodSince('all'), null)
  const now = new Date('2026-08-14T00:00:00Z')
  assert.equal(periodSince('7d', now).toISOString(), '2026-08-07T00:00:00.000Z')
  assert.equal(periodSince('30d', now).toISOString(), '2026-07-15T00:00:00.000Z')
})

test('runEventKey is deterministic (idempotency contract)', () => {
  assert.equal(runEventKey('r1', 's1', 'a1'), 'run:r1:s1:a1')
  assert.equal(runEventKey('r1', 's1', 'a1'), runEventKey('r1', 's1', 'a1')) // a retry yields the same key
  assert.notEqual(runEventKey('r1', 's1', 'a1'), runEventKey('r1', 's2', 'a1'))
})
