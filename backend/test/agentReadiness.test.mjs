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
  assert.deepEqual(byKind.manual, { kind: 'manual', allowed: true, configured: true, inconsistent: false })
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

test('manager: needs REAL collaborators, not just a permissive policy', () => {
  const m = (over) => agent({ preset: 'manager', ...over })
  // A policy is not a colleague: 'all' over an empty building reaches nobody.
  assert.equal(agentReadiness(m({ delegationPolicy: 'all' })).ready, false)
  assert.equal(agentReadiness(m({ delegationPolicy: 'all' })).issues[0].code, 'no_collaborators')
  assert.equal(agentReadiness(m({ delegationPolicy: 'all' })).issues[0].action, 'Adicionar colaboradores')
  assert.equal(agentReadiness(m({ delegationPolicy: 'none' })).ready, false)
  // Naming ids is not enough either — the count comes from who is really reachable.
  assert.equal(agentReadiness(m({ delegationPolicy: 'selected', callableAgentIds: ['x'] })).ready, false)
  // With a real reachable colleague, it is ready.
  assert.equal(agentReadiness(m({ delegationPolicy: 'all' }), wiring({ collaboratorCount: 1 })).ready, true)
})

test('researcher: needs a source (tool or knowledge)', () => {
  const r = agentReadiness(agent({ preset: 'researcher' }))
  assert.equal(r.ready, false)
  assert.equal(r.issues[0].code, 'no_research_source')
  assert.equal(r.issues[0].action, 'Adicionar ferramenta')
  assert.equal(agentReadiness(agent({ preset: 'researcher' }), wiring({ toolCount: 1 })).ready, true)
  assert.equal(agentReadiness(agent({ preset: 'researcher' }), wiring({ knowledgeCount: 3 })).ready, true)
  // Um SITE cadastrado é fonte. O dono põe o endereço em "Como trabalha", o agente ganha
  // a ferramenta de consulta — e a tela dizia que ele não tinha nada para consultar,
  // negando o que acabara de ser configurado.
  assert.equal(agentReadiness(agent({ preset: 'researcher' }), wiring({ sourceCount: 1 })).ready, true)
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
  // Monitorar É olhar uma fonte: para este preset o site é o caso principal.
  assert.equal(agentReadiness(agent({ preset: 'monitor' }), wiring({ sourceCount: 1, routineCount: 1 })).ready, true)
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
    // Specialists exist to be CALLED: an empty trigger list is correct for them, and
    // testing never needs a trigger (the playground runs the agent directly).
    const calledByOthers = ['researcher', 'analyst', 'communicator'].includes(spec.preset)
    if (calledByOthers) assert.deepEqual(spec.activationModes, [], `${spec.preset} must not carry an operational trigger`)
    else assert.ok(spec.activationModes.length > 0, `${spec.preset} needs at least one trigger`)
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

// ---------------------------------------------- write path never stores agent_only
test('sanitizeActivationWrite drops agent_only and converts it to callerPolicy', async () => {
  const { sanitizeActivationWrite } = await import('../dist/agentReadiness.js')
  // Legacy payload: the trigger list keeps only real triggers…
  const legacy = sanitizeActivationWrite(['agent_only', 'manual'])
  assert.deepEqual(legacy.activationModes, ['manual'])
  // …and the permission it meant is carried over.
  assert.equal(legacy.callerPolicy, 'all')

  // An explicit choice always wins — this never widens a restricted agent.
  assert.equal(sanitizeActivationWrite(['agent_only'], 'none').callerPolicy, 'none')
  assert.equal(sanitizeActivationWrite(['agent_only'], 'selected').callerPolicy, 'selected')

  // Nothing legacy in play: no policy is invented.
  const clean = sanitizeActivationWrite(['manual', 'scheduled'])
  assert.deepEqual(clean.activationModes, ['manual', 'scheduled'])
  assert.equal(clean.callerPolicy, undefined)

  // Unknown junk is dropped rather than stored.
  assert.deepEqual(sanitizeActivationWrite(['manual', 'nonsense']).activationModes, ['manual'])
})

test('agent_only is not a settable activation mode any more', async () => {
  const { ACTIVATION_MODES, LEGACY_ACTIVATION_MODES } = await import('../dist/agents.js')
  assert.deepEqual([...ACTIVATION_MODES], ['manual', 'scheduled', 'event', 'channel'])
  assert.deepEqual([...LEGACY_ACTIVATION_MODES], ['agent_only'])
})

// ------------------------------------------------- allowed vs configured
test('a routine on an agent that does not allow scheduling is reported as inconsistent', async () => {
  const { triggerStates, EMPTY_WIRING } = await import('../dist/agentReadiness.js')
  const states = triggerStates({ activationModes: ['manual'] }, { ...EMPTY_WIRING, routineCount: 1 })
  const scheduled = states.find((t) => t.kind === 'scheduled')
  assert.equal(scheduled.allowed, false)
  assert.equal(scheduled.configured, true)
  assert.equal(scheduled.inconsistent, true, 'the UI must be able to say "configurado, mas não permitido"')
  // A trigger that is both allowed and configured is never flagged.
  assert.equal(states.find((t) => t.kind === 'manual').inconsistent, false)
})

test('a channel is configured only when a widget really points at the agent', async () => {
  const { triggerStates, EMPTY_WIRING } = await import('../dist/agentReadiness.js')
  const allowedOnly = triggerStates({ activationModes: ['channel'] }, EMPTY_WIRING).find((t) => t.kind === 'channel')
  assert.equal(allowedOnly.allowed, true)
  assert.equal(allowedOnly.configured, false, 'accepting channels is not the same as having one')
  assert.equal(allowedOnly.inconsistent, false)

  const linked = triggerStates({ activationModes: ['channel'] }, { ...EMPTY_WIRING, channelCount: 1 }).find((t) => t.kind === 'channel')
  assert.equal(linked.configured, true)
})

test('an event trigger needs a real webhook, not just permission', async () => {
  const { triggerStates, EMPTY_WIRING } = await import('../dist/agentReadiness.js')
  const noWebhook = triggerStates({ activationModes: ['event'] }, EMPTY_WIRING).find((t) => t.kind === 'event')
  assert.equal(noWebhook.configured, false)
  const withWebhook = triggerStates({ activationModes: [] }, { ...EMPTY_WIRING, webhookCount: 1 }).find((t) => t.kind === 'event')
  assert.equal(withWebhook.configured, true)
  assert.equal(withWebhook.inconsistent, true)
})

// ------------------------------------------------------ manager collaborators
test('reachableCollaborators counts who can really be called', async () => {
  const { reachableCollaborators } = await import('../dist/agentReadiness.js')
  const manager = { id: 'm', buildingId: 'b1', delegationPolicy: 'all', callableAgentIds: [], callableSectorIds: [] }
  const agents = [
    { id: 'm', buildingId: 'b1' }, // itself — never a collaborator
    { id: 'a', buildingId: 'b1' },
    { id: 'far', buildingId: 'b2' }, // another building
    { id: 'closed', buildingId: 'b1', callerPolicy: 'none' }, // refuses calls
    { id: 'picky', buildingId: 'b1', callerPolicy: 'selected', allowedCallerAgentIds: ['someone-else'] },
  ]
  const sectors = [
    { id: 's-exec', buildingId: 'b1', executable: true },
    { id: 's-group', buildingId: 'b1', executable: false }, // organization: cannot run
    { id: 's-far', buildingId: 'b2', executable: true },
  ]
  const out = reachableCollaborators(manager, agents, sectors)
  assert.deepEqual(out.agentIds, ['a'])
  assert.deepEqual(out.sectorIds, ['s-exec'])
  assert.equal(out.count, 2)
})

test('a manager alone in the building is NOT ready, even with delegationPolicy=all', async () => {
  const { agentReadiness, reachableCollaborators, EMPTY_WIRING } = await import('../dist/agentReadiness.js')
  const manager = { id: 'm', buildingId: 'b1', preset: 'manager', objective: 'coordenar', delegationPolicy: 'all', callableAgentIds: [], callableSectorIds: [] }
  const alone = reachableCollaborators(manager, [{ id: 'm', buildingId: 'b1' }], [])
  assert.equal(alone.count, 0)

  const notReady = agentReadiness(manager, { ...EMPTY_WIRING, collaboratorCount: alone.count })
  assert.equal(notReady.ready, false)
  assert.equal(notReady.issues[0].code, 'no_collaborators')

  const withColleague = reachableCollaborators(manager, [{ id: 'm', buildingId: 'b1' }, { id: 'a', buildingId: 'b1' }], [])
  assert.equal(agentReadiness(manager, { ...EMPTY_WIRING, collaboratorCount: withColleague.count }).ready, true)
})

test('delegationPolicy=selected only counts the named colleagues that accept the call', async () => {
  const { reachableCollaborators } = await import('../dist/agentReadiness.js')
  const manager = { id: 'm', buildingId: 'b1', delegationPolicy: 'selected', callableAgentIds: ['a'], callableSectorIds: ['s-exec'] }
  const out = reachableCollaborators(
    manager,
    [{ id: 'a', buildingId: 'b1' }, { id: 'b', buildingId: 'b1' }],
    [{ id: 's-exec', buildingId: 'b1', executable: true }, { id: 's-other', buildingId: 'b1', executable: true }],
  )
  assert.deepEqual(out.agentIds, ['a'])
  assert.deepEqual(out.sectorIds, ['s-exec'])

  const none = reachableCollaborators({ ...manager, delegationPolicy: 'none' }, [{ id: 'a', buildingId: 'b1' }], [])
  assert.equal(none.count, 0)
})

// --------------------------------------------------------------- specialists
test('specialists are called by others instead of getting a manual production trigger', async () => {
  const { AGENT_PRESET_SPECS } = await import('../dist/agentPresets.js')
  for (const preset of ['researcher', 'analyst', 'communicator']) {
    const spec = AGENT_PRESET_SPECS.find((s) => s.preset === preset)
    assert.deepEqual(spec.activationModes, [], `${preset} should have no operational trigger`)
    assert.equal(spec.callerPolicy, 'all', `${preset} must stay reachable by a manager`)
  }
})
