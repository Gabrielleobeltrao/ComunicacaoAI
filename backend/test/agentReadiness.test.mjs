// The conceptual model behind the agent UX: agent_only is a permission (not a
// trigger), triggers carry "allowed" and "configured" separately, and readiness says
// per role whether the agent can actually do its job.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { normalizeActivation, callerPolicyFromLegacy, triggerStates, agentReadiness, EMPTY_WIRING, TRIGGER_KINDS } = await import('../dist/agentReadiness.js')
const { AGENT_PRESET_SPECS, presetSpec } = await import('../dist/agentPresets.js')
const { AGENT_PRESETS } = await import('../dist/agents.js')

const agent = (over = {}) => ({ preset: 'custom', objective: 'faz algo', delegationPolicy: 'none', callableAgentIds: [], callableSectorIds: [], activationModes: [], ...over })
const wiring = (over = {}) => ({ ...EMPTY_WIRING, ...over })

// ------------------------------------------------------------ agent_only
test('agent_only is not a trigger and is normalised away', () => {
  assert.deepEqual([...TRIGGER_KINDS], ['manual', 'scheduled', 'channel', 'event'])
  const legacy = normalizeActivation(['agent_only', 'scheduled'])
  assert.equal(legacy.agentOnly, true)
  assert.deepEqual(legacy.allowed, ['scheduled']) // agent_only never appears as a trigger
  const modern = normalizeActivation(['manual', 'channel'])
  assert.equal(modern.agentOnly, false)
  assert.deepEqual(modern.allowed, ['manual', 'channel'])
  assert.deepEqual(normalizeActivation(undefined), { allowed: [], agentOnly: false })
})

test('a legacy agent_only agent stays reachable by other agents', () => {
  // No stored policy: reachable (that is what agent_only meant).
  assert.equal(callerPolicyFromLegacy({ activationModes: ['agent_only'] }), 'all')
  // An explicit choice always wins — the legacy flag never widens it.
  assert.equal(callerPolicyFromLegacy({ activationModes: ['agent_only'], callerPolicy: 'none' }), 'none')
  assert.equal(callerPolicyFromLegacy({ activationModes: ['agent_only'], callerPolicy: 'selected' }), 'selected')
})

test('no preset ships agent_only as an activation any more', () => {
  for (const spec of AGENT_PRESET_SPECS) {
    assert.ok(!spec.activationModes.includes('agent_only'), `${spec.preset} still lists agent_only`)
  }
})

// ------------------------------------------------------- allowed vs configured
test('a trigger can be allowed but not configured', () => {
  const a = agent({ activationModes: ['manual', 'scheduled', 'channel', 'event'] })
  const none = triggerStates(a, wiring())
  const byKind = Object.fromEntries(none.map((t) => [t.kind, t]))
  // Manual needs nothing: allowing it IS configuring it.
  assert.deepEqual(byKind.manual, { kind: 'manual', allowed: true, configured: true })
  // The others are promises until something real exists.
  assert.equal(byKind.scheduled.allowed, true)
  assert.equal(byKind.scheduled.configured, false)
  assert.equal(byKind.channel.configured, false)
  assert.equal(byKind.event.configured, false)

  const wired = Object.fromEntries(triggerStates(a, wiring({ routineCount: 1, channelCount: 2, webhookCount: 1 })).map((t) => [t.kind, t]))
  assert.equal(wired.scheduled.configured, true)
  assert.equal(wired.channel.configured, true)
  assert.equal(wired.event.configured, true)
})

test('a trigger that is not allowed is never reported as configured by accident', () => {
  const a = agent({ activationModes: ['manual'] })
  const byKind = Object.fromEntries(triggerStates(a, wiring({ routineCount: 3 })).map((t) => [t.kind, t]))
  assert.equal(byKind.scheduled.allowed, false)
  assert.equal(byKind.scheduled.configured, true) // a routine really exists — the UI shows the mismatch
})

// -------------------------------------------------------------- readiness
test('an agent with no objective is never ready', () => {
  const r = agentReadiness(agent({ objective: '   ' }))
  assert.equal(r.ready, false)
  assert.ok(r.issues.some((i) => i.code === 'no_objective'))
  assert.ok(r.issues.every((i) => i.action && i.message && i.section))
})

test('manager: needs collaborators', () => {
  assert.equal(agentReadiness(agent({ preset: 'manager', delegationPolicy: 'none' })).ready, false)
  assert.equal(agentReadiness(agent({ preset: 'manager', delegationPolicy: 'none' })).issues[0].code, 'no_collaborators')
  assert.equal(agentReadiness(agent({ preset: 'manager', delegationPolicy: 'none' })).issues[0].action, 'Adicionar colaboradores')
  // 'all' reaches the whole building — that counts.
  assert.equal(agentReadiness(agent({ preset: 'manager', delegationPolicy: 'all' })).ready, true)
  // 'selected' must actually name someone.
  assert.equal(agentReadiness(agent({ preset: 'manager', delegationPolicy: 'selected' })).ready, false)
  assert.equal(agentReadiness(agent({ preset: 'manager', delegationPolicy: 'selected', callableAgentIds: ['x'] })).ready, true)
})

