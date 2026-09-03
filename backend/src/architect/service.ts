import { ObjectId } from 'mongodb'
import { ValidationError } from '../building.js'
import { maskSecrets, containsSecret } from './secrets.js'
import { mergeBlueprintPatch, computeBlueprintHash } from './blueprint.js'
import { compileBrief, layerCounts, selectLayer } from './compile.js'
import { compileBriefV2 } from './compileV2.js'
import { loadOfficeInventory } from './inventory.js'
import { architectV2Enabled } from './flags.js'
import { runLlmCritique } from './criticLlm.js'
import { diffBlueprints } from './diff.js'
import { repairBlueprintPatch, repairReuseWithoutTarget } from './repair.js'
import { buildArchitectPrompt } from './prompt.js'
import { runArchitectTurn } from './turn.js'
import { loadAppsForPrompt, loadExistingResources, loadOwnershipContext } from './context.js'
import { buildCapabilityManifest, manifestForPrompt } from './capabilities.js'
import { applyBriefPatch, briefForPrompt, emptyBrief, resolveIntegrations } from './brief.js'
import type { OperationBrief } from './brief.js'
import type { ArchitectCapabilityManifest } from './capabilities.js'
import { gapsForPrompt, nextQuestions } from './nextQuestion.js'
import { classifyBrief, classificationForPrompt } from './classify.js'
import { runCritic } from './critic.js'
import { runSimulation } from './simulate.js'
import { ARCHITECT_CONSTITUTION_VERSION } from './constitution.js'
import { applyBlueprintLinks, loadTargets } from './links.js'
import { buildPreview } from './preview.js'
import { deriveChecklist, applyChecklistState, computeReadiness } from './checklist.js'
import { validateOfficeBlueprint } from './validate.js'
import { isConversable, isEditable, RESUME_FROM } from './state.js'
import { getProviderKeyStatus } from '../userSettings.js'
import { applyBlueprint, resumeApply, rollbackOperation, ApplyConflict, ApplyFailure } from './apply.js'
import type { ApplyHooks } from './apply.js'
import { recheckProject, appliedLinks } from './recheck.js'
import * as repo from './repository.js'
import * as L from './limits.js'
import type { ArchitectProject } from './repository.js'
import { BLUEPRINT_LAYERS } from './types.js'
import type { ArchitectAssumption, BlueprintLayer, OfficeBlueprintV1 } from './types.js'
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
  // Falar sempre se pode. O que a conversa produzir é que decide se a proposta reabre.
  if (!isConversable(projeto.status)) throw new ArchitectRefusal('not_editable', 'este projeto foi arquivado')

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
  if (!isConversable(projeto.status)) throw new ArchitectRefusal('not_editable', 'este projeto foi arquivado')
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
  // O escritório atual entra junto: sem ele o Arquiteto propõe criar o que já existe.
  const [messages, apps, existing, manifesto] = await Promise.all([
    repo.recentMessages(ownerId, projeto._id, CONTEXTO),
    loadAppsForPrompt(ownerId),
    loadExistingResources(ownerId).catch(() => undefined),
    // O catálogo REAL desta conta, montado agora. Montado a cada rodada de propósito:
    // é o que impede o Arquiteto de propor o App que a pessoa acabou de desconectar.
    buildCapabilityManifest(ownerId).catch(() => null),
  ])

  const respondidas = { ...projeto.answers }
  if (projeto.pendingQuestion && opts.answeringPending?.trim()) {
    respondidas[projeto.pendingQuestion.key] = opts.answeringPending.trim()
  }

  /**
   * O ENTENDIMENTO entra no prompt, e as lacunas também.
   *
   * O modelo recebe o que já foi entendido do negócio e a lista fechada de assuntos que
   * ele pode perguntar agora. Escolher a pergunta é do servidor: deixar o modelo
   * escolher produzia pergunta já respondida e pergunta técnica que ele mesmo deveria
   * deduzir — e as duas custam a mesma coisa, que é a pessoa parar de acreditar que o
   * sistema está entendendo.
   */
  const briefAtual = resolveIntegrations(projeto.brief ?? emptyBrief(projeto.objective), manifesto)
  const lacunas = nextQuestions(briefAtual, manifesto)
  /**
   * A classificação vem ANTES do desenho, e vai junto no prompt.
   *
   * É o que impede as duas patologias: o superagente (tudo num só) e o enxame (um
   * agente por microetapa). O servidor decide o que é agente, o que é função e o que é
   * ferramenta; o modelo desenha em cima disso.
   */
  const classificacao = classifyBrief(briefAtual, manifesto)

  const resultado = await runArchitectTurn({
    ownerId,
    provider: projeto.provider,
    model: projeto.model,
    prompt: buildArchitectPrompt({
      project: { ...projeto, answers: respondidas },
      messages,
      apps,
      existing,
      capabilities: manifesto ? manifestForPrompt(manifesto) : undefined,
      brief: briefForPrompt(briefAtual),
      classification: classificationForPrompt(classificacao) || undefined,
      // Com pedido explícito de proposta não há entrevista: a pessoa já disse que quer
      // ver o desenho agora.
      gaps: opts.forceProposal ? undefined : gapsForPrompt(lacunas),
      forceProposal: opts.forceProposal,
    }),
    chargeKey,
  })

  if (!resultado.ok) {
    // Fica registrado NA CONVERSA: uma falha invisível vira "o sistema não respondeu".
    await repo.appendMessage(ownerId, projeto._id, 'system_notice', resultado.failure.message, { failure: true })
    throw new ArchitectRefusal(resultado.failure.code, resultado.failure.message)
  }

  const turno = resultado.result
  await repo.appendMessage(ownerId, projeto._id, 'assistant', turno.assistantText)
  // Deu certo: o que falhou antes está resolvido, e para de aparecer como se fosse agora.
  await repo.resolveFailureNotices(ownerId, projeto._id)

  // As respostas acumulam; o patch do modelo não pode apagar o que já foi respondido.
  const answers = { ...respondidas }
  for (const [k, v] of Object.entries(turno.answerPatch)) answers[k] = v

  /**
   * O que dá para consertar sozinho é consertado ANTES de virar proposta.
   *
   * Delegação "só estes" com lista vazia, etapa de rotina sem forma, reaproveitamento de
   * um recurso que não existe: nada disso a pessoa consegue resolver na tela — e os três
   * apareciam como erro vermelho bloqueando a aplicação. Cada conserto deixa um aviso,
   * porque mudar o plano de alguém em silêncio é pior que o erro.
   */
  /**
   * O Brief é atualizado ANTES do desenho.
   *
   * A ordem importa: o entendimento é o que justifica a estrutura. E o anterior fica
   * guardado — desfazer a última correção é o que permite dizer "não era isso" sem
   * recomeçar a entrevista.
   */
  const briefNovo = turno.briefPatch ? resolveIntegrations(applyBriefPatch(briefAtual, turno.briefPatch), manifesto) : briefAtual

  /**
   * O DESENHO é compilado do entendimento — não é mais o que o modelo escreveu.
   *
   * O `blueprintPatch` continua importando como SINAL: é por ele que o modelo diz "já
   * entendi o bastante, é hora de propor". O conteúdo do patch é descartado, e é essa a
   * mudança: duas conversas iguais passam a produzir o mesmo desenho, com as mesmas
   * chaves, e cada agente tem um porquê que veio de uma regra e não de uma frase.
   *
   * Um plano que o modelo já tinha desenhado NÃO é recompilado. As chaves seriam outras,
   * e num projeto aplicado chave nova significa recurso novo ao lado do que já existe —
   * um escritório duplicado por causa de uma troca de motor.
   */
  const legadoDoModelo = Boolean(projeto.blueprint) && !projeto.compiled
  const compilar = briefNovo.jobs.length > 0 && !legadoDoModelo && Boolean(turno.blueprintPatch || (turno.briefPatch && projeto.compiled))
  const compilado = compilar ? compileBrief(briefNovo, manifesto, { title: projeto.title, objective: projeto.objective }) : null

  /**
   * O plano V2 é compilado do MESMO Brief, e só quando a flag está ligada.
   *
   * As `key`s saem do mesmo `slug()` do V1, e é isso que faz `floor:atendimento` e
   * `agent:marina` resolverem no mesmo `resourceMap` durante a aplicação: o V1 cria a
   * organização, o V2 acrescenta recursos e operações em cima dela. Chaves diferentes
   * criariam dois escritórios lado a lado.
   *
   * Com a flag desligada isto nem roda, e o projeto continua exatamente como era.
   */
  const compiladoV2 =
    compilado && architectV2Enabled()
      ? compileBriefV2({
          brief: briefNovo,
          manifest: manifesto,
          inventory: await loadOfficeInventory(ownerId).catch(() => null),
          base: { title: projeto.title, objective: projeto.objective },
          changeKind: projeto.status === 'applied' ? 'expand' : 'create',
          // Os andares vêm do plano V1: é ele que a saga aplica, e é dele que sai a `key`
          // que o `resourceMap` vai conhecer.
          floors: compilado.blueprint.floors.map((f) => ({ key: f.key, name: f.name, action: f.action === 'reuse' ? ('reuse' as const) : ('create' as const), resourceId: f.resourceId ?? null })),
        })
      : null

  const consertoDoPatch = !compilado && turno.blueprintPatch ? repairBlueprintPatch(turno.blueprintPatch) : null
  const mesclado = compilado
    ? compilado.blueprint
    : consertoDoPatch
      ? mergeBlueprintPatch(projeto.blueprint, consertoDoPatch.patch as Partial<OfficeBlueprintV1>, { title: projeto.title, objective: projeto.objective })
      : projeto.blueprint

  const consertoDoReuso = mesclado ? repairReuseWithoutTarget(mesclado, existing) : null

  /**
   * Uma rodada depois de APLICADO não começa do zero.
   *
   * O que já foi criado vira `update` apontando para o recurso real, DEPOIS da mesclagem:
   * o modelo devolve o item com "create" (é o que ele sabe escrever), e quem tem a última
   * palavra sobre o que existe é o registro da aplicação, não a resposta dele. Sem isto,
   * continuar a conversa depois de aplicar duplicaria o escritório inteiro.
   */
  const comReuso = consertoDoReuso?.blueprint ?? mesclado
  const blueprint = turno.blueprintPatch && projeto.status === 'applied' ? await marcarOQueJaExiste(ownerId, projeto, comReuso) : comReuso

  // Os avisos do conserto entram JUNTO dos do modelo: quem lê a proposta lê tudo num
  // lugar só, e não descobre a mudança comparando duas versões.
  if (blueprint) {
    const avisos = [...(consertoDoPatch?.warnings ?? []), ...(consertoDoReuso?.warnings ?? [])]
    if (avisos.length) blueprint.warnings = [...(blueprint.warnings ?? []), ...avisos].slice(0, L.MAX_WARNINGS)
  }

  const assumptions = mesclarSuposicoes(projeto.assumptions, turno.assumptions, answers)
  /**
   * O hash carimba o RECORTE, não o plano.
   *
   * É o recorte que a pessoa lê e aprova, e é ele que a aplicação escreve. Se o hash
   * fosse do plano inteiro, trocar de camada não mudaria o hash — e uma confirmação
   * feita olhando "Essencial" aplicaria o "Completo" sem que nada avisasse.
   */
  const camada = camadaDe(projeto)
  const recorte = blueprint ? selectLayer(blueprint, camada) : null
  const hash = recorte ? computeBlueprintHash(recorte, projeto.blueprintV2) : null
  const patch: Partial<ArchitectProject> = {
    // Qual constituição valia quando esta proposta foi feita. Sem isso, mudar o texto
    // das regras torna uma decisão antiga inexplicável — e impossível de reproduzir.
    architectConstitutionVersion: ARCHITECT_CONSTITUTION_VERSION,
    ...(turno.briefPatch ? { brief: briefNovo, previousBrief: projeto.brief ?? null } : {}),
    answers,
    pendingQuestion: turno.question ? { key: turno.question.key, text: turno.question.text } : null,
    assumptions,
    blueprint,
    blueprintHash: hash,
    // A versão anterior só é guardada quando a revisão MUDOU alguma coisa. Uma rodada
    // que só respondeu uma pergunta não pode zerar o "o que mudou" da revisão passada.
    ...(projeto.blueprint && hash !== projeto.blueprintHash ? { previousBlueprint: recorteDe(projeto) } : {}),
    ...(compilado ? { compiled: true } : {}),
    ...(compiladoV2 ? { blueprintVersion: 2 as const, blueprintV2: compiladoV2.blueprint } : {}),
    // Proposta na mesa é `draft`; a validação é que promove para `ready`. Um projeto
    // aplicado que ganhou proposta nova volta para `draft` — é a rodada seguinte.
    status: blueprint ? 'draft' : projeto.status === 'applied' ? 'applied' : 'discovery',
  }
  if (recorte) {
    const checklist = applyChecklistState(deriveChecklist(recorte), new Set(), marcadosDe(projeto))
    patch.checklist = checklist
    patch.readiness = computeReadiness(checklist, [])
    // O ensaio da versão que acabou de nascer. Guardado para a revisão seguinte poder
    // responder "o que quebrou desde o que eu aprovei?".
    // Aqui o carimbo tem sentido: diz quando ESTE ensaio aconteceu.
    patch.simulation = runSimulation(briefNovo, recorte, manifesto, briefNovo.version, new Date())

    /**
     * A leitura do modelo acontece AQUI — uma vez por revisão, e só quando a revisão
     * mudou de verdade.
     *
     * Não na prévia: abrir a proposta três vezes gastaria três inferências para dizer a
     * mesma coisa. Não na aplicação: ninguém deve esperar por um palpite para poder
     * aplicar o que já foi aprovado. Aqui a pessoa já está esperando por uma proposta,
     * e o que ela recebe é a proposta já revisada.
     *
     * Falhar aqui não é falhar a rodada: `runLlmCritique` não lança, e o pior caso é
     * uma proposta sem a segunda leitura — que é como ela era antes desta camada.
     */
    if (hash && hash !== projeto.blueprintHash) {
      patch.llmCritique = await runLlmCritique({
        ownerId,
        provider: projeto.provider,
        model: projeto.model,
        chargeKey,
        blueprint: recorte,
        hash,
      })
    }
  }
  const atualizado = (await repo.patchProject(ownerId, projeto._id, patch)) ?? projeto

  return { project: atualizado, assistantText: turno.assistantText, question: turno.question, secretMasked: opts.secretMasked }
}

