// Collaboration references and webhook triggers — the two rules the UI is now
// allowed to edit. Pure: no database, no provider.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { sanitizeCollaborationRefs, reachableCollaborators } = await import('../dist/agentReadiness.js')
const { isLiveWebhook, agentsReferencedBy, liveWebhookCountByAgent, liveWebhookCountFor } = await import('../dist/automations/webhookTriggers.js')

const B1 = 'building-1'
const B2 = 'building-2'
const SELF = { id: 'me', buildingId: B1 }

// --------------------------------------------------------------- collaboration
test('a collaborator on ANOTHER FLOOR of the same building is valid', () => {
  // Two floors, one building: both agents share buildingId, so both are eligible.
  const agents = [
    { id: 'ground', buildingId: B1 },
    { id: 'upstairs', buildingId: B1 },
  ]
  const out = sanitizeCollaborationRefs(SELF, { callableAgentIds: ['ground', 'upstairs'] }, agents, [])
  assert.deepEqual(out.callableAgentIds, ['ground', 'upstairs'])

  // And it counts for readiness, so a manager with a colleague upstairs is ready.
  const manager = { id: 'me', buildingId: B1, delegationPolicy: 'all', callableAgentIds: [], callableSectorIds: [] }
  assert.equal(reachableCollaborators(manager, agents, []).count, 2)
})

test('references to another building or another owner are dropped, never stored', () => {
  const agents = [
    { id: 'same', buildingId: B1 },
    { id: 'other-building', buildingId: B2 },
  ]
  // An id from another owner simply is not in the owner-scoped list at all.
  const out = sanitizeCollaborationRefs(SELF, { callableAgentIds: ['same', 'other-building', 'from-another-owner'], allowedCallerAgentIds: ['other-building'] }, agents, [])
  assert.deepEqual(out.callableAgentIds, ['same'])
  assert.deepEqual(out.allowedCallerAgentIds, [])
})

test('an agent is never its own collaborator', () => {
  const out = sanitizeCollaborationRefs(SELF, { callableAgentIds: ['me', 'other'], allowedCallerAgentIds: ['me'] }, [{ id: 'me', buildingId: B1 }, { id: 'other', buildingId: B1 }], [])
  assert.deepEqual(out.callableAgentIds, ['other'])
  assert.deepEqual(out.allowedCallerAgentIds, [])
})

test('an organization sector is not a collaborator; an executable one is', () => {
  const sectors = [
    { id: 'grupo', buildingId: B1, executable: false },
    { id: 'time', buildingId: B1, executable: true },
    { id: 'longe', buildingId: B2, executable: true },
  ]
  const out = sanitizeCollaborationRefs(SELF, { callableSectorIds: ['grupo', 'time', 'longe'] }, [], sectors)
  assert.deepEqual(out.callableSectorIds, ['time'])
})

test('only the keys that were sent come back — a partial update stays partial', () => {
  const out = sanitizeCollaborationRefs(SELF, { callableAgentIds: [] }, [], [])
  assert.deepEqual(Object.keys(out), ['callableAgentIds'])
  assert.deepEqual(sanitizeCollaborationRefs(SELF, {}, [], []), {})
})

test('duplicates are collapsed', () => {
  const out = sanitizeCollaborationRefs(SELF, { callableAgentIds: ['a', 'a', 'a'] }, [{ id: 'a', buildingId: B1 }], [])
  assert.deepEqual(out.callableAgentIds, ['a'])
})

test('a colleague that refuses calls is not counted as reachable', () => {
  const manager = { id: 'me', buildingId: B1, delegationPolicy: 'all', callableAgentIds: [], callableSectorIds: [] }
  const agents = [{ id: 'closed', buildingId: B1, callerPolicy: 'none' }, { id: 'open', buildingId: B1 }]
  assert.deepEqual(reachableCollaborators(manager, agents, []).agentIds, ['open'])
})

// ------------------------------------------------------------------- webhooks
// What RUNS is the PUBLISHED version, so every case below is expressed as
// { automation, published } — an edited draft must never change the reported state.
const AGENT = new ObjectId()
const OTHER = new ObjectId()

const webhookDef = (agentIds = []) => ({
  trigger: { type: 'webhook', requireSignature: false },
  steps: agentIds.map((id, i) => ({ id: `s${i}`, type: 'agent.execute', enabled: true, config: { agentId: id.toString() } })),
})

// A live webhook: active, published, and its PUBLISHED definition is a webhook.
const wh = (over = {}, publishedOver) => ({
  automation: {
    agentId: AGENT,
    status: 'active',
    lastPublishedVersion: 1,
    trigger: { type: 'webhook', requireSignature: false },
    draftDefinition: webhookDef(),
    ...over,
  },
  published: publishedOver === undefined ? webhookDef() : publishedOver,
})

