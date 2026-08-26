import { ObjectId } from 'mongodb'
import { ValidationError } from '../building.js'
import { maskSecrets, containsSecret } from './secrets.js'
import { mergeBlueprintPatch, computeBlueprintHash } from './blueprint.js'
import { buildArchitectPrompt } from './prompt.js'
import { runArchitectTurn } from './turn.js'
import { loadAppsForPrompt, loadOwnershipContext } from './context.js'
import { applyBlueprintLinks, loadTargets } from './links.js'
import { buildPreview } from './preview.js'
import { deriveChecklist, applyChecklistState, computeReadiness } from './checklist.js'
import { validateOfficeBlueprint } from './validate.js'
import { isEditable, RESUME_FROM } from './state.js'
import { getProviderKeyStatus } from '../userSettings.js'
import { applyBlueprint, resumeApply, rollbackOperation, ApplyConflict, ApplyFailure } from './apply.js'
import type { ApplyHooks } from './apply.js'
import { recheckProject, appliedLinks } from './recheck.js'
import * as repo from './repository.js'
import * as L from './limits.js'
import type { ArchitectProject } from './repository.js'
import type { ArchitectAssumption, OfficeBlueprintV1 } from './types.js'
import type { TurnFailure } from './turn.js'

// O que as rotas chamam. Toda função aqui recebe `ownerId` e o repassa a TODA consulta;
// não existe atalho que leia um projeto por id sozinho.

/** Quantas mensagens do fim da conversa entram no prompt. */
const CONTEXTO = 12

export class ArchitectRefusal extends Error {
  constructor(
    readonly code: TurnFailure['code'] | 'not_editable' | 'no_blueprint' | 'too_many_messages' | 'too_many_projects',
    message: string,
  ) {
    super(message)
  }
}

const requireProject = async (ownerId: string, id: ObjectId): Promise<ArchitectProject> => {
  const p = await repo.getProject(ownerId, id)
  // O de outra conta e o inexistente são o MESMO caso para quem chama.
  if (!p) throw new ArchitectRefusal('no_blueprint', 'projeto não encontrado')
  return p
}

/** O primeiro provedor com chave nesta conta; Anthropic quando nenhum tem. */
async function primeiroProvedorConfigurado(ownerId: string): Promise<'anthropic' | 'openai'> {
  const status = await getProviderKeyStatus(ownerId)
  if (status.anthropic) return 'anthropic'
  if (status.openai) return 'openai'
  return 'anthropic'
}

export async function createProject(ownerId: string, input: { objective: string; title?: string; provider?: 'anthropic' | 'openai'; model?: string | null }): Promise<ArchitectProject> {
  const objetivo = String(input.objective ?? '').trim()
  if (!objetivo) throw new ValidationError('descreva o que você quer que a operação faça')
  if ((await repo.countProjects(ownerId)) >= L.MAX_PROJECTS_PER_OWNER) {
    throw new ArchitectRefusal('too_many_projects', `você já tem ${L.MAX_PROJECTS_PER_OWNER} projetos; arquive um para começar outro`)
  }
  const titulo = String(input.title ?? '').trim() || objetivo.slice(0, 60)
  // Sem escolha explícita, vale o que a conta TEM. Fixar Anthropic fazia o projeto
  // nascer apontando para um provedor sem chave numa conta que só configurou OpenAI —
  // e a primeira mensagem falhava pedindo para configurar o que já estava configurado.
  const provider = input.provider ?? (await primeiroProvedorConfigurado(ownerId))
  const projeto = await repo.createProject(ownerId, { title: titulo, objective: objetivo, provider, model: input.model ?? null })
  // A primeira mensagem é a própria descrição: a conversa começa de onde a pessoa parou.
  await repo.appendMessage(ownerId, projeto._id, 'user', objetivo)
  return projeto
}

/**
 * Uma rodada de conversa.
 *
 * A mensagem é gravada ANTES da chamada. Se o provedor falhar, o que a pessoa escreveu
 * não some — e a chave de cobrança sai do id dessa mensagem, então repetir a rodada
 * depois de um erro de rede não cobra duas vezes.
 */
