import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { adapterFor, availableKinds } from '../resources/registry.js'
import { listResources } from '../resources/catalog.js'
import { resolveAgentResourceAccess, resolveResourceAccess } from '../resources/access.js'
import { parseSubject, resolveSubject } from '../resources/scope.js'
import { isResourceKind } from '../resources/types.js'
import type { ResourceKind } from '../resources/types.js'
import { notFound, oid } from './http.js'

// AS ROTAS DE LEITURA do catálogo comum.
//
// Só leitura, de propósito. Criar, editar e apagar continuam nas rotas canônicas de cada
// tipo, que é onde moram as validações que aquele tipo entende. Uma rota genérica de
// mutação teria que reimplementar todas elas — e a reimplementação é sempre a que erra.

export const resourceRouter = Router()

const platformEnabled = () => process.env.RESOURCE_PLATFORM_ENABLED !== '0'

/**
 * A flag NEGA de verdade, e não só esconde a tela.
 *
 * Uma flag que só some com o botão deixa a rota aberta para quem souber o caminho — que
 * é exatamente quem não deveria entrar.
 */
resourceRouter.use((_req, res, next) => {
  if (!platformEnabled()) {
    res.status(404).json({ code: 'not_found', message: 'not found' })
    return
  }
  next()
})

resourceRouter.get('/', async (req, res) => {
  const kinds = String(req.query.kind ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(isResourceKind)

  const subject = req.query.scopeType ? parseSubject(req.query.scopeType, req.query.scopeId) : null
  if (req.query.scopeType && !subject) return notFound(res)
  /**
   * O escopo é RESOLVIDO aqui, e não deixado para os adapters.
   *
   * Sem isto, um `scopeId` de outra conta devolveria 200 com lista vazia — o mesmo que
   * um escopo vazio desta conta. Parece inofensivo e não é: a diferença entre "não é seu"
   * e "está vazio" é o que um inventário de contas alheias precisa. A recusa é a mesma
   * de um id que não existe.
   */
  if (subject && !(await resolveSubject(res.locals.userId, subject))) return notFound(res)

  const r = await listResources({
    accountId: res.locals.userId,
    kinds: kinds.length ? kinds : null,
    subject,
    access: req.query.access === 'available' ? 'available' : 'owned',
    search: typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : null,
    limit: Number(req.query.limit) || 100,
    skip: Number(req.query.skip) || 0,
  })
  res.json({ items: r.items, byKind: r.byKind, kinds: availableKinds() })
})

resourceRouter.get('/:kind/:resourceId', async (req, res) => {
  const kind = String(req.params.kind)
  if (!isResourceKind(kind)) return notFound(res)
  const adapter = adapterFor(kind)
  if (!adapter) return notFound(res)
  const detalhe = await adapter.get(res.locals.userId, String(req.params.resourceId))
  if (!detalhe) return notFound(res)
  res.json(detalhe)
})

/**
 * "Este agente consegue usar isto?" — respondida pelo servidor, com o motivo.
 *
 * O `agentId` vem por query e é conferido contra a conta: perguntar com um id alheio
 * devolveria a política daquele agente, que já é vazamento mesmo sem executar nada.
 */
resourceRouter.get('/:kind/:resourceId/access', async (req, res) => {
  const kind = String(req.params.kind)
  if (!isResourceKind(kind)) return notFound(res)
  const agentId = req.query.agentId ? oid(String(req.query.agentId)) : null
  if (req.query.agentId && !agentId) return notFound(res)

  const decisao = await resolveResourceAccess({
    accountId: res.locals.userId,
    kind: kind as ResourceKind,
    resourceId: String(req.params.resourceId),
    actorAgentId: agentId,
    requestedCapability: typeof req.query.capability === 'string' ? req.query.capability : null,
  })
  res.json(decisao)
})

resourceRouter.get('/:kind/:resourceId/impact', async (req, res) => {
  const kind = String(req.params.kind)
  if (!isResourceKind(kind)) return notFound(res)
  const adapter = adapterFor(kind)
  if (!adapter) return notFound(res)
  const impacto = await adapter.impact(res.locals.userId, String(req.params.resourceId))
  if (!impacto) return notFound(res)
  res.json(impacto)
})

/** A matriz do agente: tudo o que existe, com a decisão de cada um — inclusive as negativas. */
export const agentResourceAccessRouter = Router({ mergeParams: true })

agentResourceAccessRouter.get('/resource-access', async (req, res) => {
  if (!platformEnabled()) return notFound(res)
  const agentId = oid(String((req.params as Record<string, string>).agentId))
  if (!agentId) return notFound(res)
  const linhas = await resolveAgentResourceAccess(res.locals.userId, agentId as ObjectId)
  res.json({
    items: linhas.map((l) => ({
      kind: l.kind,
      resourceId: l.resourceId,
      name: l.name,
      allowed: l.decision.allowed,
      capabilities: l.decision.capabilities,
      origin: l.decision.origin,
      reason: l.decision.reason,
      pending: l.decision.pending ?? null,
    })),
  })
})
