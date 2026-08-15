// The tool executor is where a MODEL's output turns into a real HTTP request
// carrying a real credential. Every test here is a way that could go wrong:
// invalid arguments, a host the tool may not touch, a loop, a timeout, an SSRF
// redirect, and above all a credential leaking into something someone can read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
process.env.ENCRYPTION_KEY ||= 'test-only-encryption-key-'.padEnd(40, 'x')
// Lets the tests reach a server they started on 127.0.0.1. LOOPBACK ONLY — the
// metadata-service redirect below is still blocked, so that test stays honest.
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { executeToolCall, maskHeaders, maskUrl, redactSecrets, isRetryable } = await import('../dist/toolExecution.js')
const { encrypt } = await import('../dist/crypto.js')

// A local HTTP server stands in for "somebody's API": real sockets, real
// redirects, real timeouts — no mocking of the thing under test.
function startServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}
const close = (server) => new Promise((resolve) => server.close(resolve))

const SECRET = 'super-secret-token-value'

const tool = (over = {}) => ({
  _id: new ObjectId(),
  ownerId: 'o1',
  name: 'consultar',
  description: 'Consulta alguma coisa',
  method: 'GET',
  url: 'http://127.0.0.1:1/',
  headers: [],
  inputSchema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
  bodyTemplate: null,
  auth: { kind: 'none' },
  timeoutMs: 2000,
  maxResponseChars: 1000,
  allowedDomains: [],
  maxCallsPerRun: 3,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
})

// --------------------------------------------------------------- masking
test('sensitive headers are masked by NAME, including ones the user typed', () => {
  const masked = maskHeaders({ Authorization: 'Bearer abc', 'X-Api-Key': 'k', 'X-Custom-Token': 't', Accept: 'application/json' })
  assert.equal(masked.Authorization, '***')
  assert.equal(masked['X-Api-Key'], '***')
  assert.equal(masked['X-Custom-Token'], '***', 'a header we did not inject must be masked too')
  assert.equal(masked.Accept, 'application/json', 'harmless headers stay readable')
})

test('credentials in the URL are masked', () => {
  assert.match(maskUrl('https://api.x.com/v1?api_key=abc123&page=2'), /api_key=\*\*\*/)
  assert.match(maskUrl('https://api.x.com/v1?api_key=abc123&page=2'), /page=2/)
  assert.match(maskUrl('https://user:pw@api.x.com/'), /\*\*\*/)
  assert.ok(!maskUrl('https://user:pw@api.x.com/').includes('pw'))
  // A malformed URL is returned as-is rather than throwing mid-log.
  assert.equal(maskUrl('nao é url'), 'nao é url')
})

test('a secret echoed back by the API is redacted', () => {
  assert.equal(redactSecrets(`token=${SECRET} ok`, [SECRET]), 'token=*** ok')
  // Too-short strings are not redacted — that would mangle ordinary text.
  assert.equal(redactSecrets('abc', ['a']), 'abc')
})

// ----------------------------------------------------------- validation
test('invalid arguments are refused BEFORE any request is made', async () => {
  let called = false
  const { server, port } = await startServer((_req, res) => {
    called = true
    res.end('{}')
  })
  try {
    const out = await executeToolCall(tool({ url: `http://127.0.0.1:${port}/` }), { numero: 42 })
    assert.equal(out.ok, false)
    assert.match(out.result, /Argumentos inválidos.*numero/)
    assert.equal(called, false, 'nothing may be sent when the model got the arguments wrong')
  } finally {
    await close(server)
  }
})

test('a missing required argument names the field so the model can retry', async () => {
  const out = await executeToolCall(tool(), {})
  assert.equal(out.ok, false)
  assert.match(out.result, /numero.*obrigat/)
})

// ----------------------------------------------------------- permissions
test('a disabled tool refuses to run', async () => {
  const out = await executeToolCall(tool({ enabled: false }), { numero: '1' })
  assert.equal(out.ok, false)
  assert.match(out.result, /desativada/)
})