export async function sendMessage(
  ownerId: string,
  projectId: ObjectId,
  content: string,
  opts: { forceProposal?: boolean } = {},
): Promise<{ project: ArchitectProject; assistantText: string; question: unknown; secretMasked: boolean }> {
  const projeto = await requireProject(ownerId, projectId)
  if (!isEditable(projeto.status)) throw new ArchitectRefusal('not_editable', 'este projeto já foi aplicado ou arquivado')

  const texto = String(content ?? '').trim()
  if (!texto) throw new ValidationError('escreva alguma coisa')
  if ((await repo.countMessages(ownerId, projectId)) >= L.MAX_MESSAGES_PER_PROJECT) {
    throw new ArchitectRefusal('too_many_messages', 'esta conversa chegou ao limite; gere a proposta ou comece um projeto novo')
  }

  const tinhaSegredo = containsSecret(texto)
  const mensagem = await repo.appendMessage(ownerId, projectId, 'user', texto)
  if (tinhaSegredo) {
    await repo.appendMessage(ownerId, projectId, 'system_notice', 'Removi o que parecia uma credencial da sua mensagem. Credenciais se configuram na página do App, nunca na conversa.')
  }

  return runTurn(ownerId, projeto, `architect:${projectId.toString()}:${mensagem._id.toString()}`, {
    forceProposal: opts.forceProposal,
    secretMasked: tinhaSegredo,
    // A mensagem responde à pergunta que estava no ar. É isto que faz a mesma pergunta
    // não voltar na rodada seguinte.
    answeringPending: mensagem.content,
  })
}

/**
 * Roda uma rodada SEM mensagem nova.
 *
 * Dois usos: gerar a proposta agora (`forceProposal`) e — o que faltava — dar o
 * primeiro passo da conversa. A descrição já entrou como primeira mensagem quando o
 * projeto foi criado; sem esta chamada, ninguém respondia a ela, e a tela abria com o
 * que a pessoa escreveu e um silêncio.
 */
export async function advanceTurn(
  ownerId: string,
  projectId: ObjectId,
  opts: { forceProposal?: boolean } = {},
): Promise<{ project: ArchitectProject; assistantText: string; question: unknown; secretMasked: boolean }> {
  const projeto = await requireProject(ownerId, projectId)
  if (!isEditable(projeto.status)) throw new ArchitectRefusal('not_editable', 'este projeto já foi aplicado ou arquivado')
  // A chave de cobrança sai da última mensagem: a mesma rodada, repetida por um erro
  // de rede, não cobra duas vezes.
  const ultima = (await repo.recentMessages(ownerId, projectId, 1))[0]
  const marca = ultima ? ultima._id.toString() : new ObjectId().toString()
  return runTurn(ownerId, projeto, `architect:${projectId.toString()}:turn:${opts.forceProposal ? 'gen:' : ''}${marca}`, {
    forceProposal: opts.forceProposal === true,
    secretMasked: false,
  })
}

export const generateBlueprint = (ownerId: string, projectId: ObjectId) => advanceTurn(ownerId, projectId, { forceProposal: true })

