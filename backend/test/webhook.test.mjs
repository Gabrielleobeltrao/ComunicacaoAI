// Webhook HMAC + idempotency (plan §11.3). Pure.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { signBody, verifySignature, webhookIdempotencyKey, generatePublicKey, generateSecret } = await import('../dist/automations/webhook.js')

test('verifySignature accepts a correct HMAC and rejects tampering', () => {
  const secret = 'shh'
  const body = '{"a":1}'
  const sig = signBody(secret, body)
  assert.equal(verifySignature(secret, body, sig), true)
  assert.equal(verifySignature(secret, body, sig.slice(0, -1) + '0'), false) // altered
  assert.equal(verifySignature(secret, '{"a":2}', sig), false) // altered body
  assert.equal(verifySignature('other', body, sig), false) // wrong secret
  assert.equal(verifySignature(secret, body, null), false) // missing
})

test('idempotency key prefers event id, falls back to body hash', () => {
  assert.equal(webhookIdempotencyKey('A', 'evt-9', '{}'), 'A:evt:evt-9')
  const k1 = webhookIdempotencyKey('A', null, '{"x":1}')
  const k2 = webhookIdempotencyKey('A', null, '{"x":1}')
  const k3 = webhookIdempotencyKey('A', null, '{"x":2}')
  assert.equal(k1, k2) // deterministic
  assert.notEqual(k1, k3) // body-sensitive
  assert.match(k1, /^A:hash:/)
})

test('generated keys are distinct and non-trivial', () => {
  assert.notEqual(generatePublicKey(), generatePublicKey())
  assert.ok(generateSecret().length >= 32)
})
