import { Router } from 'express'
import { ObjectId } from 'mongodb'
import {
  ExtensionError,
  createPackage,
  getPackage,
  listPackagesOf,
  listVersions,
  publishPackageVersion,
  searchCatalog,
  transition,
} from '../extensions/packages.js'
import { applyUpdate, getInstallation, impactOf, install, listInstallations, previewUpdate, uninstall } from '../extensions/installs.js'
import { backfillPrivateApps, prepareToolForSharing } from '../extensions/backfill.js'
import { installTemplate } from '../extensions/templates.js'
import type { ExtensionKind, ExtensionStatus } from '../extensions/types.js'
import { ReviewError, isPlatformReviewer, listReviews, recordReview } from '../extensionRuntime/review.js'
import { notFound, oid } from './http.js'

// AS ROTAS de extensão — e o Marketplace atrás de flag que nega de verdade.
//
// `COMMUNITY_MARKETPLACE_ENABLED=0` fecha o catálogo e a instalação comunitária com 404.
// O que continua aberto é o que é da própria conta: criar pacote, publicar versão e ver
// as próprias criações não dependem de existir comunidade nenhuma.

export const extensionRouter = Router()

/**
 * O papel de REVISOR — resolvido aqui, da configuração do servidor.
 *
 * Nunca do corpo do pedido: aceitar `isReviewer: true` de quem chama seria deixar
 * qualquer pessoa aprovar o próprio pacote. O middleware sobrescreve o campo em toda
 * requisição, então nem um `res.locals` escrito antes sobrevive.
 */
extensionRouter.use((_req, res, next) => {
  res.locals.isReviewer = isPlatformReviewer(res.locals.userId)
  next()
})

const recusa = (res: Parameters<typeof notFound>[0], erro: unknown): boolean => {
  if (erro instanceof ReviewError) {
    res.status(erro.code === 'forbidden' ? 403 : erro.code === 'duplicate' ? 409 : 400).json({ code: erro.code, message: erro.message, error: erro.message })
    return true
  }
  if (erro instanceof ExtensionError) {
    const status =
      erro.code === 'not_found'
        ? 404
        : erro.code === 'forbidden'
          ? 403
          : erro.code === 'duplicate' || erro.code === 'immutable' || erro.code === 'conflict'
            ? 409
            : 400
    res.status(status).json({ code: erro.code, message: erro.message, error: erro.message })
    return true
  }
  return false
}

const comunidadeAberta = () => process.env.COMMUNITY_MARKETPLACE_ENABLED !== '0'

// --- as minhas criações -------------------------------------------------------------------

extensionRouter.get('/packages', async (_req, res) => {
  res.json({ items: await listPackagesOf(res.locals.userId) })
})