async function runTurn(
  ownerId: string,
  projeto: ArchitectProject,
  chargeKey: string,
  opts: { forceProposal?: boolean; secretMasked: boolean; answeringPending?: string },
): Promise<{ project: ArchitectProject; assistantText: string; question: unknown; secretMasked: boolean }> {
  const [messages, apps] = await Promise.all([repo.recentMessages(ownerId, projeto._id, CONTEXTO), loadAppsForPrompt(ownerId)])

  const respondidas = { ...projeto.answers }
  if (projeto.pendingQuestion && opts.answeringPending?.trim()) {
    respondidas[projeto.pendingQuestion.key] = opts.answeringPending.trim()
  }

  const resultado = await runArchitectTurn({
    ownerId,
    provider: projeto.provider,
    model: projeto.model,
    prompt: buildArchitectPrompt({ project: { ...projeto, answers: respondidas }, messages, apps, forceProposal: opts.forceProposal }),
    chargeKey,
  })

  if (!resultado.ok) {
    // Fica registrado NA CONVERSA: uma falha invisível vira "o sistema não respondeu".
    await repo.appendMessage(ownerId, projeto._id, 'system_notice', resultado.failure.message)
    throw new ArchitectRefusal(resultado.failure.code, resultado.failure.message)
  }

  const turno = resultado.result
  await repo.appendMessage(ownerId, projeto._id, 'assistant', turno.assistantText)

  // As respostas acumulam; o patch do modelo não pode apagar o que já foi respondido.
  const answers = { ...respondidas }
  for (const [k, v] of Object.entries(turno.answerPatch)) answers[k] = v

  const blueprint = turno.blueprintPatch
    ? mergeBlueprintPatch(projeto.blueprint, turno.blueprintPatch as Partial<OfficeBlueprintV1>, { title: projeto.title, objective: projeto.objective })
    : projeto.blueprint

  const assumptions = mesclarSuposicoes(projeto.assumptions, turno.assumptions, answers)
  const patch: Partial<ArchitectProject> = {
    answers,
    pendingQuestion: turno.question ? { key: turno.question.key, text: turno.question.text } : null,
    assumptions,
    blueprint,
    blueprintHash: blueprint ? computeBlueprintHash(blueprint) : null,
    // Proposta na mesa é `draft`; a validação é que promove para `ready`.
    status: blueprint ? 'draft' : 'discovery',
  }
  if (blueprint) {
    const checklist = applyChecklistState(deriveChecklist(blueprint), new Set(), marcadosDe(projeto))
    patch.checklist = checklist
    patch.readiness = computeReadiness(checklist, [])
  }
  const atualizado = (await repo.patchProject(ownerId, projeto._id, patch)) ?? projeto

  return { project: atualizado, assistantText: turno.assistantText, question: turno.question, secretMasked: opts.secretMasked }
}

/** Uma suposição some quando a pergunta que ela cobria foi respondida. */
function mesclarSuposicoes(anteriores: ArchitectAssumption[], novas: ArchitectAssumption[], answers: Record<string, unknown>): ArchitectAssumption[] {
  const porChave = new Map<string, ArchitectAssumption>()
  for (const a of [...anteriores, ...novas]) {
    if (a.questionKey && answers[a.questionKey] !== undefined) continue
    porChave.set(a.key, a)
  }
  return [...porChave.values()].slice(0, L.MAX_ASSUMPTIONS)
}

const marcadosDe = (projeto: ArchitectProject): Set<string> =>
  new Set((projeto.checklist ?? []).filter((i) => i.completionMode === 'manual' && i.status === 'done').map((i) => i.id))

/** Valida sem escrever recurso nenhum. Válido promove o projeto para `ready`. */
export async function validateProject(ownerId: string, projectId: ObjectId) {
  const projeto = await requireProject(ownerId, projectId)
  if (!projeto.blueprint) throw new ArchitectRefusal('no_blueprint', 'ainda não existe proposta para validar')
  const ctx = await loadOwnershipContext(ownerId)
  const r = validateOfficeBlueprint(projeto.blueprint, ctx)
  if (isEditable(projeto.status)) {
    await repo.patchProject(ownerId, projectId, { status: r.valid ? 'ready' : 'draft' })
  }
  return r
}

export async function previewProject(ownerId: string, projectId: ObjectId) {
  const projeto = await requireProject(ownerId, projectId)
  if (!projeto.blueprint) throw new ArchitectRefusal('no_blueprint', 'ainda não existe proposta para revisar')
  const ctx = await loadOwnershipContext(ownerId)
  return buildPreview(projeto.blueprint, ctx, marcadosDe(projeto))
}