test('a host outside allowedDomains is refused even though the URL says otherwise', async () => {
  const out = await executeToolCall(tool({ url: 'https://evil.example.com/', allowedDomains: ['api.exemplo.com'] }), { numero: '1' })
  assert.equal(out.ok, false)
  assert.match(out.result, /não tem permissão para acessar evil\.example\.com/)
})

test('a subdomain of an allowed domain is accepted', async () => {
  // Reaches the network guard rather than the domain guard — proof it got past it.
  const out = await executeToolCall(tool({ url: 'https://v2.api.exemplo.com/', allowedDomains: ['api.exemplo.com'] }), { numero: '1' })
  assert.ok(!/não tem permissão/.test(out.result), out.result)
})

test('the per-run call limit stops a loop', async () => {
  const { server, port } = await startServer((_req, res) => res.end('ok'))
  try {
    const t = tool({ url: `http://127.0.0.1:${port}/`, maxCallsPerRun: 2 })
    assert.equal((await executeToolCall(t, { numero: '1' }, { callsSoFar: 0 })).ok, true)
    assert.equal((await executeToolCall(t, { numero: '1' }, { callsSoFar: 1 })).ok, true)
    const blocked = await executeToolCall(t, { numero: '1' }, { callsSoFar: 2 })
    assert.equal(blocked.ok, false)
    assert.match(blocked.result, /Limite de 2 chamada/)
  } finally {
    await close(server)
  }
})

// -------------------------------------------------------------- requests
test('a GET sends the arguments as query parameters and returns the body', async () => {
  const { server, port } = await startServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ recebido: url.searchParams.get('numero') }))
  })
  try {
    const out = await executeToolCall(tool({ url: `http://127.0.0.1:${port}/pedidos` }), { numero: 'A-1' })
    assert.equal(out.ok, true, out.result)
    assert.match(out.result, /"recebido":"A-1"/)
    assert.equal(out.detail.status, 200)
  } finally {
    await close(server)
  }
})

test('a POST sends a JSON body, and {{arg}} fills a template', async () => {
  let received = ''
  const { server, port } = await startServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received = body
      res.end('ok')
    })
  })
  try {
    const out = await executeToolCall(
      tool({ url: `http://127.0.0.1:${port}/`, method: 'POST', bodyTemplate: '{"pedido":"{{numero}}"}' }),
      { numero: 'A-9' },
    )
    assert.equal(out.ok, true, out.result)
    assert.equal(received, '{"pedido":"A-9"}')
  } finally {
    await close(server)
  }
})

test('a {{arg}} in the URL is percent-encoded so it cannot smuggle parameters', async () => {
  let path = ''
  const { server, port } = await startServer((req, res) => {
    path = req.url
    res.end('ok')
  })
  try {
    await executeToolCall(tool({ url: `http://127.0.0.1:${port}/p/{{numero}}` }), { numero: 'a&admin=1' })
    // '&' AND '=' are both encoded, so the argument cannot become a parameter.
    assert.equal(path, '/p/a%26admin%3D1', `argument leaked into the query: ${path}`)
  } finally {
    await close(server)
  }
})

test('an HTTP error comes back as a failure the model can read', async () => {
  const { server, port } = await startServer((_req, res) => {
    res.statusCode = 404
    res.end('não encontrado')
  })
  try {
    const out = await executeToolCall(tool({ url: `http://127.0.0.1:${port}/` }), { numero: '1' })
    assert.equal(out.ok, false)
    assert.match(out.result, /HTTP 404.*não encontrado/)
    assert.equal(out.detail.status, 404)
  } finally {
    await close(server)
  }
})

test('a response longer than the cap is truncated and flagged', async () => {
  const { server, port } = await startServer((_req, res) => res.end('x'.repeat(5000)))
  try {
    const out = await executeToolCall(tool({ url: `http://127.0.0.1:${port}/`, maxResponseChars: 100 }), { numero: '1' })
    assert.equal(out.ok, true)
    assert.equal(out.result.length, 100)
    assert.equal(out.detail.truncated, true)
  } finally {
    await close(server)
  }
})

