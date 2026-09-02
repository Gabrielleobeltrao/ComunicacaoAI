// One routine step executed by the worker, extracted so the real ordering rules are
// testable without Redis/BullMQ and without duplicating any rule:
//
//   1. the referenced sector is authorised INSIDE this run's account — before any
//      knowledge lookup, any tool resolution and any model call;
//   2. only then the curated context is retrieved and the model runs;
//   3. the charge and the telemetry are persisted with a bounded retry and handed
//      back as `settle`, which the RUNNER awaits OUTSIDE the step timeout. That is
//      what guarantees a slow database can never be mistaken for a slow inference:
//      the step is still not confirmed before its accounting finishes, but a
//      persistence delay/failure can never trigger a second model call.
import { ObjectId } from 'mongodb'
import type { Agent } from '../agents.js'
import type { AgentExecutionRequest, AgentExecutionResult } from '../agentRuntime.js'
import type { ResolvedTool } from '../agentTools.js'
import type { AgentEventStatus, RecordAgentEventInput } from '../agentEvents.js'
import type { StepUsage } from './runner.js'
import { resolveAgentRun } from '../agentDefinition.js'
import { buildRetrievalQuery, formatContextWithSources, multiSourceNotice } from '../retrievalQuery.js'
import { instrumentTools, NOOP_TRACKER } from '../agentLiveTracker.js'
import type { LiveTracker } from '../agentLiveTracker.js'
import { capabilitiesOf } from '../agentCapabilities.js'
import { gatherWebEvidence } from '../webSearch/step.js'
import { agentContractOf } from '../executors/contract.js'
import { dispatchAgentExecution } from '../executors/dispatcher.js'

// The knowledge the step requires could not be consulted (the embedding or the
// vector search failed), and this agent is configured to refuse rather than answer
// ungrounded. Retryable: the base may well answer on the next attempt.
export class KnowledgeUnavailableError extends Error {
  readonly kind = 'knowledge_unavailable'
  readonly retryable = true
  constructor(message = 'a base de conhecimento não pôde ser consultada') {
    super(message)
    this.name = 'KnowledgeUnavailableError'
  }
}

/**
 * A execução por função ou ferramenta falhou pelo CONTRATO ou pela configuração.
 *
 * Não é transitório: uma função que devolve fora do formato devolve igual na segunda vez,
 * e uma ação que não existe continua não existindo. Repetir gastaria as tentativas do
 * runner para chegar ao mesmo lugar, e atrasaria o diagnóstico que já está pronto.
 */
export class RoutineExecutorError extends Error {
  readonly retryable = false
  constructor(
    message: string,
    readonly kind: string = 'executor',
  ) {
    super(message)
    this.name = 'RoutineExecutorError'
  }
}

// A configuration problem (not a transient failure): the step must NOT be retried,
// because retrying cannot fix a sector that does not belong to this account. The
// message is uniform and never reveals whether the id exists elsewhere.
export class RoutineConfigurationError extends Error {
  readonly kind = 'validation'
  readonly retryable = false
  constructor(message = 'configuração inválida: setor indisponível para esta conta') {
    super(message)
    this.name = 'RoutineConfigurationError'
  }
}

export interface RoutineStepCall {
  agentId: string
  objective: string
  instructions: string
  input: unknown
  context: string[]
  format: 'text' | 'markdown' | 'json'
  stepId: string
  attempt: number
  sectorId?: string | null
}

export interface RoutineRunContext {
  ownerId: string
  runId: string
  buildingId: ObjectId
  floorId: ObjectId
  // The request this step participates in. Absent on paths not yet correlated —
  // those stay honestly marked as partial telemetry instead of being guessed.
  rootExecutionId?: ObjectId | null
}