/** Editar uma resposta anterior. Regerar a proposta é um passo separado e explícito. */
export async function patchProjectFields(
  ownerId: string,
  projectId: ObjectId,
  patch: { title?: string; provider?: 'anthropic' | 'openai'; model?: string | null; answers?: Record<string, unknown> },
): Promise<ArchitectProject> {
  const projeto = await requireProject(ownerId, projectId)
  if (!isEditable(projeto.status)) throw new ArchitectRefusal('not_editable', 'este projeto já foi aplicado ou arquivado')
  const set: Partial<ArchitectProject> = {}
  if (patch.title !== undefined) {
    const t = String(patch.title).trim()
    if (!t) throw new ValidationError('o título não pode ficar vazio')
    set.title = t.slice(0, L.MAX_TITLE_CHARS)
  }
  if (patch.provider !== undefined) {
    if (patch.provider !== 'anthropic' && patch.provider !== 'openai') throw new ValidationError('provedor desconhecido')
    set.provider = patch.provider
  }
  if (patch.model !== undefined) set.model = patch.model ? String(patch.model).slice(0, 120) : null
  if (patch.answers !== undefined) {
    if (typeof patch.answers !== 'object' || patch.answers === null || Array.isArray(patch.answers)) throw new ValidationError('respostas inválidas')
    const answers = { ...projeto.answers }
    for (const [k, v] of Object.entries(patch.answers).slice(0, L.MAX_ANSWERS)) {
      // Uma resposta também é texto do usuário: mascarar aqui, como na conversa.
      answers[k.slice(0, L.MAX_KEY_CHARS)] = typeof v === 'string' ? maskSecrets(v).slice(0, L.MAX_ANSWER_CHARS) : v
    }
    set.answers = answers
  }
  return (await repo.patchProject(ownerId, projectId, set)) ?? projeto
}

export async function markChecklistItem(ownerId: string, projectId: ObjectId, itemId: string, done: boolean) {
  const projeto = await requireProject(ownerId, projectId)
  const item = (projeto.checklist ?? []).find((i) => i.id === itemId)
  if (!item) throw new ArchitectRefusal('no_blueprint', 'item não encontrado')
  // Só o manual. Um item calculado marcado à mão diria "pronto" sobre o que ninguém fez.
  if (item.completionMode !== 'manual') throw new ValidationError('este item é conferido pelo sistema e não pode ser marcado à mão')

  const marcados = marcadosDe(projeto)
  if (done) marcados.add(itemId)
  else marcados.delete(itemId)

  const concluidos = new Set((projeto.checklist ?? []).filter((i) => i.completionMode !== 'manual' && i.status === 'done').map((i) => i.id))
  const checklist = applyChecklistState(projeto.checklist ?? [], concluidos, marcados)
  const readiness = computeReadiness(checklist, projeto.readiness?.blockers ?? [])
  return (await repo.patchProject(ownerId, projectId, { checklist, readiness })) ?? projeto
}

export async function archiveProject(ownerId: string, projectId: ObjectId): Promise<ArchitectProject> {
  const projeto = await requireProject(ownerId, projectId)
  // Arquivar não apaga NADA do que já foi criado: o andar, os agentes e os setores
  // continuam de pé, editáveis pelas telas normais.
  const atualizado = await repo.transitionProject(ownerId, projectId, ['discovery', 'draft', 'ready', 'applied', 'failed'], 'archived')
  if (!atualizado) throw new ArchitectRefusal('not_editable', 'não dá para arquivar um projeto que está sendo aplicado')
  return atualizado
}

/**
 * Apagar a CONVERSA — e só ela.
 *
 * O que o projeto criou não é dele: o andar, os agentes e os setores são do escritório
 * desde o momento em que foram aplicados, e continuam de pé. Apagar aqui remove a
 * conversa, as mensagens e o histórico de aplicação — nada mais. Quem quer desfazer o
 * que foi criado usa `rollback`, que é outra decisão e tem outra tela.
 *
 * Enquanto uma aplicação está correndo, não: a operação em andamento escreve no
 * escritório, e sumir com o registro dela no meio deixaria trabalho órfão sem ninguém
 * para retomar. É a mesma recusa de `archiveProject`.
 */
export async function deleteProject(ownerId: string, projectId: ObjectId): Promise<{ id: string; title: string }> {
  const projeto = await requireProject(ownerId, projectId)
  if (projeto.status === 'applying') throw new ArchitectRefusal('not_editable', 'não dá para apagar um projeto que está sendo aplicado')
  await repo.deleteProjectData(ownerId, projectId)
  return { id: projeto._id.toString(), title: projeto.title }
}

