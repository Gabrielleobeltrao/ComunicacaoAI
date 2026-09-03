import { Router } from 'express'
import { ValidationError } from '../building.js'
import * as service from '../architect/service.js'
import * as repo from '../architect/repository.js'
import { ArchitectRefusal } from '../architect/service.js'
import { ApplyFailure } from '../architect/apply.js'
import { allowRate, withProjectLock } from '../architect/guard.js'
import * as L from '../architect/limits.js'
import { auditEntity } from './auditMiddleware.js'
import { runAssistantTurn, resolveUiContext, ASSISTANT_LIMITS } from '../architect/assistant.js'
import { loadOfficeInventory, summarizeInventory } from '../architect/inventory.js'
import { fail, notFound, oid } from './http.js'
import { recordAudit } from '../audit.js'
import { randomUUID } from 'node:crypto'

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
  /**
   * Cada falha do provedor com o status que ela É.
   *
   * Chave inválida e modelo inexistente são configuração DESTA conta — 400, e não 502:
   * um 502 diz "o outro lado falhou" e manda tentar de novo, que é exatamente o que não
   * resolve. Limite de taxa é 429, porque aí esperar resolve mesmo.
   */
  provider_key_invalid: 400,
  provider_model_unavailable: 400,
  provider_rejected_request: 400,
  provider_no_credit: 402,
  provider_rate_limited: 429,
  provider_timeout: 504,
  provider_unavailable: 502,
  not_editable: 409,
  no_blueprint: 404,
  too_many_messages: 400,
  too_many_projects: 400,
}

function refuse(res: Parameters<typeof fail>[0], error: unknown, next: Parameters<typeof fail>[2]): void {
  /**
   * Uma saga que falhou é um estado NORMAL do produto — existe rota para retomar.
   *
   * Sem este ramo ela caía no 500 padrão do Express, que devolve HTML: a tela ficava sem o
   * motivo e sem o id da operação, e "retomar" não tinha o que retomar.
   */
  if (error instanceof ApplyFailure) {
    res.status(502).json({ code: 'apply_failed', message: error.message, operationId: error.operationId })
    return
  }
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

/**
 * O ASSISTENTE GLOBAL — uma rodada que pode NÃO virar projeto.
 *
 * É a porta do chat flutuante. O modo decide o que acontece, e só `propose` cria projeto:
 * perguntar "qual o valor do dólar hoje?" não pode deixar um projeto no histórico da conta.
 *
 * O contexto da tela chega como REFERÊNCIA e é reconferido aqui: um id que vem do cliente é
 * um pedido, e aceitá-lo faria a resposta descrever o escritório de outra pessoa.
 */
architectRouter.post('/assistant/turn', async (req, res, next) => {
  const b = (req.body ?? {}) as { message?: unknown; uiContext?: unknown; classified?: unknown }
  const mensagem = String(b.message ?? '').trim()
  if (!mensagem) return void res.status(400).json({ code: 'invalid', message: 'escreva o que você quer' })
  if (mensagem.length > ASSISTANT_LIMITS.message) {
    return void res.status(400).json({ code: 'too_long', message: 'mensagem longa demais' })
  }

  // O MESMO limite de taxa das outras rodadas: uma conversa não pode virar um laço.
  if (!allowRate(res.locals.userId, 10, 60_000)) {
    return void res.status(429).json({ code: 'too_many_messages', message: 'muitas mensagens em pouco tempo; aguarde um instante' })
  }

  try {
    const r = await runAssistantTurn({
      ownerId: res.locals.userId,
      message: mensagem,
      uiContext: (b.uiContext ?? null) as never,
      ...(b.classified !== undefined ? { classified: b.classified } : {}),
    })
    /**
     * A rodada só é REGISTRADA quando ela cria alguma coisa.
     *
     * Responder e explicar não mudam nada, e uma linha de auditoria por pergunta feita
     * afogaria o histórico. Mas a proposta abre um projeto — e um projeto criado pelo chat
     * flutuante não pode ficar sem registro só porque não passou pela tela do Arquiteto.
     */
    if (r.projectId) {
      await recordAudit({
        ownerId: res.locals.userId,
        actorType: 'user',
        actorId: res.locals.userId,
        action: 'create',
        entityType: 'architect_project',
        entityId: r.projectId,
        entityLabel: null,
        floorId: null,
        result: 'success',
        requestId: typeof res.locals.requestId === 'string' ? res.locals.requestId : randomUUID(),
        metadata: { method: 'POST', statusCode: 200, via: 'assistant' },
      })
    }
    res.json(r)
  } catch (erro) {
    next(erro as Error)
  }
})

/** O contexto atual, resumido — o que a tela mostra sem perguntar nada ao modelo. */
architectRouter.get('/context', async (req, res, next) => {
  try {
    const contexto = await resolveUiContext(res.locals.userId, {
      pathname: String(req.query.pathname ?? ''),
      floorId: req.query.floorId ? String(req.query.floorId) : undefined,
      sectorId: req.query.sectorId ? String(req.query.sectorId) : undefined,
      agentId: req.query.agentId ? String(req.query.agentId) : undefined,
    })
    const resumo = summarizeInventory(await loadOfficeInventory(res.locals.userId))
    res.json({ context: contexto, inventory: resumo })
  } catch (erro) {
    next(erro as Error)
  }
})

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
  // Os links vêm JUNTO. Eles nasciam só na resposta de aplicar, e viviam na memória da
  // aba: recarregar a página de um projeto já aplicado deixava a pessoa sem nenhum
  // caminho para o que ela mesma acabou de criar.
  res.json({ ...service.projectDetail(projeto), links: await service.projectLinks(res.locals.userId, projeto) })
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

// Corrigir a proposta à mão. Não chama modelo nenhum — e por isso não paga pedágio.
architectRouter.patch('/projects/:id/blueprint', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const body = (req.body ?? {}) as { edits?: unknown }
    // O mesmo lock da conversa: uma edição e uma rodada do modelo em voo escrevem o
    // mesmo documento, e sem ele a última a gravar apagaria a outra.
    const projeto = await withProjectLock(id.toString(), () => service.editBlueprint(res.locals.userId, id, body.edits))
    auditEntity(res, { id: projeto._id.toString(), label: projeto.title })
    res.json(service.projectDetail(projeto))
  } catch (error) {
    refuse(res, error, next)
  }
})

