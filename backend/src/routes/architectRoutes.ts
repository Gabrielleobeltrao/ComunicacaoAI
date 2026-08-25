import { Router } from 'express'
import { ValidationError } from '../building.js'
import * as service from '../architect/service.js'
import * as repo from '../architect/repository.js'
import { ArchitectRefusal } from '../architect/service.js'
import { allowRate, withProjectLock } from '../architect/guard.js'
import * as L from '../architect/limits.js'
import { auditEntity } from './auditMiddleware.js'
import { fail, notFound, oid } from './http.js'

// “Montar operação”, do lado da API.
//
// Nenhuma rota aqui cria recurso por conta própria: a conversa produz uma PROPOSTA, e
// só `apply` — com hash e confirmação — escreve alguma coisa no escritório.

export const architectRouter = Router()

/** Um código estável por recusa, para a tela poder reagir a cada caso. */
const refusalStatus: Record<string, number> = {
  no_provider_key: 400,
  budget_exceeded: 429,
  unreadable_response: 502,
  provider_error: 502,
  not_editable: 409,
  no_blueprint: 404,
  too_many_messages: 400,
  too_many_projects: 400,
}

function refuse(res: Parameters<typeof fail>[0], error: unknown, next: Parameters<typeof fail>[2]): void {
  if (error instanceof ArchitectRefusal) {
    if (error.code === 'no_blueprint' && error.message === 'projeto não encontrado') return notFound(res)
    res.status(refusalStatus[error.code] ?? 400).json({ code: error.code, message: error.message })
    return
  }
  fail(res, error, next)
}

/** As rotas que chamam o modelo pagam pedágio: dez por minuto, por conta. */
const comRitmo = (ownerId: string): void => {
  if (!allowRate(ownerId, 10, 60_000)) throw new ArchitectRefusal('too_many_messages', 'muitas mensagens em pouco tempo; aguarde um instante')
}

architectRouter.post('/projects', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { objective?: string; title?: string; provider?: 'anthropic' | 'openai'; model?: string | null }
    const projeto = await service.createProject(res.locals.userId, {
      objective: String(body.objective ?? ''),
      title: body.title,
      provider: body.provider,
      model: body.model ?? null,
    })
    auditEntity(res, { id: projeto._id.toString(), label: projeto.title })
    res.status(201).json(service.projectDetail(projeto))
  } catch (error) {
    refuse(res, error, next)
  }
})

architectRouter.get('/projects', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50)
  const skip = Math.max(Number(req.query.skip) || 0, 0)
  const lista = await repo.listProjects(res.locals.userId, { includeArchived: String(req.query.includeArchived) === 'true', limit, skip })
  res.json(lista.map(service.projectSummary))
})

architectRouter.get('/projects/:id', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const projeto = await repo.getProject(res.locals.userId, id)
  if (!projeto) return notFound(res)
  res.json(service.projectDetail(projeto))
})

architectRouter.patch('/projects/:id', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const body = (req.body ?? {}) as { title?: string; provider?: 'anthropic' | 'openai'; model?: string | null; answers?: Record<string, unknown> }
    const projeto = await service.patchProjectFields(res.locals.userId, id, body)
    auditEntity(res, { id: projeto._id.toString(), label: projeto.title })
    res.json(service.projectDetail(projeto))
  } catch (error) {
    refuse(res, error, next)
  }
})

architectRouter.get('/projects/:id/messages', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const projeto = await repo.getProject(res.locals.userId, id)
  if (!projeto) return notFound(res)
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), L.MAX_MESSAGES_PER_PROJECT)
  const skip = Math.max(Number(req.query.skip) || 0, 0)
  const mensagens = await repo.listMessages(res.locals.userId, id, { limit, skip })
  res.json(mensagens.map((m) => ({ id: m._id.toString(), role: m.role, content: m.content, createdAt: m.createdAt })))
})

architectRouter.post('/projects/:id/messages', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    comRitmo(res.locals.userId)
    const body = (req.body ?? {}) as { content?: string; forceProposal?: boolean }
    const r = await withProjectLock(id.toString(), () =>
      service.sendMessage(res.locals.userId, id, String(body.content ?? ''), { forceProposal: body.forceProposal === true }),
    )
    res.json({ ...service.projectDetail(r.project), assistantText: r.assistantText, question: r.question, secretMasked: r.secretMasked })
  } catch (error) {
    refuse(res, error, next)
  }
})

architectRouter.post('/projects/:id/generate', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    comRitmo(res.locals.userId)
    const r = await withProjectLock(id.toString(), () => service.generateBlueprint(res.locals.userId, id))
    res.json({ ...service.projectDetail(r.project), assistantText: r.assistantText, question: r.question })
  } catch (error) {
    refuse(res, error, next)
  }
})

architectRouter.post('/projects/:id/validate', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    res.json(await service.validateProject(res.locals.userId, id))
  } catch (error) {
    refuse(res, error, next)
  }
})

architectRouter.get('/projects/:id/preview', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    res.json(await service.previewProject(res.locals.userId, id))
  } catch (error) {
    refuse(res, error, next)
  }
})

architectRouter.patch('/projects/:id/checklist/:itemId', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const body = (req.body ?? {}) as { done?: boolean }
    if (typeof body.done !== 'boolean') throw new ValidationError('informe se o item foi concluído')
    const projeto = await service.markChecklistItem(res.locals.userId, id, String(req.params.itemId), body.done)
    res.json(service.projectDetail(projeto))
  } catch (error) {
    refuse(res, error, next)
  }
})

architectRouter.post('/projects/:id/archive', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const projeto = await service.archiveProject(res.locals.userId, id)
    auditEntity(res, { id: projeto._id.toString(), label: projeto.title })
    res.json(service.projectDetail(projeto))
  } catch (error) {
    refuse(res, error, next)
  }
})
