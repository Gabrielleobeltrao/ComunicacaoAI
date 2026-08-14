// Contracts hardened in this pass: the deliveries KPI only claims a real send
// source, tool actions count completed calls, and delegation/sector classify
// cancellation and timeout as their own terminal statuses.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { resolveMetricKey, kpiLabel, availableMetricKeys, metricKeyAvailable, composeAgentStats } = await import('../dist/agentMetrics.js')
const { buildDelegationTools, rootContext } = await import('../dist/delegation.js')

const mkAgent = (over = {}) => ({
  _id: new ObjectId(),
  ownerId: 'owner-1',
  officeId: new ObjectId(),
  name: 'A',
  objective: '',
  provider: 'anthropic',
  model: null,
  preset: 'custom',
  metricProfile: 'auto',
  delegationPolicy: 'all',
  callerPolicy: 'all',
  callableAgentIds: [],
  callableSectorIds: [],
  allowedCallerAgentIds: [],
  capabilities: [],
  activationModes: [],
  inputContract: '',
  outputContract: '',
  tools: [],
  builtinTools: [],
  structuredOutputEnabled: false,
  ...over,
})

test('communicator claims "Entregas" only with a real send source', () => {
  const comm = mkAgent({ preset: 'communicator' })
  // No real delivery → honest fallback to executions.
  assert.equal(resolveMetricKey(comm, false), 'executions')
  assert.equal(kpiLabel(comm, 'executions'), 'Execuções concluídas')
  // With a real send source → deliveries.
  assert.equal(resolveMetricKey(comm, false, { hasDeliveries: true }), 'deliveries')
  assert.equal(kpiLabel(comm, 'deliveries'), 'Entregas concluídas')
})

test('deliveries is not selectable without a real source', () => {
  const a = mkAgent()
  assert.equal(metricKeyAvailable(a, 'deliveries', false), false)
  assert.equal(metricKeyAvailable(a, 'deliveries', false, { hasDeliveries: true }), true)
  assert.ok(!availableMetricKeys(a, false).includes('deliveries'))
  assert.ok(availableMetricKeys(a, false, { hasDeliveries: true }).includes('deliveries'))
  // A manual choice with no source falls back instead of showing an empty KPI.
  assert.equal(resolveMetricKey(mkAgent({ metricProfile: 'deliveries' }), false), 'executions')
})

test('composeAgentStats threads the delivery signal into the resolved KPI', () => {
  const stats = composeAgentStats(mkAgent({ preset: 'communicator' }), { executions: 2, succeeded: 2, toolActions: 0, totalDurationMs: 100, totalInputTokens: 1, totalOutputTokens: 1 }, false, () => 7, { hasDeliveries: true })
  assert.equal(stats.specific.key, 'deliveries')
  assert.equal(stats.specific.value, 7)
  assert.equal(stats.specific.shortLabel, 'Entregas')
})

// ---- cancellation / timeout classification --------------------------------
function fakeDeps(agents, over = {}) {
  const byId = new Map(agents.map((a) => [a._id.toString(), a]))
  const finished = []
  const events = []
  return {
    finished,
    events,
    deps: {
      loadAgent: async (_o, id) => byId.get(id.toString()) ?? null,
      loadSector: async () => over.sector ?? null,
      listAgentsInBuilding: async () => agents,
      buildingIdForFloor: async () => over.buildingId,
      resolveTools: async () => [],
      apiKeyFor: async () => 'k',
      runTask: over.runTask ?? (async () => ({ output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] })),
      startDelegation: async () => new ObjectId(),
      finishDelegation: async (_id, patch) => finished.push(patch),
      recordEvent: (e) => events.push(e),
    },
  }
}

test('a delegation timeout is recorded as timeout, not a generic failure', async () => {
  const a = mkAgent()
  const b = mkAgent()
  const buildingId = a.officeId.toString()
  const f = fakeDeps([a, b], {
    buildingId,
    runTask: async () => {
      throw new Error('agent task exceeded 120000ms')
    },
  })
  const ctx = rootContext({ ownerId: 'owner-1', buildingId, correlationId: 'c', agent: a })
  const del = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'delegate_to_agent')
  await del.run({ agentId: b._id.toString(), objective: 'x' })
  assert.equal(f.events.at(-1).status, 'timeout')
})

test('a canceled delegation finalizes both the log and the event as canceled', async () => {
  const a = mkAgent()
  const b = mkAgent()
  const buildingId = a.officeId.toString()
  const f = fakeDeps([a, b], {
    buildingId,
    runTask: async () => {
      throw new Error('cancelado pelo usuário')
    },
  })
  const ctx = rootContext({ ownerId: 'owner-1', buildingId, correlationId: 'c', agent: a })
  const del = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'delegate_to_agent')
  const out = JSON.parse((await del.run({ agentId: b._id.toString(), objective: 'x' })).result)
  assert.equal(out.status, 'canceled')
  assert.equal(f.events.at(-1).status, 'canceled')
  assert.equal(f.finished.at(-1).status, 'canceled')
})

test('only COMPLETED tool calls count as tool actions', async () => {
  const a = mkAgent()
  const b = mkAgent()
  const buildingId = a.officeId.toString()
  const f = fakeDeps([a, b], {
    buildingId,
    runTask: async () => ({ output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [{ ok: true }, { ok: false }, { ok: true }] }),
  })
  const ctx = rootContext({ ownerId: 'owner-1', buildingId, correlationId: 'c', agent: a })
  const del = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'delegate_to_agent')
  await del.run({ agentId: b._id.toString(), objective: 'x' })
  assert.equal(f.events.at(-1).toolCalls, 2) // the failed call is not an action
})

test('sector executions receive the sector as explicit knowledge context', async () => {
  const a = mkAgent()
  const coord = mkAgent()
  const buildingId = a.officeId.toString()
  const sector = { _id: new ObjectId(), name: 'Time', officeId: a.officeId, mode: 'orchestrated', coordinatorAgentId: coord._id, instruction: '', members: [{ agentId: coord._id, isDefault: true }], stages: [] }
  const seen = []
  const f = fakeDeps([a, coord], { buildingId, sector })
  f.deps.retrieveContext = async (agentId, _q, opts) => {
    seen.push({ agentId: agentId.toString(), sectorId: opts.sectorId ? opts.sectorId.toString() : null })
    return ['trecho do setor']
  }
  const ctx = rootContext({ ownerId: 'owner-1', buildingId, correlationId: 'c', agent: a })
  const tool = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'delegate_to_sector')
  await tool.run({ sectorId: sector._id.toString(), objective: 'faça' })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].agentId, coord._id.toString())
  assert.equal(seen[0].sectorId, sector._id.toString()) // explicit sector context
})

test('a plain agent delegation carries NO sector context (no implicit sector base)', async () => {
  const a = mkAgent()
  const b = mkAgent()
  const buildingId = a.officeId.toString()
  const seen = []
  const f = fakeDeps([a, b], { buildingId })
  f.deps.retrieveContext = async (_id, _q, opts) => {
    seen.push(opts.sectorId)
    return []
  }
  const ctx = rootContext({ ownerId: 'owner-1', buildingId, correlationId: 'c', agent: a })
  const del = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'delegate_to_agent')
  await del.run({ agentId: b._id.toString(), objective: 'x' })
  assert.deepEqual(seen, [null])
})