/**
 * A proposta, com o que JÁ EXISTE marcado como tal.
 *
 * Cada item que a aplicação criou passa a `update` com o `resourceId` real. `update`
 * exige aprovação individual na confirmação, então a rodada seguinte não muda nada em
 * silêncio: o dono vê item por item o que vai ser tocado no escritório que já roda.
 *
 * O mapa vem do `resourceMap` da operação — o mesmo registro que faz reaplicar não
 * duplicar. Item sem entrada no mapa (não foi criado, ou foi criado por outro caminho)
 * fica como está.
 */
async function marcarOQueJaExiste(ownerId: string, projeto: ArchitectProject, base: OfficeBlueprintV1 | null): Promise<OfficeBlueprintV1 | null> {
  if (!base) return base
  const operacao = await repo.lastOperation(ownerId, projeto._id)
  const mapa = new Map(Object.entries(operacao?.resourceMap ?? {}))
  if (mapa.size === 0) return base

  const bp: OfficeBlueprintV1 = structuredClone(base)
  const listas: [keyof OfficeBlueprintV1, string][] = [
    ['floors', 'floor'],
    ['agents', 'agent'],
    ['sectors', 'sector'],
    ['routines', 'routine'],
  ]
  for (const [lista, kind] of listas) {
    for (const item of (bp[lista] ?? []) as unknown as { key: string; action: string; resourceId?: string | null }[]) {
      const id = mapa.get(`${kind}:${item.key}`)
      if (!id) continue
      item.action = 'update'
      item.resourceId = id
    }
  }
  return bp
}

