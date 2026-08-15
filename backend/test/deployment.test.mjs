// Guards the PRODUCTION SHAPE, not the code: four services, a private Redis, and
// a worker that a deploy cannot forget. The gap these lock down was not
// hypothetical — the backend image defaulted to the API only, so a deploy that
// created just the backend served HTTP while every scheduled routine silently
// never ran (3 active schedules, 0 runs ever in the database).
//
// Text-level on purpose: no YAML parser is a dependency of this project, and the
// facts asserted here are the ones a careless edit would break.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const compose = read('../../compose.production-test.yml')
const dockerfile = read('../Dockerfile')
const envExample = read('../.env.example')

// The block of a top-level service, up to the next service at the same indent.
function serviceBlock(name) {
  const start = compose.indexOf(`\n  ${name}:\n`)
  assert.notEqual(start, -1, `service "${name}" is missing from compose.production-test.yml`)
  const rest = compose.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}\w[\w-]*:\n/)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

test('production compose declares exactly the four required services', () => {
  for (const name of ['frontend', 'backend-api', 'backend-worker', 'redis']) {
    assert.ok(compose.includes(`\n  ${name}:\n`), `missing service: ${name}`)
  }
})

test('API and worker are built from the SAME image with different commands', () => {
  const api = serviceBlock('backend-api')
  const worker = serviceBlock('backend-worker')
  assert.match(api, /context:\s*\.\/backend/, 'API must build from ./backend')
  assert.match(worker, /context:\s*\.\/backend/, 'worker must build from the SAME context')
  assert.match(api, /command:.*start:api/, 'API command')
  assert.match(worker, /command:.*start:worker/, 'worker command')
  // Never both in one container: no service COMMAND may run the dev multiplexer
  // (the word itself is allowed in comments explaining why).
  const commands = compose.match(/^\s*command:.*$/gm) ?? []
  assert.ok(commands.length > 0, 'commands must be explicit')
  for (const c of commands) assert.ok(!c.includes('concurrently'), `production command runs concurrently: ${c.trim()}`)
})

test('only the API publishes a port — Redis and the worker stay private', () => {
  assert.match(serviceBlock('backend-api'), /ports:/, 'the API is the public one')
  for (const name of ['backend-worker', 'redis']) {
    assert.ok(!/\n\s{4}ports:/.test(serviceBlock(name)), `${name} must not publish a host port`)
  }
})

test('Redis has a healthcheck and both backend services wait for it', () => {
  assert.match(serviceBlock('redis'), /healthcheck:[\s\S]*redis-cli/, 'redis healthcheck')
  for (const name of ['backend-api', 'backend-worker']) {
    assert.match(serviceBlock(name), /depends_on:[\s\S]*redis:[\s\S]*condition:\s*service_healthy/, `${name} must wait for a healthy redis`)
  }
})

test('the worker receives the same required configuration as the API', () => {
  // A shared YAML anchor is what keeps them from drifting; assert the mechanism
  // AND the values, so replacing the anchor by hand still has to be complete.
  assert.match(compose, /x-backend-env: &backend-env/, 'shared env anchor')
  const worker = serviceBlock('backend-worker')
  assert.match(worker, /environment:\s*\*backend-env/, 'worker reuses the shared env')
  for (const key of ['MONGODB_URI', 'REDIS_URL', 'BETTER_AUTH_SECRET', 'ENCRYPTION_KEY']) {
    assert.ok(compose.includes(`${key}:`), `shared env must carry ${key}`)
  }
  // The internal hostname, never a published one.
  assert.match(compose, /REDIS_URL:\s*redis:\/\/redis:6379/, 'REDIS_URL must use the internal Redis hostname')
})

test('the backend image documents that it serves BOTH the API and the worker', () => {
  assert.match(dockerfile, /start:worker/, 'the Dockerfile must name the worker command')
  assert.match(dockerfile, /start:api/, 'the Dockerfile must name the API command')
})

test('REDIS_URL is documented as required in production', () => {
  assert.match(envExample, /REQUIRED IN PRODUCTION/, '.env.example must flag it')
  assert.match(envExample, /start:worker/, '.env.example must point at the worker command')
  const coolify = read('../../COOLIFY_DEPLOYMENT.md')
  for (const needed of ['backend-worker', 'npm run start:worker', 'npm run start:api', 'REDIS_URL']) {
    assert.ok(coolify.includes(needed), `COOLIFY_DEPLOYMENT.md must mention ${needed}`)
  }
})

test('no real secret value is committed in the deployment docs', () => {
  const coolify = read('../../COOLIFY_DEPLOYMENT.md')
  // Placeholders only: never a populated connection string or a 32-byte hex key.
  assert.ok(!/mongodb\+srv:\/\/[^<\s]+:[^<@\s]+@/.test(coolify), 'a real MongoDB credential leaked into the docs')
  assert.ok(!/\b[0-9a-f]{64}\b/.test(coolify), 'what looks like a generated secret leaked into the docs')
})