test('a slow endpoint hits the timeout instead of hanging the run', async () => {
  const { server, port } = await startServer(() => {
    /* never responds */
  })
  try {
    const started = Date.now()
    const out = await executeToolCall(tool({ url: `http://127.0.0.1:${port}/`, timeoutMs: 1000 }), { numero: '1' })
    assert.equal(out.ok, false)
    assert.ok(Date.now() - started < 5000, 'must give up at its own timeout')
  } finally {
    await close(server)
  }
})

// ------------------------------------------------------------------ SSRF
test('a public URL that redirects to a private address is refused', async () => {
  const { server, port } = await startServer((_req, res) => {
    // The classic escalation: a legitimate host bouncing to link-local metadata.
    res.statusCode = 302
    res.setHeader('location', 'http://169.254.169.254/latest/meta-data/')
    res.end()
  })
  try {
    const out = await executeToolCall(tool({ url: `http://127.0.0.1:${port}/` }), { numero: '1' })
    assert.equal(out.ok, false, 'a redirect to a private network must never be followed')
    assert.ok(!out.result.includes('meta-data'), out.result)
  } finally {
    await close(server)
  }
})

// --------------------------------------------------------- secret safety
test('a Bearer credential reaches the API but never the result or the log', async () => {
  let seenAuth = ''
  const { server, port } = await startServer((req, res) => {
    seenAuth = req.headers.authorization ?? ''
    // An API that echoes the request back — the worst case for leaking.
    res.end(JSON.stringify({ youSent: seenAuth }))
  })
  try {
    const out = await executeToolCall(
      tool({ url: `http://127.0.0.1:${port}/`, auth: { kind: 'bearer', secretEncrypted: encrypt(SECRET) } }),
      { numero: '1' },
    )
    assert.equal(seenAuth, `Bearer ${SECRET}`, 'the real credential must reach the API')
    assert.ok(!out.result.includes(SECRET), `the secret leaked into the model's view: ${out.result}`)
    assert.equal(out.detail.request.headers.Authorization, '***')
    assert.ok(!JSON.stringify(out.detail).includes(SECRET), 'the secret leaked into the run log')
  } finally {
    await close(server)
  }
})

test('an API key goes in the configured header and is masked everywhere', async () => {
  let seen = ''
  const { server, port } = await startServer((req, res) => {
    seen = req.headers['x-minha-chave'] ?? ''
    res.end('ok')
  })
  try {
    const out = await executeToolCall(
      tool({ url: `http://127.0.0.1:${port}/`, auth: { kind: 'api_key', headerName: 'X-Minha-Chave', secretEncrypted: encrypt(SECRET) } }),
      { numero: '1' },
    )
    assert.equal(seen, SECRET)
    assert.equal(out.detail.request.headers['X-Minha-Chave'], '***')
  } finally {
    await close(server)
  }
})

test('basic auth builds the header and hides the password', async () => {
  let seen = ''
  const { server, port } = await startServer((req, res) => {
    seen = req.headers.authorization ?? ''
    res.end('ok')
  })
  try {
    const out = await executeToolCall(
      tool({ url: `http://127.0.0.1:${port}/`, auth: { kind: 'basic', username: 'ana', secretEncrypted: encrypt(SECRET) } }),
      { numero: '1' },
    )
    assert.equal(seen, `Basic ${Buffer.from(`ana:${SECRET}`).toString('base64')}`)
    assert.ok(!JSON.stringify(out.detail).includes(SECRET))
  } finally {
    await close(server)
  }
})

test('a tool configured with auth but no stored credential fails cleanly', async () => {
  const out = await executeToolCall(tool({ auth: { kind: 'bearer', secretEncrypted: null } }), { numero: '1' })
  assert.equal(out.ok, false)
  assert.match(out.result, /sem credencial/)
})

// ---------------------------------------------------------------- retries
test('only safe methods are retryable', () => {
  assert.equal(isRetryable({ method: 'GET' }), true)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(isRetryable({ method }), false, `${method} must never be retried automatically`)
  }
})