/** O DTO. A conversa, o prompt e o blueprint inteiro não saem em listagem. */
export const projectSummary = (p: ArchitectProject) => ({
  id: p._id.toString(),
  title: p.title,
  objective: p.objective,
  status: p.status,
  locale: p.locale,
  readiness: p.readiness,
  hasBlueprint: Boolean(p.blueprint),
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  appliedAt: p.appliedAt,
})

export const projectDetail = (p: ArchitectProject) => ({
  ...projectSummary(p),
  provider: p.provider,
  model: p.model,
  answers: p.answers,
  pendingQuestion: p.pendingQuestion ?? null,
  assumptions: p.assumptions,
  blueprint: p.blueprint,
  blueprintHash: p.blueprintHash,
  checklist: p.checklist,
  applyState: p.applyState,
})

// --- aplicação -------------------------------------------------------------------------

/**
 * Aplica — e é o ÚNICO caminho que escreve no escritório.
 *
 * O lock é uma troca de estado atômica no Mongo: `ready → applying` só acontece uma
 * vez, então dois cliques simultâneos produzem uma aplicação e uma recusa, não duas
 * aplicações. Não é um `findOne` seguido de `update`, que perderia a corrida.
 */
export async function applyProject(
  ownerId: string,
  projectId: ObjectId,
  input: { blueprintHash: string; idempotencyKey: string; confirm: boolean; approvedAppKeys?: string[]; approvedUpdateKeys?: string[] },
  hooks: ApplyHooks = {},
) {
  const projeto = await requireProject(ownerId, projectId)
  if (!input.confirm) throw new ValidationError('a aplicação precisa da sua confirmação')
  if (!input.blueprintHash) throw new ValidationError('informe qual proposta você revisou')
  if (!input.idempotencyKey) throw new ValidationError('faltou a chave da operação')

  // Já aplicado com a MESMA chave: devolve o resultado anterior em vez de recusar. É o
  // caso do clique duplicado e do "tentar de novo" depois de a resposta se perder.
  if (projeto.status === 'applied') {
    const anterior = await repo.lastOperation(ownerId, projectId)
    if (anterior?.idempotencyKey === input.idempotencyKey) return finalizarAplicacao(ownerId, projectId, anterior)
    throw new ArchitectRefusal('not_editable', 'este projeto já foi aplicado')
  }

  const travado = await repo.transitionProject(ownerId, projectId, ['ready'], 'applying')
  if (!travado) {
    throw new ArchitectRefusal('not_editable', projeto.status === 'applying' ? 'esta proposta já está sendo aplicada' : 'valide a proposta antes de aplicar')
  }

  try {
    const operacao = await applyBlueprint(ownerId, travado, input, hooks)
    return finalizarAplicacao(ownerId, projectId, operacao)
  } catch (error) {
    // O id REAL da operação, inclusive aqui: é por ele que "retomar" sabe o que
    // retomar. Uma string vazia deixava a falha sem caminho de volta.
    await repo.patchProject(ownerId, projectId, {
      status: 'failed',
      applyState: {
        operationId: error instanceof ApplyFailure ? error.operationId : ((await repo.lastOperation(ownerId, projectId))?._id.toString() ?? ''),
        status: 'failed',
        blueprintHash: input.blueprintHash,
        startedAt: new Date(),
        completedAt: new Date(),
        error: error instanceof Error ? error.message : 'falha',
      },
    })
    if (error instanceof ApplyConflict) throw new ArchitectRefusal('not_editable', error.message)
    throw error
  }
}