test('researcher: needs a source (tool or knowledge)', () => {
  const r = agentReadiness(agent({ preset: 'researcher' }))
  assert.equal(r.ready, false)
  assert.equal(r.issues[0].code, 'no_research_source')
  assert.equal(r.issues[0].action, 'Adicionar ferramenta')
  assert.equal(agentReadiness(agent({ preset: 'researcher' }), wiring({ toolCount: 1 })).ready, true)
  assert.equal(agentReadiness(agent({ preset: 'researcher' }), wiring({ knowledgeCount: 3 })).ready, true)
})

test('operator: needs a tool, knowledge is not enough', () => {
  assert.equal(agentReadiness(agent({ preset: 'operator' })).issues[0].code, 'no_tool')
  assert.equal(agentReadiness(agent({ preset: 'operator' }), wiring({ knowledgeCount: 5 })).ready, false)
  assert.equal(agentReadiness(agent({ preset: 'operator' }), wiring({ toolCount: 1 })).ready, true)
})

test('monitor: needs a source AND a routine', () => {
  assert.equal(agentReadiness(agent({ preset: 'monitor' })).issues[0].code, 'no_monitor_source')
  // source but no routine: still pending, with the "create a routine" call
  const noRoutine = agentReadiness(agent({ preset: 'monitor' }), wiring({ toolCount: 1 }))
  assert.equal(noRoutine.ready, false)
  assert.equal(noRoutine.issues[0].action, 'Criar rotina')
  assert.equal(agentReadiness(agent({ preset: 'monitor' }), wiring({ toolCount: 1, routineCount: 1 })).ready, true)
})

test('communicator: only complains when it was set up to send', () => {
  // no routine → nothing to deliver yet, so nothing is missing
  assert.equal(agentReadiness(agent({ preset: 'communicator' })).ready, true)
  // a routine with no destination and no channel → pending
  const pending = agentReadiness(agent({ preset: 'communicator' }), wiring({ routineCount: 1 }))
  assert.equal(pending.ready, false)
  assert.equal(pending.issues[0].code, 'no_delivery_destination')
  // a real destination clears it
  assert.equal(agentReadiness(agent({ preset: 'communicator' }), wiring({ routineCount: 1, deliveryConfigured: true })).ready, true)
  assert.equal(agentReadiness(agent({ preset: 'communicator' }), wiring({ routineCount: 1, channelCount: 1 })).ready, true)
})

test('analyst, secretary and custom are ready with just an objective', () => {
  for (const preset of ['analyst', 'secretary', 'custom']) {
    assert.equal(agentReadiness(agent({ preset })).ready, true, `${preset} should be ready`)
  }
})

// ---------------------------------------------------------- preset defaults
test('every preset ships safe, complete defaults', () => {
  assert.equal(AGENT_PRESET_SPECS.length, AGENT_PRESETS.length)
  for (const spec of AGENT_PRESET_SPECS) {
    assert.ok(['none', 'all', 'selected'].includes(spec.delegationPolicy), `${spec.preset} delegationPolicy`)
    assert.ok(['none', 'all', 'selected'].includes(spec.callerPolicy), `${spec.preset} callerPolicy`)
    // A preset must never hand out delegation to a role that does not coordinate.
    if (!['manager', 'secretary'].includes(spec.preset)) assert.equal(spec.delegationPolicy, 'none', `${spec.preset} must not delegate by default`)
    assert.ok(spec.activationModes.length > 0, `${spec.preset} needs at least one trigger`)
  }
  // Coordination roles delegate; tool roles declare they need a tool.
  assert.equal(presetSpec('manager').delegationPolicy, 'all')
  assert.equal(presetSpec('secretary').delegationPolicy, 'all')
  for (const p of ['researcher', 'operator', 'monitor']) assert.equal(presetSpec(p).requiresTool, true, `${p} requiresTool`)
  for (const p of ['manager', 'analyst', 'communicator', 'secretary', 'custom']) assert.ok(!presetSpec(p).requiresTool, `${p} must not require a tool`)
})

test('a monitor is scheduled, a manager is manual+scheduled, and none are channel-only by accident', () => {
  assert.deepEqual(presetSpec('monitor').activationModes, ['scheduled'])
  assert.deepEqual(presetSpec('manager').activationModes, ['manual', 'scheduled'])
  assert.ok(presetSpec('secretary').activationModes.includes('channel'))
})