/**
 * A CAMADA aprovada, e o recorte que ela produz.
 *
 * `blueprint` guarda o plano inteiro. O que a pessoa aprova, o que o hash carimba e o
 * que a aplicação escreve é sempre o RECORTE — uma tela mostrando o plano completo e um
 * apply escrevendo outra coisa seria a pior forma de errar isso. Projeto sem camada
 * escolhida (todo o legado, e todo plano que o modelo desenhou) não tem item marcado:
 * o recorte é o plano inteiro, e nada muda para ele.
 */
export const camadaDe = (p: { layer?: BlueprintLayer }): BlueprintLayer => p.layer ?? 'complete'

export const recorteDe = (p: { blueprint: OfficeBlueprintV1 | null; layer?: BlueprintLayer }): OfficeBlueprintV1 | null =>
  p.blueprint ? selectLayer(p.blueprint, camadaDe(p)) : null

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
  // Vale o RECORTE: é ele que vai ser escrito. Validar o plano inteiro reprovaria por
  // causa de um item que a camada escolhida nem inclui.
  const r = validateOfficeBlueprint(recorteDe(projeto)!, ctx)
  if (isEditable(projeto.status)) {
    await repo.patchProject(ownerId, projectId, { status: r.valid ? 'ready' : 'draft' })
  }
  return r
}

