import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// Webhook trigger crypto (plan §11.3). Public key is hard to guess; the signing
// secret is stored encrypted and never returned after creation. HMAC verification
// is constant-time. Pure and unit-tested.

export function generatePublicKey(): string {
  return randomBytes(18).toString('base64url')
}
export function generateSecret(): string {
  return randomBytes(32).toString('hex')
}

export function signBody(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

export function verifySignature(secret: string, body: string, signature: string | null | undefined): boolean {
  if (!signature) return false
  const expected = Buffer.from(signBody(secret, body))
  const provided = Buffer.from(signature)
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

// Idempotency for a webhook fire: the provider's event id when present, else a
// hash of the body — so a replayed delivery never creates a second run.
export function webhookIdempotencyKey(automationId: string, eventId: string | null, body: string): string {
  if (eventId) return `${automationId}:evt:${eventId}`
  return `${automationId}:hash:${createHash('sha256').update(body).digest('hex').slice(0, 32)}`
}
