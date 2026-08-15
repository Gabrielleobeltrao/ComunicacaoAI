// The audit route table is the whole risk surface of the middleware: a wrong rule
// tells the owner something false about their own account. It used to be inferred
// from the path shape, which reported a playground call as "created an agent".
//
// These lock the classification of every mutating route the app exposes — including
// the ones that must NOT be recorded as changes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

// The middleware reaches the session/db modules on import; nothing here connects.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/audit-map-test'
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret'

const { auditTargetFor, auditRules } = await import('../dist/routes/auditMiddleware.js')

const ID = '000000000000000000000a11'
const ID2 = '000000000000000000000b22'
const target = (method, path) => auditTargetFor(method, path)

// --- what was wrong before ----------------------------------------------------------

test('a playground call is an execution, not the creation of an entity', () => {
  assert.equal(target('POST', `/api/agents/${ID}/playground`), null)
  assert.equal(target('POST', `/api/sectors/${ID}/playground`), null)
})

test('validating a definition changes nothing', () => {
  assert.equal(target('POST', `/api/automations/${ID}/validate`), null)
})

test('runs belong to the execution history, not to the change log', () => {
  assert.equal(target('POST', `/api/automations/${ID}/runs`), null)
  assert.equal(target('POST', `/api/runs/${ID}/cancel`), null)
})

test('disconnecting Google is a real change, and is recorded as one', () => {
  assert.deepEqual(target('DELETE', '/api/integrations/google'), {
    entityType: 'connection',
    entityId: null,
    action: 'disconnect',
  })
})

test('restoring a floor is a restore, never a creation', () => {
  assert.deepEqual(target('POST', `/api/floors/${ID}/restore`), { entityType: 'floor', entityId: ID, action: 'restore' })
  assert.deepEqual(target('POST', `/api/floors/${ID}/archive`), { entityType: 'floor', entityId: ID, action: 'archive' })
})

test('conversation traffic is never a change to the channel', () => {
  assert.equal(target('POST', `/api/widgets/${ID}/conversations/${ID2}/messages`), null)
  assert.equal(target('POST', `/api/widgets/${ID}/conversations/${ID2}/handoff`), null)
  assert.equal(target('POST', '/api/public/widgets/pk-abc/messages'), null)
  assert.equal(target('POST', `/api/whatsapp/meta/webhook/${ID}`), null)
})

// --- the rest of the map -------------------------------------------------------------

test('each entity is recorded as itself, with its own id', () => {
  const cases = [
    ['POST', '/api/agents', 'agent', 'create', null],
    ['PATCH', `/api/agents/${ID}`, 'agent', 'update', ID],
    ['DELETE', `/api/agents/${ID}`, 'agent', 'delete', ID],
    ['PUT', `/api/agents/${ID}/sector`, 'agent', 'move', ID],
    ['POST', `/api/agents/${ID}/routines`, 'routine', 'create', null],
    ['PATCH', `/api/agents/${ID}/routines/${ID2}`, 'routine', 'update', ID2],
    ['POST', `/api/agents/${ID}/routines/${ID2}/pause`, 'routine', 'pause', ID2],
    ['POST', `/api/agents/${ID}/event-triggers/${ID2}/rotate`, 'event_trigger', 'rotate', ID2],
    ['POST', '/api/sectors', 'sector', 'create', null],
    ['POST', `/api/sectors/${ID}/move`, 'sector', 'move', ID],
    ['PUT', `/api/sectors/${ID}/members`, 'sector', 'update', ID],
    ['POST', '/api/floors', 'floor', 'create', null],
    ['PATCH', '/api/building', 'building', 'update', null],
    ['POST', '/api/tools', 'tool', 'create', null],
    ['POST', `/api/tools/${ID}/test`, 'tool', 'test', ID],
    ['DELETE', `/api/tools/${ID}`, 'tool', 'delete', ID],
    ['POST', '/api/widgets', 'channel', 'create', null],
    ['DELETE', `/api/whatsapp/channels/${ID}`, 'channel', 'delete', ID],
    ['POST', '/api/connections', 'connection', 'create', null],
    ['DELETE', `/api/connections/${ID}`, 'connection', 'delete', ID],
    ['POST', `/api/agents/${ID}/documents`, 'knowledge', 'create', null],
    ['DELETE', `/api/agents/${ID}/documents/${ID2}`, 'knowledge', 'delete', ID2],
    ['POST', `/api/sectors/${ID}/documents/${ID2}/reindex`, 'knowledge', 'update', ID2],
    ['PUT', '/api/settings/monthly-token-cap', 'settings', 'update', null],
    ['PUT', '/api/settings/anthropic/key', 'settings', 'update', null],
    ['DELETE', '/api/settings/anthropic/key', 'settings', 'delete', null],
  ]
  for (const [method, path, entityType, action, entityId] of cases) {
    assert.deepEqual(target(method, path), { entityType, entityId, action }, `${method} ${path}`)
  }
})

test('reads, sessions, the public receiver and the log itself stay out', () => {
  assert.equal(target('GET', '/api/agents'), null)
  assert.equal(target('POST', '/api/auth/sign-in/email'), null)
  assert.equal(target('POST', '/api/hooks/automations/pk-abc'), null)
  assert.equal(target('POST', '/api/logs/audit'), null)
})