export async function previewProject(ownerId: string, projectId: ObjectId) {
  const projeto = await requireProject(ownerId, projectId)
  if (!projeto.blueprint) throw new ArchitectRefusal('no_blueprint', 'ainda não existe proposta para revisar')
  const [ctx, manifesto] = await Promise.all([loadOwnershipContext(ownerId), buildCapabilityManifest(ownerId).catch(() => null)])
  const recorte = recorteDe(projeto)!
  const previa = buildPreview(recorte, ctx, marcadosDe(projeto), projeto.blueprintV2)

  /**
   * O crítico e o ensaio vão JUNTO da prévia.
   *
   * Eles respondem o que a validação estrutural não responde — o gerente sem equipe, o
   * caminho que morre num App desconectado — e é na prévia que a pessoa decide aplicar.
   * Separar em outra chamada faria a decisão acontecer antes da informação chegar.
   *
   * Os dois são determinísticos e não escrevem nada: rodar a prévia duas vezes dá o
   * mesmo resultado, e nenhuma delas toca no escritório.
   */
  const deterministico = runCritic(recorte, manifesto)
  /**
   * A leitura do modelo entra JUNTO — mas só a desta revisão.
   *
   * Hash diferente é leitura de outro desenho: ela apontaria problema em agente que já
   * não existe, e quem lê não teria como saber disso. Descartada, a tela diz que a
   * leitura ainda não foi feita — o que é verdade — em vez de mostrar uma opinião velha
   * como se fosse sobre o que está na frente da pessoa.
   */
  const leitura = projeto.llmCritique
  const valida = leitura && leitura.hash === projeto.blueprintHash
  const critique = {
    ...deterministico,
    findings: valida && leitura.status === 'ok' ? [...deterministico.findings, ...leitura.findings] : deterministico.findings,
    // A leitura auxiliar nunca muda `clean`: ela não bloqueia aplicação nenhuma.
    llmStatus: !leitura ? ('absent' as const) : !valida ? ('stale' as const) : leitura.status,
  }
  const simulation = runSimulation(projeto.brief ?? emptyBrief(projeto.objective), recorte, manifesto, projeto.brief?.version ?? 0)
  return { ...previa, critique, simulation, layer: camadaDe(projeto), layerCounts: layerCounts(projeto.blueprint) }
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
  // A proposta é o RECORTE da camada escolhida — o que a pessoa lê é o que vai ser
  // aplicado. O plano inteiro vai junto, porque é dele que sai a comparação entre as
  // camadas: sem ele, "Recomendado" seria um número sem plano por trás.
  blueprint: recorteDe(p),
  plan: p.blueprint,
  layer: camadaDe(p),
  layerCounts: p.blueprint ? layerCounts(p.blueprint) : null,
  blueprintHash: p.blueprintHash,
  // O entendimento vai junto: é ele que a tela mostra como "O que entendi", e é por ele
  // que a pessoa corrige o Arquiteto sem precisar reabrir a conversa inteira.
  brief: p.brief ?? null,
  canUndoBrief: Boolean(p.previousBrief),
  // O que a última revisão mexeu. Vazio na primeira proposta: não há com o que comparar.
  changes: diffBlueprints(p.previousBlueprint, recorteDe(p)),
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
  input: { blueprintHash: string; idempotencyKey: string; confirm: boolean; approvedAppKeys?: string[]; approvedUpdateKeys?: string[]; approvedActivationKeys?: string[]; deliveryConnections?: { key: string; connectionId: string }[] },
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
    // Escreve o RECORTE aprovado, e só ele. O hash que a pessoa confirmou é o desta
    // camada; aplicar o plano inteiro criaria o que ninguém aprovou.
    const operacao = await applyBlueprint(ownerId, { ...travado, blueprint: recorteDe(travado) }, input, hooks)
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
  // A ligação é feita no PLANO: um recurso ligado continua ligado quando a camada muda.
  const ligado = await applyBlueprintLinks(ownerId, projeto.blueprint, links, projeto.blueprintV2)
  const blueprint = ligado.blueprint
  const recorte = selectLayer(blueprint, camadaDe(projeto))
  const checklist = applyChecklistState(deriveChecklist(recorte), new Set(), marcadosDe(projeto))
  return (
    (await repo.patchProject(ownerId, projectId, {
      blueprint,
      // O plano V2 também recebe a ligação: reaproveitar um Database existente é uma escolha
      // sobre a proposta inteira, não só sobre a parte que o V1 sabe descrever.
      ...(ligado.blueprintV2 ? { blueprintV2: ligado.blueprintV2 } : {}),
      blueprintHash: computeBlueprintHash(recorte, ligado.blueprintV2 ?? projeto.blueprintV2),
      checklist,
      readiness: computeReadiness(checklist, []),
      // Uma ligação nova precisa ser validada de novo antes de aplicar.
      status: 'draft',
    })) ?? projeto
  )
}

