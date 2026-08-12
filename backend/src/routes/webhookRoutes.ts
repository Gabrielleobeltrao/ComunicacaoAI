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
    if (
      !automation ||
      automation.status !== 'active' ||
      automation.trigger.type !== 'webhook' ||
      !automation.webhookSecretEncrypted
    ) {
      res.status(404).json({ code: 'not_found', message: 'not found' })
      return
    }
    const raw = (req as { rawBody?: Buffer }).rawBody?.toString('utf8') ?? ''
    const requireSignature = (automation.trigger as { requireSignature?: boolean }).requireSignature !== false
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
    })
    res.status(202).json({ runId: run._id, status: run.status })
  } catch (error) {
    next(error)
  }
})