extensionRouter.post('/packages', async (req, res, next) => {
  try {
    const p = await createPackage(res.locals.userId, req.body ?? {})
    res.status(201).json({ id: p._id.toString(), slug: p.slug, status: p.status })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

extensionRouter.get('/packages/:id/versions', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  const pacote = await getPackage(res.locals.userId, id)
  if (!pacote) return notFound(res)
  // O manifesto inteiro não vai na listagem: ela é um índice, e ele pode ser grande.
  const items = (await listVersions(id)).map((v) => ({
    version: v.version,
    sha256: v.sha256,
    changelog: v.changelog,
    permissionManifest: v.permissionManifest,
    compatibility: v.compatibility,
    review: v.review,
    createdAt: v.createdAt,
  }))
  res.json({ package: { id: pacote._id.toString(), name: pacote.name, status: pacote.status, latestVersion: pacote.latestVersion }, items })
})

extensionRouter.post('/packages/:id/versions', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  try {
    const v = await publishPackageVersion(res.locals.userId, id, req.body ?? {})
    res.status(201).json({ version: v.version, sha256: v.sha256, immutable: v.immutable })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

/**
 * A transição de estado, pedida por quem tem direito a ela.
 *
 * O papel de revisor vem da PLATAFORMA, e não do corpo do pedido: aceitar
 * `isReviewer: true` do cliente seria deixar qualquer um aprovar o próprio pacote.
 */
extensionRouter.post('/packages/:id/status', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  const body = (req.body ?? {}) as { status?: string; reason?: string; notes?: string }
  try {
    const p = await transition(id, body.status as ExtensionStatus, {
      actorId: res.locals.userId,
      isReviewer: Boolean(res.locals.isReviewer),
      ...(body.reason ? { reason: body.reason } : {}),
      ...(body.status === 'approved' || body.status === 'changes_requested'
        ? {
            review: {
              decision: body.status === 'approved' ? ('approved' as const) : ('changes_requested' as const),
              reviewerId: res.locals.userId,
              notes: String(body.notes ?? '').slice(0, 2000),
            },
          }
        : {}),
    })
    res.json({ id: p._id.toString(), status: p.status, suspendedReason: p.suspendedReason ?? null })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

/**
 * "Preparar para compartilhar" uma ferramenta — pedido explícito do autor.
 *
 * Não existe varredura que empacote ferramentas sozinha: empacotar o trabalho de alguém
 * por conta própria é decidir por essa pessoa que ele é compartilhável.
 */
extensionRouter.post('/packages/from-tool/:toolId', async (req, res, next) => {
  const id = oid(String(req.params.toolId))
  if (!id) return notFound(res)
  try {
    const p = await prepareToolForSharing(res.locals.userId, id)
    res.status(201).json({ id: p._id.toString(), slug: p.slug, status: p.status })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

/**
 * O backfill dos Apps privados desta conta.
 *
 * `app_definitions` continua sendo a fonte: o pacote nasce privado e rascunho, e o App
 * continua resolvendo pelo caminho de sempre. Sem `apply=1` a resposta é o PLANO.
 */
extensionRouter.post('/backfill/apps', async (req, res, next) => {
  try {
    res.json(await backfillPrivateApps(res.locals.userId, { dryRun: String(req.query.apply ?? '') !== '1' }))
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

// --- a fila de revisão ---------------------------------------------------------------------------

/** O que está esperando revisão. Só quem revisa enxerga. */
extensionRouter.get('/review/queue', async (_req, res) => {
  if (!res.locals.isReviewer) return notFound(res)
  const { packagesCollection } = await import('../extensions/packages.js')
  const items = await packagesCollection.find({ status: { $in: ['submitted', 'in_review'] } }).sort({ updatedAt: 1 }).limit(50).toArray()
  res.json({
    items: items.map((p) => ({
      id: p._id.toString(),
      kind: p.kind,
      name: p.name,
      slug: p.slug,
      status: p.status,
      latestVersion: p.latestVersion,
      authorAccountId: p.authorAccountId,
      updatedAt: p.updatedAt,
    })),
  })
})

/**
 * Registrar uma decisão de revisão — imutável, presa ao HASH do que foi revisado.
 *
 * O hash vem do corpo porque é o revisor quem diz o que ele leu. Se ele apontar para
 * outro hash, a aprovação simplesmente não serve para publicar o código de verdade: o
 * portão procura pelo hash do que está sendo publicado.
 */
extensionRouter.post('/review/decisions', async (req, res, next) => {
  if (!res.locals.isReviewer) return notFound(res)
  const body = (req.body ?? {}) as { subjectType?: string; subjectId?: string; version?: string; sha256?: string; decision?: string; notes?: string }
  const id = oid(String(body.subjectId ?? ''))
  if (!id) return notFound(res)
  try {
    const r = await recordReview({
      subjectType: body.subjectType === 'tool' ? 'tool' : 'extension',
      subjectId: id,
      version: String(body.version ?? ''),
      sha256: String(body.sha256 ?? ''),
      decision: body.decision === 'approved' ? 'approved' : 'changes_requested',
      // Quem revisou é quem está autenticado — nunca um nome digitado no corpo.
      reviewerId: res.locals.userId,
      notes: body.notes ?? '',
    })
    res.status(201).json({ id: r._id.toString(), decision: r.decision, sha256: r.sha256, createdAt: r.createdAt })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

/** O histórico de revisão de um pacote — para o autor entender o que foi pedido. */
extensionRouter.get('/packages/:id/reviews', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  const pacote = await getPackage(res.locals.userId, id)
  // O autor vê as decisões sobre o pacote DELE; um revisor vê as de qualquer um.
  if (!pacote && !res.locals.isReviewer) return notFound(res)
  const items = await listReviews('extension', id)
  res.json({ items: items.map((r) => ({ decision: r.decision, version: r.version, sha256: r.sha256, notes: r.notes, createdAt: r.createdAt })) })
})

// --- o catálogo da comunidade ----------------------------------------------------------------

extensionRouter.get('/catalog', async (req, res) => {
  if (!comunidadeAberta()) return notFound(res)
  const items = await searchCatalog({
    ...(typeof req.query.term === 'string' ? { term: req.query.term } : {}),
    ...(typeof req.query.kind === 'string' ? { kind: req.query.kind as ExtensionKind } : {}),
    ...(typeof req.query.category === 'string' ? { category: req.query.category } : {}),
  })
  res.json({
    items: items.map((p) => ({
      id: p._id.toString(),
      kind: p.kind,
      slug: p.slug,
      name: p.name,
      summary: p.summary,
      categories: p.categories,
      latestVersion: p.latestVersion,
      // A procedência: de quem é isto. Nunca "oficial" por omissão.
      author: p.authorAccountId === 'platform' ? 'platform' : 'community',
      installs: p.installs,
      updatedAt: p.updatedAt,
    })),
  })
})

// --- os instalados ----------------------------------------------------------------------------

extensionRouter.get('/installed', async (_req, res) => {
  res.json({ items: await listInstallations(res.locals.userId) })
})

extensionRouter.post('/installed/:packageId', async (req, res, next) => {
  const id = oid(String(req.params.packageId))
  if (!id) return notFound(res)
  if (!comunidadeAberta()) return notFound(res)
  try {
    const i = await install(res.locals.userId, id, req.body ?? {})
    res.status(201).json({ packageId: i.packageId.toString(), version: i.version, status: i.status })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

/**
 * Instalar um TEMPLATE: registra a instalação e abre o projeto do Arquiteto.
 *
 * Nada é criado no escritório aqui. Prévia, diff, aplicação e rollback são os do
 * Arquiteto — e é lá que uma pessoa aprova antes de qualquer efeito.
 */
extensionRouter.post('/installed/:packageId/template', async (req, res, next) => {
  const id = oid(String(req.params.packageId))
  if (!id) return notFound(res)
  if (!comunidadeAberta()) return notFound(res)
  const body = (req.body ?? {}) as { version?: string }
  try {
    const r = await installTemplate(res.locals.userId, id, body.version ? { version: body.version } : {})
    res.status(201).json({
      packageId: r.installation.packageId.toString(),
      version: r.installation.version,
      // O endereço da prévia: é lá que a pessoa vê o que será criado e aprova.
      projectId: r.project._id.toString(),
      blueprintHash: r.blueprintHash,
    })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

extensionRouter.get('/installed/:packageId/update', async (req, res, next) => {
  const id = oid(String(req.params.packageId))
  if (!id) return notFound(res)
  try {
    // Prévia: diz o que muda, e não muda nada.
    res.json(await previewUpdate(res.locals.userId, id, typeof req.query.to === 'string' ? req.query.to : undefined))
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

extensionRouter.post('/installed/:packageId/update', async (req, res, next) => {
  const id = oid(String(req.params.packageId))
  if (!id) return notFound(res)
  const body = (req.body ?? {}) as { to?: string; approvePermissions?: boolean }
  try {
    const i = await applyUpdate(res.locals.userId, id, {
      ...(body.to ? { to: body.to } : {}),
      approvePermissions: Boolean(body.approvePermissions),
    })
    res.json({ packageId: i.packageId.toString(), version: i.version })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

/** O que a desinstalação vai encontrar — ANTES de ela acontecer. */
extensionRouter.get('/installed/:packageId/impact', async (req, res, next) => {
  const id = oid(String(req.params.packageId))
  if (!id) return notFound(res)
  try {
    const itens = await impactOf(res.locals.userId, id)
    res.json({
      items: itens.map((i) => ({ kind: i.ref.kind, id: i.ref.id, name: i.name, exists: i.exists, edited: i.edited, pending: i.ref.pending ?? null })),
    })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

extensionRouter.delete('/installed/:packageId', async (req, res) => {
  const id = oid(String(req.params.packageId))
  if (!id) return notFound(res)
  const i = await uninstall(res.locals.userId, id)
  if (!i) return notFound(res)
  // Pausada, não apagada: o histórico de execução aponta para esta instalação. E o que
  // foi desligado, preservado ou já não existia é dito — não adivinhado por quem lê.
  res.json({
    packageId: i.packageId.toString(),
    status: i.status,
    impact: { disabled: i.impact.disabled, kept: i.impact.kept, missing: i.impact.missing },
  })
})

extensionRouter.get('/installed/:packageId', async (req, res) => {
  const id = oid(String(req.params.packageId))
  if (!id) return notFound(res)
  const i = await getInstallation(res.locals.userId, new ObjectId(id))
  if (!i) return notFound(res)
  res.json(i)
})