export interface RoutineExecutionDeps {
  loadAgent: (ownerId: string, agentId: ObjectId) => Promise<Agent | null>
  // Owner-scoped: returns null both for a foreign and for a malformed id.
  resolveOwnedSectorId: (ownerId: string, raw: unknown) => Promise<ObjectId | null>
  /**
   * A leitura passa pela política do agente, como em todo executor.
   *
   * Recebe o AGENTE, e não o id: é a política dele que decide as bases, e o id sozinho
   * obrigaria quem implementa a dependência a carregá-lo de novo — ou, pior, a montar a
   * lista de donos por conta própria.
   */
  retrieveContext: (
    agent: Agent,
    query: string,
    opts: { verifiedSectorId: ObjectId | null; ownerId: string; executionId?: string; requireGrounding?: boolean },
  ) => Promise<{ context: string[]; failed: boolean; status?: string; sources?: { documentId: string | null; title: string | null }[] }>
  resolveTools: (agent: Agent, ownerId: string) => Promise<ResolvedTool[]>
  apiKeyFor: (ownerId: string, provider: string) => Promise<string | null>
  runTask: (req: AgentExecutionRequest) => Promise<AgentExecutionResult>
  // Owner accounting, idempotent per chargeKey.
  charge: (ownerId: string, usage: StepUsage, chargeKey: string) => Promise<boolean>
  chargeKeyFor: (runId: string, stepId: string, agentId: string, attempt: number) => string
  // Per-agent telemetry, idempotent per (eventKey, attempt).
  finalizeEvent: (input: RecordAgentEventInput) => Promise<void>
  eventKeyFor: (runId: string, stepId: string, agentId: string) => string
  /**
   * Guarda na base as páginas que a busca leu. Injetada porque escreve no banco.
   * Ausente = a busca funciona e nada é guardado — o que é o comportamento do teste.
   */
  rememberSearchPages?: (
    ownerId: string,
    agentId: ObjectId,
    query: string,
    pages: unknown[],
    rememberDays: number,
  ) => Promise<{ saved: number; updated: number } | null>
  isCanceled?: () => Promise<boolean>
  // Live map projection. Injected because this module must stay testable without a
  // database — absent means no instrumentation at all, never a fake state.
  trackerFor?: (agentId: string) => LiveTracker
  // Injected so tests don't wait real seconds.
  sleep?: (ms: number) => Promise<void>
}

const PERSIST_ATTEMPTS = 3
const PERSIST_BACKOFF_MS = 200

// Await a critical persistence with a bounded retry. NEVER rethrows: the model has
// already run, so failing here must not make the runner retry the step (that would
// pay for a second inference). The failure is reported to the caller instead.
async function persistWithRetry(what: string, fn: () => Promise<unknown>, sleep: (ms: number) => Promise<void>): Promise<boolean> {
  for (let attempt = 1; attempt <= PERSIST_ATTEMPTS; attempt++) {
    try {
      await fn()
      return true
    } catch (error) {
      if (attempt === PERSIST_ATTEMPTS) {
        console.error(`${what} failed after ${PERSIST_ATTEMPTS} attempts (step completed; NOT re-running the model):`, (error as Error).message)
        return false
      }
      await sleep(PERSIST_BACKOFF_MS * attempt)
    }
  }
  return false
}

export interface RoutineStepResult {
  output: string
  usage: StepUsage
  // Resolves when the charge + telemetry finished their attempts; false when they
  // could not be written even after retries. NEVER rejects — the model already ran,
  // so this must not look like a step failure. Awaited by the runner outside the
  // step timeout.
  settle: Promise<boolean>
}

/**
 * Um passo de rotina executado por função ou por ferramenta.
 *
 * Mesma contabilidade, mesma idempotência, mesma auditoria — `settle` é montado do mesmo
 * jeito e continua sendo aguardado pelo runner FORA do prazo do passo. O que muda é o que
 * roda no meio, e a conta: zero token, porque nenhum provedor foi chamado.
 */
