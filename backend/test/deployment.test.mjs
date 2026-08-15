// Guards the PRODUCTION SHAPE, not the code. The history behind these assertions:
// the backend image once defaulted to the API only while the automation worker was
// a separate resource, so a deploy that created just the backend served HTTP while
// every scheduled routine silently never ran (3 active schedules, 0 runs ever).
//
// The fix was fewer moving parts, not more: no broker, no second process. These
// lock that in — a future edit that reintroduces a mandatory sidecar has to break
// a test first.
//
// Text-level on purpose: no YAML parser is a dependency of this project, and the
// facts asserted here are the ones a careless edit would break.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const compose = read('../../compose.production-test.yml')
const envExample = read('../.env.example')
const coolify = read('../../COOLIFY_DEPLOYMENT.md')
const pkg = JSON.parse(read('../package.json'))

// The block of a top-level service, up to the next service at the same indent.
function serviceBlock(name) {
  const start = compose.indexOf(`\n  ${name}:\n`)
  assert.notEqual(start, -1, `service "${name}" is missing from compose.production-test.yml`)
  const rest = compose.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}\w[\w-]*:\n/)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

test('production compose is exactly frontend + backend', () => {
  for (const name of ['frontend', 'backend']) {
    assert.ok(compose.includes(`\n  ${name}:\n`), `missing service: ${name}`)
  }
  // No broker and no sidecar worker: those are the parts a deploy can forget.
  for (const gone of ['redis:', 'backend-worker:', 'backend-api:']) {
    assert.ok(!compose.includes(`\n  ${gone}\n`), `${gone} must not be a production service any more`)
  }
})

test('nothing in production depends on a queue broker', () => {
  assert.ok(!/redis/i.test(compose), 'compose must not mention redis')
  assert.ok(!/REDIS_URL/.test(envExample), '.env.example must not ask for REDIS_URL')
  // The guide may MENTION redis (to say it is gone and can be deleted); what it
  // must never do is ask the operator to configure one.
  assert.ok(!/REDIS_URL\s*=/.test(coolify), 'the Coolify guide must not ask for a REDIS_URL')
  assert.ok(!/^\|\s*\d+\s*\|\s*`?redis/im.test(coolify), 'redis must not appear as a resource row')
  for (const dep of ['bullmq', 'ioredis']) {
    assert.ok(!(dep in (pkg.dependencies ?? {})), `${dep} must be gone from the backend dependencies`)
  }
})

test('the backend publishes its port and drains on shutdown', () => {
  const backend = serviceBlock('backend')
  assert.match(backend, /ports:/, 'the API is reachable')
  // In-flight automation runs must finish before SIGKILL.
  assert.match(backend, /stop_grace_period:/, 'the engine needs time to drain')
  assert.match(backend, /init: true/, 'PID-1 reaping + signal forwarding')
})

test('the internal drain budget stays below the orchestrator grace period', async () => {
  // Backwards, these two kill the very thing the grace period exists for: the
  // process would give up (or be SIGKILLed) with runs still in flight.
  const grace = /stop_grace_period:\s*(\d+)s/.exec(serviceBlock('backend'))
  assert.ok(grace, 'the backend must declare a stop_grace_period')

  const { config } = await import('../dist/config.js')
  assert.ok(
    config.shutdownTimeoutMs < Number(grace[1]) * 1000,
    `SHUTDOWN_TIMEOUT_MS (${config.shutdownTimeoutMs}ms) must be under stop_grace_period (${grace[1]}s)`,
  )
  assert.match(envExample, /SHUTDOWN_TIMEOUT_MS/, '.env.example must document the knob so the two are raised together')
})

test('readiness covers the engine, not just the port', () => {
  // The healthcheck has to hit /api/ready: /api/health is liveness only and would
  // stay green on an instance whose automation engine never started.
  assert.match(serviceBlock('backend'), /\/api\/ready/, 'the healthcheck must probe readiness')
})

test('the automation engine is documented as part of the backend', () => {
  // A reader must not have to discover that routines need something extra.
  assert.match(coolify, /dois recursos/i)
  assert.match(coolify, /Automation engine up/, 'the guide must show how to confirm it is running')
  assert.match(envExample, /EMBEDDED_WORKER/, '.env.example must document the opt-out')
  assert.ok(pkg.scripts['start:worker'], 'the dedicated-worker escape hatch must still exist')
})

test('no real secret value is committed in the deployment docs', () => {
  // Placeholders only: never a populated connection string or a 32-byte hex key.
  assert.ok(!/mongodb\+srv:\/\/[^<\s]+:[^<@\s]+@/.test(coolify), 'a real MongoDB credential leaked into the docs')
  assert.ok(!/\b[0-9a-f]{64}\b/.test(coolify), 'what looks like a generated secret leaked into the docs')
})
