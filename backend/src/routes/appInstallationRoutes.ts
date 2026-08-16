import { Router } from 'express'
import { ValidationError } from '../building.js'
import { db } from '../db.js'
import { getApp } from '../apps/registry.js'
import {
  createInstallation,
  decryptInstallationConfig,
  deleteInstallation,
  getInstallation,
  installationPublic,
  listInstallations,
  markInstallationTested,
  patchInstallation,
  revokeInstallation,
} from '../apps/installations.js'
import { dropPinsForApp } from '../apps/navigation.js'
import { getGoogleStatus, googleConfigured } from '../googleCalendar.js'
import { auditEntity } from './auditMiddleware.js'
import { fail, notFound, oid } from './http.js'

// The owner's accounts for an App. A credential goes IN through here and never
// comes back out: no route returns a stored value, and a test never echoes a
// provider response that could contain one.

// --- instalações ----------------------------------------------------------------

export const appInstallationRouter = Router()

// How many agents depend on an installation — what the owner must be warned about
// before disconnecting (plan §7.1).
// A pin pointing at an App with no usable connection left is dead weight. Dropping
// it is idempotent and touches nothing operational.
async function cleanUpPins(ownerId: string, appKey: string): Promise<void> {
  const remaining = await listInstallations(ownerId, appKey)
  if (remaining.some((i) => i.status !== 'revoked')) return
  await dropPinsForApp(ownerId, appKey)
}

async function countAgentsUsing(ownerId: string, installationId: string): Promise<number> {
  return db.collection('agents').countDocuments({ ownerId, 'appGrants.installationId': installationId })
}

appInstallationRouter.get('/', async (req, res) => {
  const appKey = typeof req.query.appKey === 'string' ? req.query.appKey : undefined
  const list = await listInstallations(res.locals.userId, appKey)
  const withUsage = await Promise.all(
    list.map(async (i) => ({ ...installationPublic(i), agentCount: await countAgentsUsing(res.locals.userId, i._id.toString()) })),
  )
  res.json(withUsage)
})

appInstallationRouter.post('/', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { appKey?: string; name?: string; config?: unknown; publicMetadata?: Record<string, string> }
    const app = getApp(String(body.appKey ?? ''))
    if (!app) throw new ValidationError('App desconhecido')
    if (app.auth.kind === 'oauth2') throw new ValidationError('Este App é conectado pelo login do provedor, não por credencial.')
    const created = await createInstallation(res.locals.userId, app, {
      name: body.name,
      config: body.config,
      publicMetadata: body.publicMetadata,
    })
    auditEntity(res, { id: created._id.toString(), label: created.name })
    res.status(201).json(installationPublic(created))
  } catch (error) {
    fail(res, error, next)
  }
})

appInstallationRouter.get('/:id', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const installation = await getInstallation(res.locals.userId, id)
  if (!installation) return notFound(res)
  res.json({
    ...installationPublic(installation),
    agentCount: await countAgentsUsing(res.locals.userId, installation._id.toString()),
  })
})

appInstallationRouter.patch('/:id', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const existing = await getInstallation(res.locals.userId, id)
    if (!existing) return notFound(res)
    const app = getApp(existing.appKey)
    if (!app) throw new ValidationError('App desconhecido')
    const body = (req.body ?? {}) as { name?: string; config?: unknown; publicMetadata?: Record<string, string> }
    // `status` is deliberately NOT patchable: reconnecting and disconnecting are
    // their own routes, so a client cannot revive a revoked connection by PATCH.
    const updated = await patchInstallation(res.locals.userId, id, app, {
      name: body.name,
      config: body.config,
      publicMetadata: body.publicMetadata,
    })
    if (!updated) return notFound(res)
    auditEntity(res, { id: updated._id.toString(), label: updated.name })
    res.json(installationPublic(updated))
  } catch (error) {
    fail(res, error, next)
  }
})

// A test confirms the stored credential is readable and complete. It deliberately
// does NOT echo a provider response, which could contain the credential back.
appInstallationRouter.post('/:id/test', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const installation = await getInstallation(res.locals.userId, id)
  if (!installation) return notFound(res)
  const app = getApp(installation.appKey)
  if (!app) return notFound(res)

  auditEntity(res, { id: installation._id.toString(), label: installation.name })
  if (installation.status === 'revoked') {
    return res.status(400).json({ ok: false, message: 'Esta conexão foi desconectada. Conecte novamente para usá-la.' })
  }
  // OAuth apps keep their tokens in the integration store; presence there is the test.
  if (app.auth.kind === 'oauth2') {
    const status = await getGoogleStatus(res.locals.userId)
    await markInstallationTested(res.locals.userId, id, status.connected)
    return res.json({ ok: status.connected, message: status.connected ? 'Conta conectada.' : 'Conta não está conectada.' })
  }

  const config = decryptInstallationConfig(installation)
  const missing = (app.auth.fields ?? []).filter((f) => f.required && !String(config[f.key] ?? '').trim())
  const ok = missing.length === 0
  await markInstallationTested(res.locals.userId, id, ok)
  res.status(ok ? 200 : 400).json({
    ok,
    message: ok ? 'Configuração lida com sucesso.' : `Faltam dados: ${missing.map((f) => f.label).join(', ')}.`,
  })
})

// Reconnect tells the client HOW to reconnect — it never performs the exchange here.
appInstallationRouter.post('/:id/reconnect', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const installation = await getInstallation(res.locals.userId, id)
  if (!installation) return notFound(res)
  const app = getApp(installation.appKey)
  if (!app) return notFound(res)
  auditEntity(res, { id: installation._id.toString(), label: installation.name })
  if (app.auth.kind === 'oauth2') {
    if (!googleConfigured()) return res.status(400).json({ error: 'Integração com o Google não está configurada no servidor.' })
    // The consent flow itself keeps its signed, single-use state cookie.
    return res.json({ kind: 'oauth', connectPath: '/api/integrations/google/connect' })
  }
  res.json({ kind: 'credential', fields: (app.auth.fields ?? []).map((f) => ({ key: f.key, label: f.label, required: f.required, secret: f.secret })) })
})

// Disconnecting revokes. It does NOT cascade-delete anything the owner produced.
appInstallationRouter.delete('/:id', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const installation = await getInstallation(res.locals.userId, id)
  if (!installation) return notFound(res)
  auditEntity(res, { id: installation._id.toString(), label: installation.name })

  if (String(req.query.purge) === 'true') {
    // An explicit, separate action: remove the row entirely.
    const removed = await deleteInstallation(res.locals.userId, id)
    if (!removed) return notFound(res)
    await cleanUpPins(res.locals.userId, installation.appKey)
    return res.json({ deleted: true })
  }
  await revokeInstallation(res.locals.userId, id)
  await cleanUpPins(res.locals.userId, installation.appKey)
  res.json({ revoked: true })
})