async function executarPassoPorDespacho(
  agent: Agent,
  contrato: ReturnType<typeof agentContractOf>,
  call: RoutineStepCall,
  ctx: RoutineRunContext,
  deps: RoutineExecutionDeps,
  tracker: LiveTracker,
  sleep: (ms: number) => Promise<void>,
): Promise<RoutineStepResult> {
  const startedAt = new Date()
  const eventKey = deps.eventKeyFor(ctx.runId, call.stepId, agent._id.toString())
  const semCusto = { inputTokens: 0, outputTokens: 0 }
  const baseEvent = {
    eventKey,
    ownerId: ctx.ownerId,
    agentId: agent._id,
    buildingId: ctx.buildingId,
    floorId: ctx.floorId,
    source: 'routine' as const,
    preset: agent.preset,
    startedAt,
    attemptCount: call.attempt,
    rootExecutionId: ctx.rootExecutionId ?? null,
    metadata: {
      runId: ctx.runId,
      stepId: call.stepId,
      attempt: call.attempt,
      executorKind: contrato.executorKind,
      ...(contrato.executorConfig.kind === 'function'
        ? { functionName: contrato.executorConfig.functionName, functionVersion: contrato.executorConfig.version ?? '' }
        : {}),
      ...(contrato.executorConfig.kind === 'tool'
        ? { appKey: contrato.executorConfig.appKey ?? '', actionKey: contrato.executorConfig.actionKey ?? '', toolId: contrato.executorConfig.toolId ?? '' }
        : {}),
      // Sem base, sem modelo, sem chave: nada disso acontece por este caminho.
      grounding: 'no_base',
      ragChunks: 0,
      ragSources: 0,
      toolsAvailable: 0,
      runConfigDropped: '',
    },
  }

  tracker.report('thinking')
  const r = await dispatchAgentExecution(agent, {
    agentId: agent._id,
    ownerId: ctx.ownerId,
    objective: String(agent.objective ?? call.objective ?? ''),
    // A entrada da etapa quando ela é estruturada; sem isso o contrato não tem o que
    // conferir e a conferência central recusa antes de rodar.
    input: call.input,
    correlationId: ctx.runId,
  })

  if (!r.ok) {
    const canceled = deps.isCanceled ? await deps.isCanceled().catch(() => false) : false
    const status: AgentEventStatus = canceled ? 'canceled' : r.error?.kind === 'timeout' ? 'timeout' : 'failed'
    await tracker.finish(canceled ? 'canceled' : 'failed')
    await persistWithRetry(
      'finalizeAgentEvent',
      () =>
        deps.finalizeEvent({
          ...baseEvent,
          status,
          finishedAt: new Date(),
          metadata: { ...baseEvent.metadata, outputValid: false, error: r.error?.kind ?? 'executor', durationMs: Date.now() - startedAt.getTime() },
        }),
      sleep,
    )
    // Erro de contrato ou de configuração NÃO se conserta repetindo: uma função que
    // devolve fora do formato devolve igual na segunda vez.
    throw new RoutineExecutorError(r.error?.message ?? 'a execução não completou', r.error?.kind ?? 'executor')
  }

  /**
   * A mesma persistência crítica do caminho de modelo.
   *
   * A cobrança continua sendo chamada — com uso zero — porque a idempotência por tentativa
   * é dela, e pular a chamada faria uma rotina de função ficar fora do registro de
   * tentativas que todo o resto usa.
   */
  const settle = (async () => {
    const charged = await persistWithRetry(
      'recordReplyUsageOnce',
      () => deps.charge(ctx.ownerId, semCusto, deps.chargeKeyFor(ctx.runId, call.stepId, agent._id.toString(), call.attempt)),
      sleep,
    )
    const recorded = await persistWithRetry(
      'finalizeAgentEvent',
      () =>
        deps.finalizeEvent({
          ...baseEvent,
          status: 'succeeded' as AgentEventStatus,
          finishedAt: new Date(),
          // ZERO. Uma função determinística não fala com provedor nenhum, e o número
          // existe para provar isso a quem paga.
          inputTokens: 0,
          outputTokens: 0,
          model: null,
          toolCalls: r.telemetry.externalCalls ?? 0,
          metadata: {
            ...baseEvent.metadata,
            outputFormat: contrato.responseMode,
            outputValid: true,
            outputRepaired: false,
            hasStructured: r.structured !== undefined,
            hasText: Boolean(r.text),
            externalCalls: r.telemetry.externalCalls ?? 0,
            durationMs: Date.now() - startedAt.getTime(),
          },
        }),
      sleep,
    )
    return charged && recorded
  })()

  await tracker.finish('completed')
  /**
   * O que a etapa seguinte recebe.
   *
   * `structured` não produz prosa — e a etapa seguinte de uma automação consome TEXTO.
   * Serializar o dado é o que mantém a cadeia funcionando sem transformar o dado em frase
   * por um modelo: quem quiser a frase encadeia um agente de IA depois.
   */
  return {
    output: r.text ?? (r.structured !== undefined ? JSON.stringify(r.structured.data) : ''),
    usage: semCusto,
    settle,
  }
}

