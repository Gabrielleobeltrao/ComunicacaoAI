import { Router } from 'express'
import {
  MonitoringError,
  createMonitorForSource,
  createSource,
  deleteSource,
  duplicateSource,
  getSource,
  listSources,
  liveView,
  overview,
  readSourceOnce,
  setSourceStatus,
  testSource,
  updateSource,
} from '../monitoring/service.js'
import { KIND_CAPABILITIES, MONITORING_SOURCE_KINDS } from '../monitoring/types.js'
import { computeHealth, nextReadAt } from '../monitoring/health.js'
import { rotateWebhookSecret } from '../monitoring/webhookSource.js'
import { deleteSourceGrant, listSourceGrants, putSourceGrant, resolveSourceAccess } from '../monitoring/access.js'
import { migrateRecordersToSources, rollbackRecorderMigration } from '../monitoring/migration.js'
import { listarEventos } from '../monitoring/history.js'
import { MonitorError } from '../monitors/service.js'
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
    const status = erro.code === 'duplicate' ? 409 : erro.code === 'quota' ? 413 : erro.code === 'not_found' ? 404 : 400
    res.status(status).json({ code: erro.code, message: erro.message, error: erro.message })
    return true
  }
  // A recusa do motor de monitores chega inteira: ela já diz qual campo não existe na
  // fonte ou qual Flow não é desta conta, e trocar isso por "erro interno" apagaria a
  // única informação capaz de consertar o formulário.
  if (erro instanceof MonitorError) {
    res.status(erro.code === 'not_found' ? 404 : 400).json({ code: erro.code, message: erro.message, error: erro.message })
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

/**
 * O HISTÓRICO OPERACIONAL — o que aconteceu, com filtro e página.
 *
 * A aba mostrava contadores acumulados, que não respondem nenhuma das perguntas de quem
 * abre isto às três da manhã: quando parou, quanto demorou, quantas linhas vieram, qual
 * foi o erro, e se aquele Flow disparou por causa desta fonte.
 *
 * Conteúdo não sai aqui: o log diz o que aconteceu, nunca o que passou por ele.
 */
monitoringRouter.get('/history', async (req, res, next) => {
  const q = req.query
  const instante = (v: unknown): Date | null => {
    const d = v ? new Date(String(v)) : null
    return d && !Number.isNaN(d.getTime()) ? d : null
  }
  try {
    res.json(
      await listarEventos(res.locals.userId, {
        sourceId: q.sourceId ? oid(String(q.sourceId)) : null,
        kind: ['collect', 'delivery', 'dispatch'].includes(String(q.kind)) ? (String(q.kind) as 'collect' | 'delivery' | 'dispatch') : null,
        outcome: ['ok', 'unchanged', 'failed', 'refused'].includes(String(q.outcome))
          ? (String(q.outcome) as 'ok' | 'unchanged' | 'failed' | 'refused')
          : null,
        since: instante(q.since),
        until: instante(q.until),
        limit: Number(q.limit ?? 50),
        cursor: q.cursor ? String(q.cursor) : null,
      }),
    )
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

/** A VISÃO GERAL: saúde, última leitura, latência, falhas e próximo disparo. */
monitoringRouter.get('/overview', async (_req, res) => {
  res.json(await overview(res.locals.userId))
})

/**
 * O AO VIVO: o que está chegando, e não só quem está de pé.
 *
 * Quem abre esta aba quer ver o VALOR que acabou de entrar — um nome com bolinha verde não
 * responde "o que está acontecendo agora". O valor sai redigido: uma tela que fica aberta
 * na parede do escritório não pode mostrar o que veio dentro do payload.
 */
monitoringRouter.get('/live', async (_req, res) => {
  res.json(await liveView(res.locals.userId))
})

/**
 * A migração: dar uma linha na Central ao que já monitora.
 *
 * Projeção, não mudança — a fonte nasce pausada e aponta para o recorder que já existia.
 * Sem `apply=1`, a resposta é o plano.
 */
monitoringRouter.post('/migrate/recorders', async (req, res, next) => {
  try {
    res.json(await migrateRecordersToSources(res.locals.userId, { dryRun: String(req.query.apply ?? '') !== '1' }))
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

/** O reverso: apaga só as projeções intocadas. Recorder nenhum é tocado. */
monitoringRouter.post('/migrate/recorders/rollback', async (_req, res, next) => {
  try {
    res.json(await rollbackRecorderMigration(res.locals.userId))
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
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
      /**
       * A chave do conjunto que esta fonte alimenta — quando ela já foi materializada.
       *
       * É por ela que a aba Monitores sabe quais monitores observam esta fonte. Sem isso, a
       * tela teria de adivinhar por nome, que é o jeito de errar quando alguém renomeia.
       */
      datasetKey: f.destination.recorderId ? f.destination.recorderId.toString() : null,
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
 * O monitor de uma fonte — criado de verdade, no motor canônico.
 *
 * O wizard oferece isso no fim, e a promessa precisa ter registro atrás: dizer "um monitor
 * foi criado" sem criar nada é a mentira que só aparece quando a pessoa vai procurá-lo.
 */
monitoringRouter.post('/sources/:id/monitor', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  const b = req.body ?? {}
  try {
    const m = await createMonitorForSource(res.locals.userId, id, {
      name: String(b.name ?? ''),
      condition: b.condition,
      triggerMode: b.triggerMode,
      threshold: b.threshold ?? null,
      thresholdField: b.thresholdField ?? null,
      debounceMs: Number(b.debounceMs ?? 0),
      cooldownMs: Number(b.cooldownMs ?? 0),
      flowId: b.flowId ?? null,
    })
    res.status(201).json(m)
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

// --- os grants: quem alcança esta fonte ------------------------------------------------

monitoringRouter.get('/sources/:id/grants', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  res.json({ items: await listSourceGrants(res.locals.userId, id) })
})

monitoringRouter.put('/sources/:id/grants', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  const body = (req.body ?? {}) as { subjectType?: string; subjectId?: string; capabilities?: string[]; effect?: string }
  try {
    const g = await putSourceGrant(res.locals.userId, {
      sourceId: id,
      subjectType: (body.subjectType ?? 'agent') as 'agent',
      subjectId: String(body.subjectId ?? ''),
      capabilities: (body.capabilities ?? []) as ('read' | 'configure')[],
      ...(body.effect === 'deny' ? { effect: 'deny' as const } : {}),
    })
    res.json({ id: g._id.toString(), effect: g.effect, capabilities: g.capabilities })
  } catch (erro) {
    if (!recusa(res, erro)) res.status(400).json({ message: (erro as Error).message, error: (erro as Error).message })
  }
})

monitoringRouter.delete('/sources/:id/grants/:subjectType/:subjectId', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  const removido = await deleteSourceGrant(res.locals.userId, id, String(req.params.subjectType) as 'agent', String(req.params.subjectId))
  if (!removido) return notFound(res)
  res.status(204).end()
})

/**
 * "Este agente alcança esta fonte?" — a pergunta respondida pelo resolvedor canônico.
 *
 * Existe como rota porque a matriz de acesso do agente precisa mostrar a MESMA resposta
 * que a execução vai dar. Duas respostas para a mesma pergunta é como se descobre, tarde,
 * que a tela mentia.
 */
monitoringRouter.get('/sources/:id/access', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  const agentId = typeof req.query.agentId === 'string' ? oid(req.query.agentId) : null
  res.json(await resolveSourceAccess({ accountId: res.locals.userId, sourceId: id, agentId }))
})

monitoringRouter.delete('/sources/:id', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  if (!(await deleteSource(res.locals.userId, id))) return notFound(res)
  // O histórico que ela gravou continua: apagar a regra de coleta é diferente de apagar
  // o passado.
  res.status(204).end()
})
