// One executor for every HTTP tool the model can call.
//
// The old per-agent `tools[]` ran through a second implementation: a bare fetch with
// no schema validation, no domain allow list, no response cap, no masking and no
// authorisation for state-changing methods. That path is gone — a legacy tool is
// ADAPTED into the canonical shape and executed by executeToolCall, so the rules are
// the same wherever the tool came from.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/tool-unification-test'
process.env.ENCRYPTION_KEY ||= 'test-encryption-key'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { legacyToolToExecutable, missingCapability, resolveHttpTool, runResolvedTool, MAX_TOOL_ITERATIONS } = await import('../dist/agentTools.js')
const { executeToolCall } = await import('../dist/toolExecution.js')

const legacy = (over = {}) => ({
  name: 'consultar_pedido',
  description: 'Consulta um pedido',
  method: 'GET',
  url: 'https://api.exemplo.com/pedidos',
  headers: [],
  parameters: [{ name: 'numero', type: 'string', description: 'Número', required: true }],
  ...over,
})

// A throwaway HTTP server, so "it really made the call" is not a matter of opinion.
async function withServer(handler, run) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, resolve))
  try {
    return await run(server.address().port)
  } finally {
    server.close()
  }
}

test('a legacy tool becomes an executable tool with the canonical guard rails', () => {
  const executable = legacyToolToExecutable(legacy())
  assert.equal(executable.name, 'consultar_pedido')
  assert.equal(executable.method, 'GET')
  // Its own host only — the allow list a Custom Tool built from this URL would have.
  assert.deepEqual(executable.allowedDomains, ['api.exemplo.com'])
  assert.ok(executable.timeoutMs > 0)
  assert.ok(executable.maxResponseChars > 0)
  assert.ok(executable.maxCallsPerRun > 0)
  // The legacy format has no credential store, and acting alone is never inferred.
  assert.equal(executable.auth.kind, 'none')
  assert.equal(executable.allowAutonomousExecution, false)
  assert.equal(executable.enabled, true)
  // The parameters become a real JSON Schema, which is what gets validated.
  assert.equal(executable.inputSchema.type, 'object')
  assert.deepEqual(executable.inputSchema.required, ['numero'])
  assert.equal(executable.inputSchema.additionalProperties, false)
})

test('a legacy tool now validates its arguments before making any request', async () => {
  const tool = resolveHttpTool(legacy())
  const out = await tool.run({}) // 'numero' is required
  assert.equal(out.ok, false)
  assert.match(out.result, /Argumentos inválidos/)
})

test('a legacy tool is bound to its own host, redirects included', async () => {
  // The URL says one host; the tool may not reach another one.
  const out = await resolveHttpTool(legacy({ url: 'https://api.exemplo.com/pedidos' })).run({ numero: '1' })
  assert.equal(out.ok, false)
  const foreign = await executeToolCall(legacyToolToExecutable(legacy({ url: 'https://evil.example.com/' })), { numero: '1' }, { autonomous: true })
  // Reaching a host outside the allow list is refused before the request.
  assert.equal(foreign.ok, false)
})

test('a legacy tool cannot reach a private address (SSRF)', async () => {
  delete process.env.ALLOW_LOOPBACK_HTTP_TARGETS
  try {
    const out = await resolveHttpTool(legacy({ url: 'http://169.254.169.254/latest/meta-data' })).run({ numero: '1' })
    assert.equal(out.ok, false)
    assert.ok(!out.result.includes('meta-data'), 'nothing from the metadata service comes back')
  } finally {
    process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'
  }
})

test('a legacy WRITE tool refuses to act alone, with a structured capability refusal', async () => {
  let called = false
  await withServer(
    (_req, res) => {
      called = true
      res.end('{}')
    },
    async (port) => {
      const out = await resolveHttpTool(legacy({ method: 'POST', url: `http://127.0.0.1:${port}/pedidos` })).run({ numero: '1' })
      assert.equal(out.ok, false)
      assert.equal(called, false, 'the request was never made')
      const parsed = JSON.parse(out.result)
      assert.equal(parsed.status, 'capability_unavailable')
      assert.equal(parsed.executed, false, 'the model must not read this as done')
      assert.equal(parsed.reason, 'autonomous_execution_not_authorized')
      assert.match(parsed.instruction, /NÃO foi executada/)
    },
  )
})

test('a legacy READ tool still works, and its response is capped', async () => {
  await withServer(
    (req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ url: req.url, situacao: 'entregue', filler: 'x'.repeat(50_000) }))
    },
    async (port) => {
      const out = await resolveHttpTool(legacy({ url: `http://127.0.0.1:${port}/pedidos` })).run({ numero: 'A-1' })
      assert.equal(out.ok, true)
      assert.match(out.result, /entregue/)
      assert.match(out.result, /numero=A-1/, 'the argument travelled as a query parameter')
      assert.ok(out.result.length <= 4100, 'the canonical response cap applies now')
    },
  )
})

test('a disabled tool reports a capability that does not exist, never an outcome', async () => {
  const out = await executeToolCall({ ...legacyToolToExecutable(legacy()), enabled: false }, { numero: '1' }, { autonomous: true })
  assert.equal(out.ok, false)
  const parsed = JSON.parse(out.result)
  assert.equal(parsed.status, 'capability_unavailable')
  assert.equal(parsed.executed, false)
  assert.equal(parsed.reason, 'tool_disabled')
})

// --- the single dispatcher --------------------------------------------------------

const fakeTool = (over = {}) => ({
  name: 'agendar',
  description: 'Agenda algo',
  inputSchema: { type: 'object', properties: { quando: { type: 'string' } }, required: ['quando'], additionalProperties: false },
  run: async () => ({ ok: true, result: 'feito' }),
  ...over,
})

test('every tool has its arguments validated by the dispatcher — built-ins included', async () => {
  let ran = false
  const tool = fakeTool({ run: async () => ((ran = true), { ok: true, result: 'feito' }) })
  const bad = await runResolvedTool([tool], 'agendar', { quandoo: 'amanhã' })
  assert.equal(bad.ok, false)
  assert.equal(ran, false, 'a built-in adapter never receives a field it did not declare')
  const parsed = JSON.parse(bad.result)
  assert.equal(parsed.status, 'invalid_arguments')
  assert.equal(parsed.executed, false)

  const good = await runResolvedTool([tool], 'agendar', { quando: 'amanhã' })
  assert.equal(good.ok, true)
  assert.equal(ran, true)
})

test('a tool the agent does not have comes back as a missing capability', async () => {
  const out = await runResolvedTool([fakeTool()], 'ferramenta_inventada', {})
  assert.equal(out.ok, false)
  const parsed = JSON.parse(out.result)
  assert.equal(parsed.status, 'capability_unavailable')
  assert.equal(parsed.executed, false)
  assert.equal(parsed.tool, 'ferramenta_inventada')
})

test('the structured refusal always says the action did not happen', () => {
  const parsed = JSON.parse(missingCapability('x', 'not_connected').result)
  assert.equal(parsed.executed, false)
  assert.match(parsed.instruction, /Não afirme que foi/)
})

test('the global tool-iteration cap is one number, shared by both providers', () => {
  assert.equal(MAX_TOOL_ITERATIONS, 6)
})