export async function executeRoutineStep(call: RoutineStepCall, ctx: RoutineRunContext, deps: RoutineExecutionDeps): Promise<RoutineStepResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const tracker = deps.trackerFor?.(call.agentId) ?? NOOP_TRACKER

  const agent = await deps.loadAgent(ctx.ownerId, new ObjectId(call.agentId))
  if (!agent) throw new Error(`agente não encontrado: ${call.agentId}`)

  // (1) AUTHORISE FIRST. A stale version or a tampered document can carry any
  // sectorId; it is re-resolved in THIS run's account before anything is spent.
  let verifiedSectorId: ObjectId | null = null
  if (call.sectorId) {
    verifiedSectorId = await deps.resolveOwnedSectorId(ctx.ownerId, call.sectorId)
    if (!verifiedSectorId) throw new RoutineConfigurationError()
  }

  /**
   * (1b) O TIPO decide, antes de qualquer gasto.
   *
   * Tudo abaixo — buscar na base, resolver o modelo, carregar a chave, montar as
   * ferramentas — existe para uma chamada a provedor. Um agente de função não faz nenhuma
   * dessas coisas: ele recebe campos e roda código. Passá-lo por aqui era pagar a
   * preparação inteira de uma inferência para depois pedir ao modelo que IMPROVISASSE o
   * que a função faria — e a rotina entregava uma resposta plausível, em prosa, que nunca
   * tocou o código configurado.
   *
   * O desvio vem antes da busca de propósito: base, chave e modelo não são só inúteis
   * aqui, são a conta que não devia existir.
   */
  const contrato = agentContractOf(agent)
  if (contrato.executorKind !== 'llm') {
    return executarPassoPorDespacho(agent, contrato, call, ctx, deps, tracker, sleep)
  }

  // (2) Grounding + model. The question includes the objective, the instructions AND
  // the input — serialized when it is an object, which used to retrieve nothing.
  const knowledgeQuery = buildRetrievalQuery({ objective: agent.objective ?? call.objective, instructions: call.instructions, input: call.input })
  if (knowledgeQuery) tracker.report('reading_knowledge')
  const retrieved = knowledgeQuery
    ? await deps.retrieveContext(agent, knowledgeQuery, {
        verifiedSectorId,
        ownerId: ctx.ownerId,
        // A execução da rotina é o `runId`: é por ele que a tela de execução encontra o
        // que foi lido, e é ele que a análise de impacto conta como uso real.
        executionId: ctx.runId,
        requireGrounding: Boolean(agent.requireGrounding),
      })
    : { context: [], failed: false, status: 'no_base' }
  const grounding = (retrieved.status as string | undefined) ?? (retrieved.failed ? 'unavailable' : retrieved.context.length ? 'ok' : 'empty')
  // An agent told to answer only from curated knowledge does NOT answer when the base
  // could not be consulted. Nothing is invented, and nothing is spent.
  if (agent.requireGrounding && grounding !== 'ok') {
    // Stopped by a rule, not by an error: the map says blocked BEFORE the throw, so
    // the state cannot lose a race with the error path.
    await tracker.reportNow('blocked')
    throw new KnowledgeUnavailableError(
      grounding === 'unavailable' ? 'a base de conhecimento não pôde ser consultada' : 'nenhum trecho relevante foi encontrado na base',
    )
  }
  /**
   * PROCURAR na web — o mesmo passo do setor, do canal e do teste.
   *
   * Ele não existia aqui. Uma rotina de pesquisador com a busca ligada rodava todo dia
   * respondendo com o que já estava guardado, e o resultado ficava mais velho a cada
   * execução sem nada indicar isso — que é o oposto do que uma rotina de pesquisa existe
   * para fazer.
   *
   * Depois da base e antes do modelo: é a resposta da base que decide se vale procurar.
   */
  const evidenciasDaWeb: string[] = []
  if (capabilitiesOf(agent).webSearch && knowledgeQuery) {
    const achado = await gatherWebEvidence(
      agent,
      ctx.ownerId,
      knowledgeQuery,
      {
        grounding,
        passages: retrieved.context.length,
        sourceOrigins: (retrieved.sources ?? []).map((f) => (f as { origin?: string }).origin),
        topScore: (retrieved as { topScore?: number }).topScore,
        passageTexts: retrieved.context,
      },
      { rememberSearchPages: deps.rememberSearchPages, report: (e) => tracker.report(e) },
    )
    evidenciasDaWeb.push(...achado.evidence)
  }

  // Each tool reports when it starts and when it hands control back.
  const tools = instrumentTools(await deps.resolveTools(agent, ctx.ownerId), tracker)
  const apiKey = await deps.apiKeyFor(ctx.ownerId, agent.provider)

  const startedAt = new Date()
  const eventKey = deps.eventKeyFor(ctx.runId, call.stepId, agent._id.toString())
  const baseEvent = {
    eventKey,
    ownerId: ctx.ownerId,
    agentId: agent._id,
    buildingId: ctx.buildingId,
    floorId: ctx.floorId,
    source: 'routine' as const,
    preset: agent.preset,
    startedAt,
    // Drives per-attempt idempotency: a redelivered write of the SAME attempt does
    // not inflate the accumulators; a real retry does.
    attemptCount: call.attempt,
    // Safe scalars only: counts and statuses, never a prompt, a passage or an output.
    // The request this participation belongs to, so the building's number is not the
    // sum of its agents'.
    rootExecutionId: ctx.rootExecutionId ?? null,
    metadata: {
      runId: ctx.runId,
      stepId: call.stepId,
      attempt: call.attempt,
      grounding,
      ragChunks: retrieved.context.length,
      // How many DISTINCT documents backed the answer — a count, never a title.
      ragSources: new Set((retrieved.sources ?? []).map((s) => s.documentId).filter(Boolean)).size,
      toolsAvailable: 0,
      // Os parâmetros que este modelo não aceitou. Preenchido abaixo, quando houver.
      runConfigDropped: '',
    },
  }

  // The routine's own choice, then the agent's default, then text.
  const outputFormat = call.format ?? agent.defaultOutputFormat ?? 'text'
  // Automação: nunca stream, e o paralelismo depende do risco das ferramentas desta
  // execução.
  const execucao = resolveAgentRun(agent, { context: 'automation', toolRisks: tools.map((t) => t.risk ?? 'write') })
  baseEvent.metadata.toolsAvailable = tools.length
  /**
   * Os parâmetros que o modelo não aceitou, para o dono entender por que a escolha dele
   * não teve efeito.
   *
   * Só o par campo/motivo, os dois gerados por este código — nunca prompt, contexto,
   * resposta, chave ou credencial. Um diagnóstico que carrega conteúdo vira um vazamento
   * com outro nome.
   */
  baseEvent.metadata.runConfigDropped = execucao.runConfig.dropped.map((d) => `${d.field}: ${d.reason}`).join('; ')

  let result: AgentExecutionResult
  try {
    result = await deps.runTask({
      objective: String(agent.objective ?? call.objective ?? ''),
      input: call.input,
      // Step outputs + curated passages, both handled as untrusted data. The curated
      // ones carry a numbered reference (title + document id) so the answer can cite
      // them; the owner is never named to the model.
      // O mesmo aviso da conversa: numa rotina ninguém está olhando para conferir se o
      // número saiu do documento certo.
      context: [
        ...call.context,
        // O que a busca trouxe entra junto do resto, como dado não confiável — igual às
        // passagens da base.
        ...evidenciasDaWeb,
        ...(multiSourceNotice(retrieved.sources ?? []) ? [multiSourceNotice(retrieved.sources ?? [])!] : []),
        ...formatContextWithSources(retrieved.context, retrieved.sources ?? []),
      ],
      provider: agent.provider,
      // Resolvido: "Automático" guarda um marcador, não um id de modelo.
      model: execucao.model,
      apiKey,
      tools,
      // What the agent promised to receive and produce reaches the model now.
      contracts: { input: agent.inputContract, output: agent.outputContract },
      // Função e limites, em blocos próprios: a ordem no prompt do sistema é o que
      // impede um objetivo mal redigido de enfraquecer as regras que vêm antes dele.
      definition: { role: agent.role ?? null, constraints: agent.constraints ?? null },
      // Instruções operacionais do agente entram ANTES das da etapa: elas valem para
      // todo trabalho dele, e a etapa é o pedido específico.
      instructions: [agent.instructions?.trim(), call.instructions?.trim()].filter(Boolean).join('\n\n'),
      // A MESMA configuração que o Playground e o canal resolvem — a partir do mesmo
      // resolvedor, com o risco das ferramentas já conhecidas.
      runConfig: execucao.runConfig,
      // Sem isto o runtime caía no padrão `true` e perdia o `promptCaching: false` de
      // quem desligou o cache de propósito.
      enableCaching: execucao.enableCaching,
      // The step's own format wins; the agent's default is the fallback for a step
      // that never expressed one. The schema only applies to JSON.
      output: { format: outputFormat, jsonSchema: outputFormat === 'json' ? (agent.outputJsonSchema ?? null) : null },
      progress: (state, detail) => tracker.report(state, detail),
    })
  } catch (error) {
    const kind = (error as { kind?: string }).kind
    const canceled = deps.isCanceled ? await deps.isCanceled().catch(() => false) : false
    const status: AgentEventStatus = canceled ? 'canceled' : kind === 'timeout' ? 'timeout' : 'failed'
    // Every ending is terminal on the map — timeout and cancellation included.
    await tracker.finish(canceled ? 'canceled' : 'failed')
    // Awaited too: a failed attempt must be visible before the runner moves on.
    await persistWithRetry('finalizeAgentEvent', () => deps.finalizeEvent({ ...baseEvent, status, finishedAt: new Date() }), sleep)
    throw error
  }

  // (3) CRITICAL PERSISTENCE — started here, awaited by the runner OUTSIDE the step
  // timeout. Idempotent (charge per attempt, telemetry per attempt) and it never
  // rejects, so a slow or failing database is never read as a failed inference.
  const settle = (async () => {
    const charged = await persistWithRetry(
      'recordReplyUsageOnce',
      () => deps.charge(ctx.ownerId, result.usage, deps.chargeKeyFor(ctx.runId, call.stepId, agent._id.toString(), call.attempt)),
      sleep,
    )
    const recorded = await persistWithRetry(
      'finalizeAgentEvent',
      () =>
        deps.finalizeEvent({
          ...baseEvent,
          status: 'succeeded' as AgentEventStatus,
          finishedAt: new Date(),
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          // Resolvido, e não `agent.model`: com "Automático" o campo guardado é um marcador.
          model: execucao.model,
          toolCalls: result.toolCalls.filter((c) => c.ok).length, // completed tool calls only
          metadata: {
            ...baseEvent.metadata,
            // The shape that was asked for and whether it had to be corrected —
            // never the answer itself.
            outputFormat,
            outputValid: result.format?.valid !== false,
            outputRepaired: result.format?.repaired === true,
            toolsExecuted: result.toolCalls.filter((c) => c.ok).length,
            durationMs: Date.now() - startedAt.getTime(),
          },
        }),
      sleep,
    )
    return charged && recorded
  })()

  await tracker.finish('completed')
  return { output: result.output, usage: result.usage, settle }
}