/**
 * Trocar a camada — e por que isso é uma REVISÃO, não um filtro de tela.
 *
 * Cada camada é um recorte diferente do mesmo plano, com hash próprio. Trocar muda o
 * que vai ser escrito no escritório, então derruba para `draft`, guarda o recorte
 * anterior para o diff e invalida o hash que estava confirmado: uma confirmação em voo
 * com o hash antigo é recusada, que é exatamente o comportamento certo.
 */
export async function setProjectLayer(ownerId: string, projectId: ObjectId, layer: unknown): Promise<ArchitectProject> {
  const projeto = await requireProject(ownerId, projectId)
  if (!isEditable(projeto.status)) throw new ArchitectRefusal('not_editable', 'este projeto já foi aplicado ou arquivado')
  if (!projeto.blueprint) throw new ArchitectRefusal('no_blueprint', 'ainda não existe proposta para recortar')
  if (typeof layer !== 'string' || !(BLUEPRINT_LAYERS as readonly string[]).includes(layer)) {
    throw new ValidationError('escolha entre essencial, recomendado e completo')
  }
  const escolhida = layer as BlueprintLayer
  if (escolhida === camadaDe(projeto)) return projeto

  const anterior = recorteDe(projeto)
  const recorte = selectLayer(projeto.blueprint, escolhida)
  const checklist = applyChecklistState(deriveChecklist(recorte), new Set(), marcadosDe(projeto))
  return (
    (await repo.patchProject(ownerId, projectId, {
      layer: escolhida,
      previousBlueprint: anterior,
      blueprintHash: computeBlueprintHash(recorte, projeto.blueprintV2),
      checklist,
      readiness: computeReadiness(checklist, []),
      status: 'draft',
    })) ?? projeto
  )
}