test('only a published AND active webhook counts as a configured event', () => {
  assert.equal(isLiveWebhook(wh()), true)
  assert.equal(isLiveWebhook(wh({ status: 'draft' })), false)
  assert.equal(isLiveWebhook(wh({ status: 'paused' })), false)
  assert.equal(isLiveWebhook(wh({ status: 'archived' })), false)
  assert.equal(isLiveWebhook(wh({ lastPublishedVersion: null })), false, 'never published = nothing can fire')
  // The PUBLISHED trigger decides, not the draft.
  assert.equal(isLiveWebhook(wh({}, { trigger: { type: 'schedule', timezone: 'UTC', cron: '0 7 * * *' }, steps: [] })), false)
})

test('an agent is found through its own routine AND through an agent.execute step', () => {
  assert.deepEqual(agentsReferencedBy(wh()), [AGENT.toString()])

  const viaStep = wh({ agentId: undefined }, webhookDef([AGENT]))
  assert.deepEqual(agentsReferencedBy(viaStep), [AGENT.toString()])

  // A disabled step fires nothing.
  const disabled = wh({ agentId: undefined }, { trigger: { type: 'webhook' }, steps: [{ id: 's1', type: 'agent.execute', enabled: false, config: { agentId: AGENT.toString() } }] })
  assert.deepEqual(agentsReferencedBy(disabled), [])

  // The same agent as routine AND as a step is one reference.
  assert.deepEqual(agentsReferencedBy(wh({}, webhookDef([AGENT]))), [AGENT.toString()])
})

test('an edited draft does NOT change the state until it is republished', () => {
  // Published: fires AGENT. Draft (unpublished): would fire OTHER.
  const edited = { automation: { agentId: undefined, status: 'active', lastPublishedVersion: 1, trigger: { type: 'webhook' }, draftDefinition: webhookDef([OTHER]) }, published: webhookDef([AGENT]) }
  assert.deepEqual(agentsReferencedBy(edited), [AGENT.toString()], 'the draft must not leak into the live state')
  assert.equal(liveWebhookCountFor([edited], AGENT.toString()), 1)
  assert.equal(liveWebhookCountFor([edited], OTHER.toString()), 0)

  // A draft that turns the trigger into a schedule changes nothing either.
  const stillWebhook = { automation: { agentId: AGENT, status: 'active', lastPublishedVersion: 1, trigger: { type: 'webhook' }, draftDefinition: { trigger: { type: 'schedule', timezone: 'UTC', cron: '* * * * *' }, steps: [] } }, published: webhookDef() }
  assert.equal(isLiveWebhook(stillWebhook), true)
})

test('republishing moves the event to the new agent', () => {
  const before = { automation: { agentId: undefined, status: 'active', lastPublishedVersion: 1, trigger: { type: 'webhook' }, draftDefinition: webhookDef([OTHER]) }, published: webhookDef([AGENT]) }
  assert.equal(liveWebhookCountFor([before], AGENT.toString()), 1)
  // After publishing version 2, the published definition IS the former draft.
  const after = { automation: { ...before.automation, lastPublishedVersion: 2 }, published: webhookDef([OTHER]) }
  assert.equal(liveWebhookCountFor([after], AGENT.toString()), 0)
  assert.equal(liveWebhookCountFor([after], OTHER.toString()), 1)
})

test('two live webhooks on the same agent are counted separately', () => {
  const list = [wh(), wh({ agentId: undefined }, webhookDef([AGENT]))]
  assert.equal(liveWebhookCountFor(list, AGENT.toString()), 2)
})

test('removing ONE webhook leaves the event trigger configured while another is live', () => {
  assert.equal(liveWebhookCountFor([wh(), wh()], AGENT.toString()), 2)
  // Pause one: still configured.
  assert.equal(liveWebhookCountFor([wh(), wh({ status: 'paused' })], AGENT.toString()), 1)
  // Pause/archive both: no longer configured.
  assert.equal(liveWebhookCountFor([wh({ status: 'paused' }), wh({ status: 'archived' })], AGENT.toString()), 0)
})

test('webhooks of other agents never leak into this agent count', () => {
  const list = [wh({ agentId: OTHER })]
  assert.equal(liveWebhookCountFor(list, AGENT.toString()), 0)
  assert.equal(liveWebhookCountByAgent(list).get(OTHER.toString()), 1)
})

test('a legacy automation with no version row falls back to its own trigger', () => {
  // published: null (the version row was never written) — the document still says
  // webhook, so it must keep working instead of silently disappearing.
  const legacy = { automation: { agentId: AGENT, status: 'active', lastPublishedVersion: 1, trigger: { type: 'webhook' }, draftDefinition: webhookDef() }, published: null }
  assert.equal(isLiveWebhook(legacy), true)
  assert.deepEqual(agentsReferencedBy(legacy), [AGENT.toString()])
})
