// A stored error message is written by whoever failed — a provider quoting the
// prompt it refused, a fetch quoting a URL with a key in it, a delivery quoting the
// address. None of it may leave. These pin that the public shape is CHOSEN from a
// table by category, never derived from the stored text.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { publicError, safeErrorKind } = await import('../dist/safeError.js')

test('the returned message never comes from the stored one', () => {
  const leaky = {
    kind: 'provider',
    message: 'refused prompt "o CPF do cliente é 000.000.000-00" with key sk-live-abc123 at https://api.x/y?api_key=sk-live-abc123',
  }
  const out = publicError(leaky)
  assert.equal(out.kind, 'provider')
  assert.ok(!out.message.includes('sk-live-abc123'))
  assert.ok(!out.message.includes('CPF'))
  assert.ok(!out.message.includes('api_key'))
  assert.ok(!out.message.includes('https://'))
  // It is the fixed sentence for the category, whatever the input was.
  assert.equal(out.message, publicError({ kind: 'provider', message: 'algo totalmente diferente' }).message)
})

test('every category the engine produces has its own controlled sentence', () => {
  const kinds = ['provider', 'timeout', 'validation', 'delivery', 'fetch', 'canceled', 'error']
  const messages = kinds.map((kind) => publicError({ kind }).message)
  assert.equal(new Set(messages).size, kinds.length, 'a category that reads like another one explains nothing')
  for (const message of messages) assert.ok(message.length > 10)
})

test('an unknown or missing kind degrades instead of leaking', () => {
  assert.equal(safeErrorKind('algo-novo'), 'unknown')
  assert.equal(safeErrorKind(undefined), 'unknown')
  assert.equal(safeErrorKind(null), 'unknown')
  const out = publicError({ kind: 'algo-novo', message: 'sk-live-secreto' })
  assert.equal(out.kind, 'unknown')
  assert.ok(!out.message.includes('sk-live-secreto'))
})

test('an object shaped like an error but full of junk yields nothing extra', () => {
  const out = publicError({ kind: 'timeout', message: 'x', stack: 'at Object...', cause: { headers: { authorization: 'Bearer x' } } })
  assert.deepEqual(Object.keys(out).sort(), ['kind', 'message'])
})

test('no error stays no error', () => {
  assert.equal(publicError(null), null)
  assert.equal(publicError(undefined), null)
})

test('kinds written before this table are still recognised', () => {
  assert.equal(safeErrorKind('cancel'), 'canceled')
  assert.equal(safeErrorKind('http'), 'fetch')
  assert.equal(safeErrorKind('PROVIDER'), 'provider')
})

// --- delegation ------------------------------------------------------------------
// A delegation's stored `error` is the target agent's raw failure. What leaves is
// derived from the status and the deny code the authorisation gate itself chose.

const { publicDelegationError } = await import('../dist/safeError.js')

test('a denied delegation explains the rule, never the stored message', () => {
  const codes = ['forbidden', 'depth_exceeded', 'cycle', 'unauthorized', 'budget_exceeded']
  const messages = codes.map((code) => publicDelegationError('denied', code).message)
  assert.equal(new Set(messages).size, codes.length, 'each refusal says something different')
  for (const message of messages) assert.ok(message.length > 10)
  for (const code of codes) assert.equal(publicDelegationError('denied', code).kind, 'denied')
})

test('an unknown deny code degrades to the generic refusal', () => {
  const out = publicDelegationError('denied', 'codigo-novo')
  assert.equal(out.kind, 'denied')
  assert.match(out.message, /recusada/i)
})

test('a failed delegation never carries the provider text', () => {
  // Whatever the engine stored is irrelevant: the function only reads status/code.
  const out = publicDelegationError('failed', null)
  assert.equal(out.kind, 'error')
  assert.equal(out.message, publicDelegationError('failed', 'qualquer-coisa').message)
})

test('a running or succeeded delegation has no error at all', () => {
  assert.equal(publicDelegationError('running', null), null)
  assert.equal(publicDelegationError('succeeded', null), null)
})

test('a canceled delegation says so', () => {
  assert.equal(publicDelegationError('canceled', null).kind, 'canceled')
})