test('an unmapped route is not invented into the log', () => {
  assert.equal(target('POST', '/api/algo-que-nao-existe'), null)
  assert.equal(target('POST', `/api/agents/${ID}/routines/${ID2}/algo`), null)
})

// --- the map really covers the app ------------------------------------------------------
// Every mutating route the source declares must have a rule — recorded or explicitly
// not recorded. A new route without a decision fails here instead of going unnoticed.

const SOURCE_DIR = new URL('../src/', import.meta.url)
const readSource = (file) => readFileSync(new URL(file, SOURCE_DIR), 'utf8')

// The router prefixes, as index.ts mounts them.
const ROUTER_PREFIX = {
  'routes/automationRoutes.ts': '/api/automations',
  'routes/agentRoutineRoutes.ts': '/api/agents/:agentId',
  'routes/connectionRoutes.ts': '/api/connections',
  'routes/floorRoutes.ts': '/api/floors',
  'routes/runRoutes.ts': '/api/runs',
  'routes/buildingRoutes.ts': '/api/building',
  'routes/sectorKnowledgeRoutes.ts': '/api/sectors/:sectorId',
}

function declaredRoutes() {
  const found = []
  // Inline routes on the app itself.
  const index = readSource('index.ts')
  for (const m of index.matchAll(/app\.(post|put|patch|delete)\(\s*\n?\s*'([^']+)'/g)) {
    found.push([m[1].toUpperCase(), m[2]])
  }
  // Routers.
  for (const [file, prefix] of Object.entries(ROUTER_PREFIX)) {
    const source = readSource(file)
    for (const m of source.matchAll(/Router\.(post|put|patch|delete)\(\s*'([^']*)'/g)) {
      const suffix = m[2] === '/' ? '' : m[2]
      found.push([m[1].toUpperCase(), `${prefix}${suffix}`])
    }
    // The loop that registers activate/pause/archive from a list.
    for (const m of source.matchAll(/Router\.post\(\s*`([^`]+)`/g)) {
      const path = m[1].replace('${action}', 'activate')
      found.push(['POST', `${prefix}${path}`])
    }
  }
  return found
}

// A declared path (":id" style) → concrete ones the matcher can be asked about.
// `:action` is not an id: the handler accepts exactly these three verbs, and each
// one has to be classified on its own.
const ACTIONS = ['activate', 'pause', 'archive']
const concreteForms = (path) =>
  (path.includes(':action') ? ACTIONS.map((a) => path.replace(':action', a)) : [path]).map((p) => p.replace(/:[A-Za-z]+/g, ID))

test('every mutating route the app declares has an explicit decision', () => {
  const routes = declaredRoutes()
  assert.ok(routes.length > 30, `expected the scan to find the routes, found ${routes.length}`)

  const rules = auditRules()
  const undecided = []
  for (const [method, path] of routes) {
    // Skipped by prefix: auth, the public receiver, the log.
    if (['/api/auth', '/api/hooks', '/api/logs'].some((p) => path.startsWith(p))) continue
    for (const asked of concreteForms(path)) {
      const decided =
        auditTargetFor(method, asked) !== null ||
        // Explicitly NOT audited: a rule exists whose pattern matches this path.
        rules.some((rule) => {
          if (!rule.methods.includes(method)) return false
          const pattern = rule.path.split('/').filter(Boolean)
          const segments = asked.split('/').filter(Boolean)
          return pattern.length === segments.length && pattern.every((p, i) => p === ':' || p === segments[i])
        })
      if (!decided) undecided.push(`${method} ${asked}`)
    }
  }
  assert.deepEqual(undecided, [], 'these routes have no rule in the audit table')
})

test('each status action of a routine and a trigger is classified on its own', () => {
  for (const [action, expected] of [
    ['activate', 'activate'],
    ['pause', 'pause'],
    ['archive', 'archive'],
  ]) {
    assert.equal(auditTargetFor('POST', `/api/agents/${ID}/routines/${ID2}/${action}`)?.action, expected)
    assert.equal(auditTargetFor('POST', `/api/agents/${ID}/event-triggers/${ID2}/${action}`)?.action, expected)
  }
})

test('the source scan actually found the known routes (it cannot pass vacuously)', () => {
  const routes = declaredRoutes().map(([m, p]) => `${m} ${p}`)
  for (const expected of ['POST /api/agents', 'DELETE /api/tools/:toolId', 'POST /api/floors/:floorId/restore', 'POST /api/runs/:id/cancel']) {
    assert.ok(routes.includes(expected), `the scan missed ${expected}`)
  }
})

test('every route file is covered by the scan', () => {
  const files = readdirSync(new URL('routes/', SOURCE_DIR)).filter((f) => f.endsWith('Routes.ts'))
  const scanned = new Set(Object.keys(ROUTER_PREFIX).map((f) => f.replace('routes/', '')))
  // webhookRoutes is the public receiver (skipped by prefix); logRoutes is read-only.
  const exempt = new Set(['webhookRoutes.ts', 'logRoutes.ts', 'executionRoutes.ts'])
  for (const file of files) {
    assert.ok(scanned.has(file) || exempt.has(file), `${file} is neither scanned nor exempt`)
  }
})