// "O que entendi", corrigido à mão. Não chama modelo nenhum.
architectRouter.patch('/projects/:id/brief', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const body = (req.body ?? {}) as { patch?: unknown; undo?: boolean }
    const projeto = await withProjectLock(id.toString(), () =>
      body.undo === true ? service.undoBrief(res.locals.userId, id) : service.editBrief(res.locals.userId, id, body.patch),
    )
    auditEntity(res, { id: projeto._id.toString(), label: projeto.title })
    res.json(service.projectDetail(projeto))
  } catch (error) {
    refuse(res, error, next)
  }
})

// O que existe nesta conta, para a tela poder oferecer a escolha. Leitura pura.
architectRouter.get('/targets', async (_req, res) => {
  res.json(await service.architectTargets(res.locals.userId))
})

architectRouter.patch('/projects/:id/links', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const body = (req.body ?? {}) as { links?: unknown }
    const projeto = await service.setBlueprintLinks(res.locals.userId, id, body.links)
    auditEntity(res, { id: projeto._id.toString(), label: projeto.title })
    res.json(service.projectDetail(projeto))
  } catch (error) {
    refuse(res, error, next)
  }
})

architectRouter.patch('/projects/:id/layer', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const body = (req.body ?? {}) as { layer?: unknown }
    const projeto = await service.setProjectLayer(res.locals.userId, id, body.layer)
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
  res.json(
    mensagens.map((m) => ({
      id: m._id.toString(),
      role: m.role,
      content: m.content,
      // A tela precisa saber se aquele vermelho ainda vale.
      ...(m.failure ? { failure: true, resolved: Boolean(m.resolvedAt) } : {}),
      createdAt: m.createdAt,
    })),
  )
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

// A primeira rodada, sem mensagem nova: a descrição já está lá e precisa de resposta.
architectRouter.post('/projects/:id/turn', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    comRitmo(res.locals.userId)
    const body = (req.body ?? {}) as { forceProposal?: boolean }
    const r = await withProjectLock(id.toString(), () => service.advanceTurn(res.locals.userId, id, { forceProposal: body.forceProposal === true }))
    auditEntity(res, { id: r.project._id.toString(), label: r.project.title })
    res.json({ ...service.projectDetail(r.project), assistantText: r.assistantText, question: r.question })
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
    auditEntity(res, { id: r.project._id.toString(), label: r.project.title })
    res.json({ ...service.projectDetail(r.project), assistantText: r.assistantText, question: r.question })
  } catch (error) {
    refuse(res, error, next)
  }
})

