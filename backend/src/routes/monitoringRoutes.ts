import { Router } from 'express'
import {
  MonitoringError,
  createSource,
  deleteSource,
  duplicateSource,
  getSource,
  listSources,
  overview,
  readSourceOnce,
  setSourceStatus,
  testSource,
  updateSource,
} from '../monitoring/service.js'
import { KIND_CAPABILITIES, MONITORING_SOURCE_KINDS } from '../monitoring/types.js'
import { computeHealth, nextReadAt } from '../monitoring/health.js'
import { rotateWebhookSecret } from '../monitoring/webhookSource.js'
import { notFound, oid } from './http.js'

// AS ROTAS da Central — e a flag que nega de verdade.
//
// `MONITORING_CENTER_ENABLED=0` responde 404, e não esconde o botão: uma flag cosmética
// deixa a rota aberta para quem souber o caminho, que é exatamente quem não deveria entrar.

export const monitoringRouter = Router()

monitoringRouter.use((_req, res, next) => {
  if (process.env.MONITORING_CENTER_ENABLED === '0') {
    res.status(404).json({ code: 'not_found', message: 'not found' })
    return
  }
  next()
})

const recusa = (res: Parameters<typeof notFound>[0], erro: unknown): boolean => {
  if (erro instanceof MonitoringError) {
    const status = erro.code === 'duplicate' ? 409 : erro.code === 'quota' ? 413 : 400
    res.status(status).json({ code: erro.code, message: erro.message, error: erro.message })
    return true
  }
  return false
}

/** O vocabulário fechado que o wizard usa para montar cada passo. */
monitoringRouter.get('/meta', (_req, res) => {
  res.json({
    kinds: MONITORING_SOURCE_KINDS.map((k) => ({ kind: k, ...KIND_CAPABILITIES[k] })),
    transforms: ['number', 'trim', 'lower', 'upper', 'boolean', 'date', 'first', 'join', 'replace', 'default'],
  })
})

/** A VISÃO GERAL: saúde, última leitura, latência, falhas e próximo disparo. */
monitoringRouter.get('/overview', async (_req, res) => {
  res.json(await overview(res.locals.userId))
})

monitoringRouter.get('/sources', async (_req, res) => {
  const itens = await listSources(res.locals.userId)
  const agora = new Date()
  res.json({
    items: itens.map((f) => ({
      id: f._id.toString(),
      name: f.name,
      description: f.description,
      kind: f.kind,
      status: f.status,
      config: f.config,
      mapping: f.mapping,
      schema: f.schema,
      cadence: f.cadence,
      retry: f.retry,
      freshness: f.freshness,
      destination: { live: f.destination.live, history: f.destination.history, retentionDays: f.destination.retentionDays ?? null },
      entityKeyPath: f.entityKeyPath,
      dedupe: f.dedupe,
      // A saúde vai junto: a lista é a mesma pergunta da visão geral, com mais detalhe.
      health: computeHealth(f, agora).health,
      nextReadAt: nextReadAt(f, agora),
      telemetry: f.telemetry,
    })),
  })
})

monitoringRouter.post('/sources', async (req, res, next) => {
  try {
    const f = await createSource(res.locals.userId, req.body ?? {})
    res.status(201).json({ id: f._id.toString(), status: f.status })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

monitoringRouter.put('/sources/:id', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  try {
    const f = await updateSource(res.locals.userId, id, req.body ?? {})
    if (!f) return notFound(res)
    res.json({ id: f._id.toString(), status: f.status })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

/**
 * TESTAR — a mesma leitura que a fonte fará quando ativa.
 *
 * Aceita uma fonte gravada (`:id`) ou a configuração ainda não salva, que é o que o
 * wizard precisa: testar antes de existir. O que volta é a amostra REDIGIDA.
 */
monitoringRouter.post('/sources/test', async (req, res, next) => {
  try {
    res.json(await testSource(res.locals.userId, req.body ?? {}))
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

monitoringRouter.post('/sources/:id/test', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  const fonte = await getSource(res.locals.userId, id)
  if (!fonte) return notFound(res)
  try {
    res.json(await testSource(res.locals.userId, fonte))
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

/** Ler AGORA e gravar — o botão "coletar" da tela, com a mesma gravação do worker. */
monitoringRouter.post('/sources/:id/read', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  const fonte = await getSource(res.locals.userId, id)
  if (!fonte) return notFound(res)
  try {
    res.json(await readSourceOnce(fonte))
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

monitoringRouter.post('/sources/:id/activate', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  try {
    const f = await setSourceStatus(res.locals.userId, id, 'active')
    if (!f) return notFound(res)
    res.json({ id: f._id.toString(), status: f.status })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

monitoringRouter.post('/sources/:id/pause', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  try {
    const f = await setSourceStatus(res.locals.userId, id, 'paused')
    if (!f) return notFound(res)
    res.json({ id: f._id.toString(), status: f.status })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

monitoringRouter.post('/sources/:id/duplicate', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  try {
    const f = await duplicateSource(res.locals.userId, id)
    if (!f) return notFound(res)
    res.status(201).json({ id: f._id.toString(), name: f.name, status: f.status })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

/**
 * A credencial do webhook — mostrada UMA vez.
 *
 * Criar e girar são a mesma rota de propósito: girar é o caminho normal quando alguém
 * suspeita do segredo, e ter que apagar a fonte para isso faria a pessoa adiar.
 */
monitoringRouter.post('/sources/:id/webhook-secret', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  try {
    const cred = await rotateWebhookSecret(res.locals.userId, id)
    if (!cred) return notFound(res)
    res.json({
      publicKey: cred.publicKey,
      // A única vez que ele aparece. A partir daqui, só existe cifrado.
      secret: cred.secret,
      url: `${process.env.PUBLIC_URL ?? ''}/api/monitoring-hooks/${cred.publicKey}`,
      instrucoes: 'Assine o corpo com HMAC-SHA256 e envie em x-signature. Opcionalmente, x-event-id e x-timestamp.',
    })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

monitoringRouter.delete('/sources/:id', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  if (!(await deleteSource(res.locals.userId, id))) return notFound(res)
  // O histórico que ela gravou continua: apagar a regra de coleta é diferente de apagar
  // o passado.
  res.status(204).end()
})
