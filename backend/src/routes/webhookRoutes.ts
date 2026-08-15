import { Router } from 'express'
import { decrypt } from '../crypto.js'
import { findByWebhookKey } from '../automations/repository.js'
import { createRun } from '../automations/runService.js'
import { verifySignature, webhookIdempotencyKey } from '../automations/webhook.js'

// PUBLIC route (no requireAuth) — authenticated by the unguessable public key in
// the path plus an HMAC signature over the raw body. Never uses a user session.
export const webhookRouter = Router()

webhookRouter.post('/automations/:publicKey', async (req, res, next) => {
  try {
    const automation = await findByWebhookKey(req.params.publicKey)
    // What may fire is the PUBLISHED trigger, never the draft: a half-edited
    // definition in the editor must not open — or close — a live endpoint. Older
    // documents that predate publishedTrigger fall back to their own trigger.
    const live = (automation?.publishedTrigger ?? automation?.trigger) as { type?: string; requireSignature?: boolean } | undefined
    if (!automation || automation.status !== 'active' || live?.type !== 'webhook' || !automation.webhookSecretEncrypted) {
      res.status(404).json({ code: 'not_found', message: 'not found' })
      return
    }
    const raw = (req as { rawBody?: Buffer }).rawBody?.toString('utf8') ?? ''
    const requireSignature = live.requireSignature !== false
    if (requireSignature) {
      const secret = decrypt(automation.webhookSecretEncrypted)
      if (!verifySignature(secret, raw, req.header('x-signature'))) {
        res.status(401).json({ code: 'invalid_signature', message: 'invalid signature' })
        return
      }
    }
    const key = webhookIdempotencyKey(automation._id.toString(), req.header('x-event-id') ?? null, raw)
    const { run } = await createRun(automation.ownerId, automation._id, {
      triggerType: 'webhook',
      input: req.body,
      idempotencyKey: key,
      // Correlation only, derived from ids we already own. Deliberately NOT the
      // idempotency key: that one is built from the caller's event id or a hash of
      // its body, and neither belongs in a field the UI displays.
      requestId: `webhook:${automation._id.toString()}`,
    })
    res.status(202).json({ runId: run._id, status: run.status })
  } catch (error) {
    next(error)
  }
})