// --- correção à mão --------------------------------------------------------------------

/**
 * O que o dono pode corrigir sem pedir nada ao modelo.
 *
 * Texto, e só texto. Trocar o nome de um agente não deveria custar uma inferência e uma
 * torcida — mas `floorKey`, `action` e `resourceId` não entram aqui de propósito: são os
 * campos que decidem onde o recurso nasce e sobre qual recurso EXISTENTE ele escreve.
 * `resourceId` continua vindo da tela de ligações, que confere a posse antes de gravar.
 */
const EDITAVEIS: Record<string, { lista: 'floors' | 'agents' | 'sectors' | 'routines' | 'appRequirements' | 'knowledgeRequirements'; campos: Record<string, { max: number; obrigatorio?: boolean }> }> = {
  floor: {
    lista: 'floors',
    campos: { name: { max: L.MAX_NAME_CHARS, obrigatorio: true }, mission: { max: L.MAX_SHORT_TEXT_CHARS }, description: { max: L.MAX_SHORT_TEXT_CHARS }, rationale: { max: L.MAX_SHORT_TEXT_CHARS } },
  },
  agent: {
    lista: 'agents',
    campos: {
      name: { max: L.MAX_NAME_CHARS, obrigatorio: true },
      objective: { max: L.MAX_SHORT_TEXT_CHARS },
      role: { max: L.MAX_SHORT_TEXT_CHARS },
      instructions: { max: L.MAX_LONG_TEXT_CHARS },
      constraints: { max: L.MAX_LONG_TEXT_CHARS },
      rationale: { max: L.MAX_SHORT_TEXT_CHARS },
    },
  },
  sector: { lista: 'sectors', campos: { name: { max: L.MAX_NAME_CHARS, obrigatorio: true }, instruction: { max: L.MAX_LONG_TEXT_CHARS }, rationale: { max: L.MAX_SHORT_TEXT_CHARS } } },
  routine: { lista: 'routines', campos: { name: { max: L.MAX_NAME_CHARS, obrigatorio: true }, description: { max: L.MAX_SHORT_TEXT_CHARS }, rationale: { max: L.MAX_SHORT_TEXT_CHARS } } },
  app: { lista: 'appRequirements', campos: { reason: { max: L.MAX_SHORT_TEXT_CHARS, obrigatorio: true } } },
  knowledge: {
    lista: 'knowledgeRequirements',
    campos: {
      title: { max: L.MAX_NAME_CHARS, obrigatorio: true },
      description: { max: L.MAX_SHORT_TEXT_CHARS },
      // O conteúdo do documento, quando a pessoa JÁ o tem. Enquanto ele não vem, o
      // item continua pendência — o que nunca acontece é o texto ser inventado.
      content: { max: L.MAX_KNOWLEDGE_CONTENT_CHARS },
    },
  },
}

export interface BlueprintEdit {
  kind: string
  key: string
  fields?: Record<string, unknown>
  remove?: boolean
}