/** Liga itens da proposta a recursos reais desta conta. O id nunca vem do modelo. */
export async function setBlueprintLinks(ownerId: string, projectId: ObjectId, links: unknown): Promise<ArchitectProject> {
  const projeto = await requireProject(ownerId, projectId)
  if (!isEditable(projeto.status)) throw new ArchitectRefusal('not_editable', 'este projeto já foi aplicado ou arquivado')
  if (!projeto.blueprint) throw new ArchitectRefusal('no_blueprint', 'ainda não existe proposta para ligar')
  const blueprint = await applyBlueprintLinks(ownerId, projeto.blueprint, links)
  const checklist = applyChecklistState(deriveChecklist(blueprint), new Set(), marcadosDe(projeto))
  return (
    (await repo.patchProject(ownerId, projectId, {
      blueprint,
      blueprintHash: computeBlueprintHash(blueprint),
      checklist,
      readiness: computeReadiness(checklist, []),
      // Uma ligação nova precisa ser validada de novo antes de aplicar.
      status: 'draft',
    })) ?? projeto
  )
}

export const architectTargets = (ownerId: string) => loadTargets(ownerId)

/** Para onde ir depois de aplicar — recalculado do banco, não guardado na tela. */
export const projectLinks = (ownerId: string, projeto: ArchitectProject) => appliedLinks(ownerId, projeto)

export async function resumeProject(ownerId: string, projectId: ObjectId, hooks: ApplyHooks = {}) {
  const projeto = await requireProject(ownerId, projectId)
  if (!RESUME_FROM.includes(projeto.status)) throw new ArchitectRefusal('not_editable', 'não há aplicação interrompida para retomar')
  await repo.transitionProject(ownerId, projectId, RESUME_FROM, 'applying')
  try {
    const operacao = await resumeApply(ownerId, projeto, hooks)
    return finalizarAplicacao(ownerId, projectId, operacao)
  } catch (error) {
    const anterior = await repo.lastOperation(ownerId, projectId)
    await repo.patchProject(ownerId, projectId, {
      status: 'failed',
      ...(anterior
        ? { applyState: { operationId: anterior._id.toString(), status: 'failed' as const, blueprintHash: anterior.blueprintHash, startedAt: anterior.startedAt, completedAt: new Date(), error: error instanceof Error ? error.message : 'falha ao retomar' } }
        : {}),
    })
    if (error instanceof ApplyConflict) throw new ArchitectRefusal('not_editable', error.message)
    throw error
  }
}

/** Fecha a aplicação: estado, checklist apurada contra o real e prontidão. */
async function finalizarAplicacao(ownerId: string, projectId: ObjectId, operacao: Awaited<ReturnType<typeof repo.lastOperation>>) {
  const atual = (await repo.getProject(ownerId, projectId))!
  const { checklist, readiness } = await recheckProject(ownerId, atual)
  const aplicado = await repo.patchProject(ownerId, projectId, {
    status: 'applied',
    appliedAt: atual.appliedAt ?? new Date(),
    checklist,
    readiness,
    applyState: operacao
      ? { operationId: operacao._id.toString(), status: operacao.status, blueprintHash: operacao.blueprintHash, startedAt: operacao.startedAt, completedAt: operacao.completedAt, error: operacao.error }
      : null,
  })
  return {
    project: aplicado ?? atual,
    operation: operacao ? { id: operacao._id.toString(), status: operacao.status, steps: operacao.steps, resourceMap: operacao.resourceMap, error: operacao.error } : null,
    links: await appliedLinks(ownerId, aplicado ?? atual),
  }
}

/** Recalcula a checklist contra o estado real. Não escreve recurso nenhum. */
export async function recheckProjectState(ownerId: string, projectId: ObjectId) {
  const projeto = await requireProject(ownerId, projectId)
  const { checklist, readiness } = await recheckProject(ownerId, projeto)
  const atualizado = (await repo.patchProject(ownerId, projectId, { checklist, readiness })) ?? projeto
  return { project: atualizado, links: await appliedLinks(ownerId, projeto) }
}

export async function rollbackProject(ownerId: string, projectId: ObjectId) {
  const projeto = await requireProject(ownerId, projectId)
  const operacao = await repo.lastOperation(ownerId, projectId)
  if (!operacao) throw new ArchitectRefusal('no_blueprint', 'não há aplicação para desfazer')
  const r = await rollbackOperation(ownerId, operacao._id, projeto.blueprint)
  await repo.patchProject(ownerId, projectId, { status: 'draft', appliedAt: null })
  return { ...r, project: (await repo.getProject(ownerId, projectId)) ?? projeto }
}
