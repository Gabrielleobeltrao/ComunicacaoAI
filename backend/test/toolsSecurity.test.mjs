// The minimum a Custom Tool must never do: carry a credential over plain HTTP in
// production, store or hand back a credential-bearing header in clear text, or let
// an agent change something on the far side without the owner saying so.
//
// Against a REAL mongod, because create/update/read is where the leak would happen.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

const here = dirname(fileURLToPath(import.meta.url))

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { createTool, ensureToolIndexes, getTool, toPublicTool, updateTool } = await import('../dist/tools.js')
const { executeToolCall } = await import('../dist/toolExecution.js')

before(async () => {
  await mongoClient.connect()
  await ensureToolIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'tools-sec-owner'
const tools = () => db.collection('tools')
beforeEach(() => tools().deleteMany({ ownerId: OWNER }))

const input = (over = {}) => ({
  name: 'consultar_pedido',
  description: 'Consulta a situação de um pedido pelo número.',
  method: 'GET',
  url: 'https://api.exemplo.com/pedidos',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  ...over,
})

const rejects = async (fn, field) => {
  const error = await fn().then(
    () => null,
    (e) => e,
  )
  assert.ok(error, 'the call should have been refused')
  assert.equal(error.name, 'ToolValidationError')
  if (field) assert.equal(error.field, field)
  return error
}

// --- HTTPS with a credential ---------------------------------------------------

// isProduction is computed once at module load, so the production rule is exercised
// in a CLEAN child process — the same approach config.test.mjs uses.
function inProduction(toolInput) {
  const snippet = `
    const tools = await import(${JSON.stringify('file://' + resolve(here, '../dist/tools.js'))})
    try {
      await tools.createTool('child-owner', ${JSON.stringify(toolInput)})
      process.stdout.write('CREATED')
    } catch (e) {
      process.stdout.write(JSON.stringify({ name: e.name, field: e.field, message: e.message }))
    }
    // The Mongo pool would otherwise hold the child's event loop open.
    process.exit(0)
  `
  return execFileSync(process.execPath, ['--input-type=module', '-e', snippet], {
    env: {
      PATH: process.env.PATH,
      DOTENV_CONFIG_PATH: '/nonexistent-so-no-dotenv-loads',
      NODE_ENV: 'production',
      // config.ts fails fast without these; they are irrelevant to the assertion.
      CLIENT_URL: 'https://app.exemplo.com',
      BETTER_AUTH_URL: 'https://api.exemplo.com',
      PUBLIC_URL: 'https://api.exemplo.com',
      ENCRYPTION_KEY: 'test-encryption-key',
      // The same mongod this file already runs, so an ACCEPTED tool really is
      // written — proving the rule refuses the unsafe case and only that one.
      MONGODB_URI: process.env.MONGODB_URI,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

test('production refuses a credential over plain http', () => {
  const refused = JSON.parse(inProduction(input({ url: 'http://api.exemplo.com/pedidos', auth: { kind: 'bearer', secret: 'sk-live-123' } })))
  assert.equal(refused.name, 'ToolValidationError')
  assert.equal(refused.field, 'url')
  assert.match(refused.message, /https/, 'and it says what to do about it')
})

test('production still allows http for a tool with no credential', () => {
  // Nothing secret is on the wire, and an internal endpoint may legitimately be
  // plain http. The rule is about credentials, not about http itself.
  assert.equal(inProduction(input({ name: 'sem_credencial', url: 'http://interno.exemplo.com/status' })), 'CREATED')
})

test('a credential over https is fine in production', () => {
  assert.equal(inProduction(input({ name: 'com_https', auth: { kind: 'bearer', secret: 'sk-live-123' } })), 'CREATED')
})

test('development keeps http with a credential, so local testing works', async () => {
  const devTool = await createTool(OWNER, input({ url: 'http://api.exemplo.com/pedidos', auth: { kind: 'bearer', secret: 'sk-123' } }))
  assert.equal(devTool.url.startsWith('http://'), true)
})

test('a credential-bearing header is refused — it belongs in the encrypted auth', async () => {
  for (const key of ['Authorization', 'X-Api-Key', 'api_key', 'X-Auth-Token', 'Cookie', 'minha-senha', 'X-Client-Secret']) {
    const error = await rejects(() => createTool(OWNER, input({ headers: [{ key, value: 'sk-live-123' }] })), 'headers')
    assert.match(error.message, /Autentica/, 'the message points at the safe place to put it')
  }
})

test('an ordinary header still works', async () => {
  const tool = await createTool(OWNER, input({ headers: [{ key: 'Accept-Language', value: 'pt-BR' }] }))
  assert.deepEqual(tool.headers, [{ key: 'Accept-Language', value: 'pt-BR' }])
})

test('updating a tool cannot smuggle a credential into a header either', async () => {
  const tool = await createTool(OWNER, input())
  await rejects(() => updateTool(OWNER, tool._id, input({ headers: [{ key: 'Authorization', value: 'Bearer sk-live' }] })), 'headers')
  assert.deepEqual((await getTool(OWNER, tool._id)).headers, [], 'nothing was stored')
})

test('a legacy sensitive header is masked on the way out, never returned in clear', async () => {
  const tool = await createTool(OWNER, input())
  // A document written before the rule existed.
  await tools().updateOne({ _id: tool._id }, { $set: { headers: [{ key: 'Authorization', value: 'Bearer sk-live-antigo' }] } })

  const stored = await getTool(OWNER, tool._id)
  const publicTool = toPublicTool(stored)
  assert.equal(publicTool.headers[0].value, '***')
  assert.ok(!JSON.stringify(publicTool).includes('sk-live-antigo'), 'the secret is nowhere in the payload')
  assert.equal(publicTool.auth.secretEncrypted, undefined, 'and the encrypted credential never leaves either')
})

// --- autonomous execution of a mutating method ----------------------------------

const mutating = (over = {}) => ({
  name: 'criar_pedido',
  description: 'Cria um pedido no sistema externo.',
  method: 'POST',
  url: 'https://api.exemplo.com/pedidos',
  enabled: true,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  headers: [],
  allowedDomains: ['api.exemplo.com'],
  timeoutMs: 5000,
  maxResponseChars: 1000,
  maxCallsPerRun: 5,
  auth: { kind: 'none' },
  allowAutonomousExecution: false,
  ...over,
})

test('an agent may not run a POST tool without explicit authorisation', async () => {
  const outcome = await executeToolCall(mutating(), {}, { autonomous: true })
  assert.equal(outcome.ok, false)
  assert.match(outcome.result, /não está autorizada a executar sozinha/)
  // Refused BEFORE any request is attempted.
  assert.equal(outcome.detail.status, undefined)
})

test('every state-changing method is covered, and GET is not', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const outcome = await executeToolCall(mutating({ method }), {}, { autonomous: true })
    assert.equal(outcome.ok, false, `${method} must require authorisation`)
    assert.match(outcome.result, /execução autônoma|executar sozinha/)
  }
  // A GET reaches the network stage instead of being refused on authorisation.
  const read = await executeToolCall(mutating({ method: 'GET', url: 'https://127.0.0.1.nip.invalid/' }), {}, { autonomous: true })
  assert.ok(!/executar sozinha/.test(read.result), 'reading needs no such permission')
})

test('the authorisation is what unblocks it — and it defaults to off', async () => {
  const created = await createTool(OWNER, mutating())
  assert.equal(created.allowAutonomousExecution, false, 'default is always no')

  const authorised = await updateTool(OWNER, created._id, mutating({ allowAutonomousExecution: true }))
  assert.equal(authorised.allowAutonomousExecution, true)

  const outcome = await executeToolCall(authorised, {}, { autonomous: true })
  assert.ok(!/executar sozinha/.test(outcome.result), 'authorised: it is allowed to try the call')
})

test("the owner's manual test is not blocked by the agent rule", async () => {
  // autonomous is absent → this is the owner pressing the button (the route asks
  // for an explicit confirmation before getting here).
  const outcome = await executeToolCall(mutating({ url: 'https://127.0.0.1.nip.invalid/' }), {})
  assert.ok(!/executar sozinha/.test(outcome.result), 'a manual test may exercise a POST')
})