/** Quem aponta para este item. Remover o que alguém usa deixaria a proposta quebrada. */
function quemUsa(bp: OfficeBlueprintV1, kind: string, key: string): string[] {
  const usos: string[] = []
  if (kind === 'floor') {
    for (const a of bp.agents ?? []) if (a.floorKey === key) usos.push(`o agente "${a.name}"`)
    for (const s of bp.sectors ?? []) if (s.floorKey === key) usos.push(`o setor "${s.name}"`)
    for (const r of bp.routines ?? []) if (r.floorKey === key) usos.push(`a rotina "${r.name}"`)
  }
  if (kind === 'agent') {
    for (const f of bp.floors ?? []) if (f.coordinatorAgentKey === key) usos.push(`o andar "${f.name}" (coordenador)`)
    for (const s of bp.sectors ?? []) if ((s.memberAgentKeys ?? []).includes(key) || s.coordinatorAgentKey === key) usos.push(`o setor "${s.name}"`)
    for (const r of bp.routines ?? []) if (r.ownerAgentKey === key) usos.push(`a rotina "${r.name}"`)
    for (const req of bp.appRequirements ?? []) if ((req.agentKeys ?? []).includes(key)) usos.push(`a permissão do App "${req.appKey}"`)
  }
  if (kind === 'sector' || kind === 'agent' || kind === 'floor') {
    for (const req of bp.knowledgeRequirements ?? []) if (req.scope === kind && req.targetKey === key) usos.push(`o conhecimento "${req.title}"`)
  }
  return [...new Set(usos)].slice(0, 5)
}

/**
 * Corrigir a proposta à mão — sem chamar o modelo.
 *
 * O valor não é economizar token: é que pedir "troque o nome para X" devolve uma
 * proposta INTEIRA nova, e junto com o nome muda o que ninguém pediu para mudar. Aqui
 * muda exatamente o campo que a pessoa editou, e o resto fica onde estava.
 *
 * O que sai daqui não é confiável por ser do dono: é texto de usuário, mascarado e
 * limitado como o da conversa, e a proposta inteira volta para o validador antes de
 * poder ser aplicada — a edição derruba o projeto para `draft` justamente por isso.
 */
export async function editBlueprint(ownerId: string, projectId: ObjectId, edits: unknown): Promise<ArchitectProject> {
  const projeto = await requireProject(ownerId, projectId)
  if (!isEditable(projeto.status)) throw new ArchitectRefusal('not_editable', 'este projeto já foi aplicado ou arquivado')
  if (!projeto.blueprint) throw new ArchitectRefusal('no_blueprint', 'ainda não existe proposta para editar')
  if (!Array.isArray(edits) || edits.length === 0) throw new ValidationError('informe o que mudou')

  const anterior = projeto.blueprint
  const bp: OfficeBlueprintV1 = structuredClone(anterior)

  for (const bruto of edits.slice(0, 60)) {
    const edit = (bruto ?? {}) as BlueprintEdit
    const alvo = EDITAVEIS[String(edit.kind ?? '')]
    if (!alvo) throw new ValidationError(`não dá para editar itens do tipo "${String(edit.kind ?? '')}"`)
    const key = String(edit.key ?? '').trim()
    const lista = (bp[alvo.lista] ?? []) as unknown as Record<string, unknown>[]
    const item = lista.find((i) => i.key === key)
    if (!item) throw new ValidationError('este item não está mais na proposta; recarregue a página')

    if (edit.remove === true) {
      const usos = quemUsa(bp, edit.kind, key)
      // Remover em cascata apagaria o que a pessoa não pediu para apagar. Ela decide a
      // ordem; o sistema só diz o que está no caminho.
      if (usos.length > 0) throw new ValidationError(`não dá para remover: ${usos.join(', ')} depende deste item`)
      ;(bp[alvo.lista] as unknown[]) = lista.filter((i) => i.key !== key)
      continue
    }

    const fields = (edit.fields ?? {}) as Record<string, unknown>
    for (const [nome, valor] of Object.entries(fields)) {
      const regra = alvo.campos[nome]
      if (!regra) throw new ValidationError(`o campo "${nome}" não é editável aqui`)
      if (typeof valor !== 'string') throw new ValidationError(`o campo "${nome}" precisa ser texto`)
      const texto = maskSecrets(valor).trim().slice(0, regra.max)
      if (!texto) {
        if (regra.obrigatorio) throw new ValidationError(`"${nome}" não pode ficar vazio`)
        delete item[nome]
        continue
      }
      item[nome] = texto
    }

    // O estado do conhecimento SEGUE o conteúdo, e não o contrário. Deixar a pessoa
    // marcar "entregue" sem texto produziria uma base que parece pronta e não responde.
    if (edit.kind === 'knowledge' && 'content' in fields) {
      item.state = typeof item.content === 'string' && item.content.trim() ? 'supplied' : 'missing'
    }
  }

  const recorte = selectLayer(bp, camadaDe(projeto))
  const hash = computeBlueprintHash(recorte, projeto.blueprintV2)
  if (hash === projeto.blueprintHash) return projeto

  const checklist = applyChecklistState(deriveChecklist(recorte), new Set(), marcadosDe(projeto))
  return (
    (await repo.patchProject(ownerId, projectId, {
      blueprint: bp,
      previousBlueprint: selectLayer(anterior, camadaDe(projeto)),
      blueprintHash: hash,
      checklist,
      readiness: computeReadiness(checklist, []),
      // Proposta mexida é proposta a validar de novo. E o hash muda, então uma
      // confirmação em voo com o hash antigo é recusada — que é o comportamento certo.
      status: 'draft',
    })) ?? projeto
  )
}