architectRouter.post('/projects/:id/validate', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    auditEntity(res, { id: id.toString() })
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

architectRouter.delete('/projects/:id', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const apagado = await service.deleteProject(res.locals.userId, id)
    auditEntity(res, { id: apagado.id, label: apagado.title })
    res.status(204).end()
  } catch (error) {
    refuse(res, error, next)
  }
})

// --- aplicação ---------------------------------------------------------------------
// Estas quatro são as únicas rotas do Arquiteto que escrevem no escritório — e a
// primeira delas exige hash revisado, chave de operação e confirmação explícita.

architectRouter.post('/projects/:id/apply', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const body = (req.body ?? {}) as {
      blueprintHash?: string
      idempotencyKey?: string
      confirm?: boolean
      approvedAppKeys?: string[]
      approvedUpdateKeys?: string[]
      approvedActivationKeys?: string[]
      deliveryConnections?: { key?: unknown; connectionId?: unknown }[]
    }
    const r = await service.applyProject(res.locals.userId, id, {
      blueprintHash: String(body.blueprintHash ?? ''),
      idempotencyKey: String(body.idempotencyKey ?? ''),
      confirm: body.confirm === true,
      approvedAppKeys: Array.isArray(body.approvedAppKeys) ? body.approvedAppKeys.map(String).slice(0, 20) : [],
      // O que a tela marcou. Conferido de novo na saga: o checkbox decide o que é
      // enviado, o servidor decide o que é feito.
      approvedUpdateKeys: Array.isArray(body.approvedUpdateKeys) ? body.approvedUpdateKeys.map(String).slice(0, 60) : [],
      // Entrar no ar é outra autorização. Sem ela, o recurso é criado e fica parado —
      // aplicar uma proposta nunca coloca a operação para rodar sozinha no mesmo instante.
      approvedActivationKeys: Array.isArray(body.approvedActivationKeys) ? body.approvedActivationKeys.map(String).slice(0, 60) : [],
      // A conexão de cada entrega. O id vem do cliente e é conferido contra o dono na saga:
      // aceitá-lo sem conferir faria a entrega sair pela conexão de outra pessoa.
      deliveryConnections: Array.isArray(body.deliveryConnections)
        ? body.deliveryConnections.slice(0, 20).map((d) => ({ key: String(d?.key ?? ''), connectionId: String(d?.connectionId ?? '') }))
        : [],
    })
    auditEntity(res, { id: r.project._id.toString(), label: r.project.title })
    res.json({ ...service.projectDetail(r.project), operation: r.operation, links: r.links })
  } catch (error) {
    refuse(res, error, next)
  }
})

architectRouter.post('/projects/:id/resume', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const r = await service.resumeProject(res.locals.userId, id)
    auditEntity(res, { id: r.project._id.toString(), label: r.project.title })
    res.json({ ...service.projectDetail(r.project), operation: r.operation, links: r.links })
  } catch (error) {
    refuse(res, error, next)
  }
})

architectRouter.post('/projects/:id/recheck', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const r = await service.recheckProjectState(res.locals.userId, id)
    res.json({ ...service.projectDetail(r.project), links: r.links })
  } catch (error) {
    refuse(res, error, next)
  }
})

architectRouter.post('/projects/:id/rollback', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const r = await service.rollbackProject(res.locals.userId, id)
    auditEntity(res, { id: r.project._id.toString(), label: r.project.title })
    res.json({ ...service.projectDetail(r.project), removed: r.removed, kept: r.kept })
  } catch (error) {
    refuse(res, error, next)
  }
})