/**
 * Corrigir o entendimento à mão — sem gastar inferência.
 *
 * "O que entendi" existe para ser corrigido: se a pessoa precisa reabrir a conversa e
 * torcer para o modelo entender que ela discorda, o painel vira decoração. Aqui o
 * patch é o mesmo contrato do modelo, validado do mesmo jeito.
 */
export async function editBrief(ownerId: string, projectId: ObjectId, patch: unknown): Promise<ArchitectProject> {
  const projeto = await requireProject(ownerId, projectId)
  if (!isConversable(projeto.status)) throw new ArchitectRefusal('not_editable', 'este projeto foi arquivado')
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ValidationError('informe o que mudou')

  const manifesto = await buildCapabilityManifest(ownerId).catch(() => null)
  const atual = projeto.brief ?? emptyBrief(projeto.objective)
  const novo = resolveIntegrations(applyBriefPatch(atual, patch), manifesto)
  return (await repo.patchProject(ownerId, projectId, { brief: novo, previousBrief: atual, ...recompilar(projeto, novo, manifesto) })) ?? projeto
}

/** Desfazer a última mudança do entendimento. Uma só — ver `previousBrief`. */
export async function undoBrief(ownerId: string, projectId: ObjectId): Promise<ArchitectProject> {
  const projeto = await requireProject(ownerId, projectId)
  if (!projeto.previousBrief) throw new ValidationError('não há mudança recente para desfazer')
  const manifesto = await buildCapabilityManifest(ownerId).catch(() => null)
  return (
    (await repo.patchProject(ownerId, projectId, {
      brief: projeto.previousBrief,
      previousBrief: null,
      ...recompilar(projeto, projeto.previousBrief, manifesto),
    })) ?? projeto
  )
}

/**
 * Corrigir o ENTENDIMENTO refaz o DESENHO — na hora, sem passar pelo modelo.
 *
 * É o que dá sentido a "O que entendi" ser editável: corrigir "não é um restaurante, é
 * uma clínica" e ver a proposta continuar a mesma seria a tela dizendo que ouviu e não
 * mudando nada. Como o desenho é compilado, refazer não custa inferência.
 *
 * Só vale para plano compilado: o desenho que o modelo fez tem outras chaves, e trocar
 * as chaves de um projeto aplicado criaria um segundo escritório ao lado do que roda.
 * A leitura auxiliar do modelo NÃO é refeita aqui — ela fica obsoleta e é descartada na
 * prévia, porque uma correção de texto não deve gastar uma inferência.
 */
function recompilar(projeto: ArchitectProject, brief: OperationBrief, manifesto: ArchitectCapabilityManifest | null): Partial<ArchitectProject> {
  if (!projeto.compiled || brief.jobs.length === 0) return {}
  const { blueprint } = compileBrief(brief, manifesto, { title: projeto.title, objective: projeto.objective })
  const recorte = selectLayer(blueprint, camadaDe(projeto))
  const hash = computeBlueprintHash(recorte, projeto.blueprintV2)
  if (hash === projeto.blueprintHash) return { blueprint }

  const checklist = applyChecklistState(deriveChecklist(recorte), new Set(), marcadosDe(projeto))
  return {
    blueprint,
    blueprintHash: hash,
    previousBlueprint: recorteDe(projeto),
    checklist,
    readiness: computeReadiness(checklist, []),
    simulation: runSimulation(brief, recorte, manifesto, brief.version, new Date()),
    // Desenho novo é proposta a validar de novo — e o hash antigo, em voo, é recusado.
    status: 'draft',
  }
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
  const r = await rollbackOperation(ownerId, operacao._id, recorteDe(projeto))
  await repo.patchProject(ownerId, projectId, { status: 'draft', appliedAt: null })
  return { ...r, project: (await repo.getProject(ownerId, projectId)) ?? projeto }
}
