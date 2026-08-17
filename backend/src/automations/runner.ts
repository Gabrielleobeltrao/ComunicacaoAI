import { renderTemplate } from './transform.js'
import { dedupeItems, filterByWindow, parseRssItems } from './sources.js'
import { detectHttpChange, detectRssChange, normalizeHttpContent, pareceFeed, sourceFingerprint } from './sourceChange.js'
import { evaluateCondition } from './conditions.js'
import { executionModeOf, modeNeverUsesAI, stepUsesAI } from './types.js'
import type { AutomationDefinition, ExecutionMode, StepDefinition, StepType } from './types.js'

// Transport-agnostic linear runner for an automation definition. It contains NO
// Redis/Mongo/queue code: IO is injected (fetch/agent/deliver), so it is fully
// unit-testable now; the worker (Phase 4) will call it with real adapters and
// persist the resulting records. Steps run in order, each output is exposed to
// later steps by id, and cancellation is checked cooperatively between steps.

export interface FetchResult {
  body: string
  contentType: string
}
export interface AgentCall {
  objective: string
  instructions: string
  input: unknown
  context: string[]
  format: 'text' | 'markdown' | 'json'
  agentId: string
  stepId: string // the run step — part of the telemetry idempotency key
  attempt: number // 1-based; a retry charges separately but stays ONE logical event
  // EXPLICIT sector context for knowledge retrieval. Absent = the routine reads only
  // the agent's own base (an agent's home sector never grounds a run implicitly).
  sectorId?: string | null
}
export interface DeliverCall {
  connectionId: string
  destination: string
  subject: string
  content: string
}

export interface StepUsage {
  inputTokens: number
  outputTokens: number
}

/**
 * O que a fonte já viu, quem está olhando para ela agora, e como registrar.
 *
 * Opcional de propósito: uma rotina sem fonte — que é a esmagadora maioria das que
 * existem hoje — não passa nada disto, e o runner se comporta exatamente como
 * antes. Quando está presente, o passo de fonte deixa de ser "buscar" e passa a ser
 * "buscar o que mudou, se ninguém já estiver buscando".
 *
 * `advance` NÃO é chamado dentro do passo quando há o que entregar. O runner guarda
 * o avanço e só o aplica se a execução inteira terminar bem — se a LLM falhar ou a
 * entrega falhar, o próximo ciclo reprocessa o mesmo conteúdo. Entregar duas vezes
 * é recuperável; perder uma notícia, não.
 *
 * A exceção é a linha de base: quando a fonte é nova e NÃO há o que entregar, o
 * avanço acontece na hora. Não há nada a perder — nenhuma etapa vai rodar — e sem
 * isso o feed inteiro seria relido como novo na volta seguinte.
 */
export interface SourceState {
  /**
   * Esta fonte ainda é a que a rotina publica?
   *
   * Perguntado ANTES de qualquer coisa: antes de buscar, antes de tocar no
   * checkpoint. Uma execução enfileirada há uma hora carrega a fonte de uma hora
   * atrás; se o dono trocou a URL no meio, ela não pode nem consultar o endereço
   * antigo — e muito menos redefinir o checkpoint da fonte nova para ele.
   */
  isCurrent: (fingerprint: string) => Promise<boolean>
  // Registra a consulta e devolve o estado da fonte, recomeçando se ela mudou.
  begin: (stepId: string, fingerprint: string) => Promise<{ seenKeys: string[]; contentHash: string | null; initialized: boolean }>
  acquire: (stepId: string, fingerprint: string) => Promise<boolean>
  release: (stepId: string, fingerprint: string) => Promise<void>
  advance: (
    stepId: string,
    fingerprint: string,
    // `baseline`: registra o que existia na estreia, sem nada ter sido entregue.
    avanco: { novasChaves?: string[]; contentHash?: string | null; baseline?: boolean },
  ) => Promise<void>
}

/**
 * A verificação terminou sem nada para processar. Não é erro e não é falha.
 *
 * `no_change` é o resultado esperado da maioria das verificações de um
 * monitoramento. `skipped_concurrent` é outra coisa: havia o que fazer, mas outra
 * execução já estava fazendo — desistir é o certo, e chamar isso de erro encheria
 * a tela de alarme falso.
 */
export class SourceHalt {
  constructor(
    public readonly outcome: 'no_change' | 'skipped_concurrent' | 'skipped_stale',
    public readonly reason: string,
  ) {}
}

/**
 * As operações de memória, injetadas como todo o resto do IO deste runner.
 *
 * Nenhuma delas chama modelo. Estão aqui, e não dentro do runner, pela mesma razão
 * de `fetchUrl`: o runner precisa ser testável sem banco, e quem resolve permissão
 * e destino é a camada de fora.
 */
export interface MemoryOps {
  write: (cfg: Record<string, unknown>, valor: unknown, stepId: string) => Promise<{ outcome: string; recordId: string; scopeKey: string }>
  search: (cfg: Record<string, unknown>, valor: unknown) => Promise<{ items: unknown[]; total: number }>
  remove: (cfg: Record<string, unknown>, valor: unknown) => Promise<{ deleted: number }>
}

export interface RunnerDeps {
  fetchUrl: (url: string, opts?: { contentTypeAllowlist?: string[]; requireOk?: boolean }) => Promise<FetchResult>
  // Presente só em rotinas de monitoramento.
  sourceState?: SourceState
  // Presente quando a definição tem alguma etapa de memória.
  memory?: MemoryOps
  /**
   * Executa uma ação de App. Presente quando a definição tem `app.execute`.
   *
   * Injetado como todo o resto do IO — e, do lado de fora, é o MESMO executor que
   * monta as ferramentas do modelo. Não há caminho alternativo.
   */
  runApp?: (cfg: Record<string, unknown>, valor: unknown) => Promise<unknown>
  // Returns the model usage so it reaches the step record and the run total, plus an
  // optional `settle`: the accounting/telemetry that is still finishing. The runner
  // awaits it OUTSIDE the step timeout, so a slow database can never be mistaken for
  // a slow inference (which would retry the step and pay for a second call).
  runAgent: (call: AgentCall) => Promise<{ output: string; usage?: StepUsage; settle?: Promise<unknown> }>
  deliver: (call: DeliverCall) => Promise<{ providerMessageId: string | null }>
  now: () => number
  isCanceled?: () => boolean | Promise<boolean>
}

export type StepStatus = 'succeeded' | 'failed' | 'skipped' | 'canceled'
export interface StepRecord {
  stepId: string
  stepType: StepType
  status: StepStatus
  attempts: number
  output?: unknown
  errorKind?: string
  errorMessage?: string
  // Real model consumption of this step, summed across its attempts.
  usage?: StepUsage
}
export interface RunOutcome {
  status: 'succeeded' | 'failed' | 'canceled'
  /**
   * Como a fonte encerrou a execução, quando ela encerrou.
   *
   * Fica separado de `status` porque nenhum dos dois é um desfecho diferente: são
   * sucessos com zero token. A interface precisa distinguir para não fazer uma
   * rotina saudável parecer parada nem um desvio de concorrência parecer defeito.
   */
  sourceOutcome?: 'no_change' | 'skipped_concurrent' | 'skipped_stale'
  // Como esta execução foi processada, e se ela chegou a falar com um modelo.
  // `usedAI: false` com `usage` zerado é o que prova, no histórico, que o modo sem
  // IA cumpriu o que promete.
  executionMode: ExecutionMode
  usedAI: boolean
  steps: StepRecord[]
  finalOutput: string
  context: Record<string, unknown>
  // Sum of every step's usage — what the run persists as automation_runs.usage.
  usage: StepUsage
}

// A step failure with an explicit retryability classification. Transient errors
// (network/provider/timeout) may retry; validation/config errors fail fast.
export class StepError extends Error {
  constructor(
    readonly kind: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'StepError'
  }
}

function strip(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!ms || ms <= 0) return p
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StepError('timeout', `step exceeded ${ms}ms`, true)), ms)
    if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

const delay = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve())

// Flatten prior step outputs to string vars for template rendering.
function templateVars(ctx: Record<string, unknown>): Record<string, unknown> {
  const vars: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(ctx)) vars[k] = typeof v === 'string' ? v : JSON.stringify(v)
  return vars
}

async function executeStep(
  step: StepDefinition,
  ctx: Record<string, unknown>,
  deps: RunnerDeps,
  attempt = 1,
  usageSink?: StepUsage,
  settleSink?: Promise<unknown>[],
  // Avanços de checkpoint acumulados; aplicados pelo runner só no fim, e só se a
  // execução inteira der certo.
  pendingAdvance?: { stepId: string; fingerprint: string; avanco: { novasChaves?: string[]; contentHash?: string | null; baseline?: boolean } }[],
  // Leases tomados nesta execução, para o runner devolver todos no fim — dê certo
  // ou não.
  leaseSink?: { stepId: string; fingerprint: string }[],
): Promise<unknown> {
  const cfg = step.config
  switch (step.type as StepType) {
    case 'source.rss': {
      const url = String(cfg.url)
      const windowMs = Number(cfg.windowMs ?? 24 * 3600 * 1000)

      // Sem estado de fonte: comportamento antigo, intacto. É por aqui que passam as
      // definições que já existiam antes do monitoramento existir — e é o que
      // preserva a reprodutibilidade de uma execução que não monitora nada: ela roda
      // o snapshot dela, ponto.
      if (!deps.sourceState) {
        const { body } = await deps.fetchUrl(url, { contentTypeAllowlist: ['xml', 'rss', 'atom', 'text'] }).catch((e) => {
          throw new StepError('fetch', (e as Error).message, true)
        })
        return filterByWindow(dedupeItems(parseRssItems(body)), windowMs, deps.now())
      }

      const fingerprint = sourceFingerprint('rss', url, typeof cfg.instanceId === 'string' ? cfg.instanceId : null)
      if (!(await deps.sourceState.isCurrent(fingerprint))) {
        return new SourceHalt('skipped_stale', 'a fonte desta rotina mudou depois que esta execução foi enfileirada')
      }

      const { body } = await deps
        .fetchUrl(url, { contentTypeAllowlist: ['xml', 'rss', 'atom', 'text'], requireOk: true })
        .catch((e) => {
          throw new StepError('fetch', (e as Error).message, true)
        })

      // Uma página de login, um erro em HTML ou um "em manutenção" respondem 200 com
      // zero item. Tratar isso como "feed vazio, nada novo" faria a rotina ficar
      // calada para sempre jurando que está tudo bem. Um feed legítimo e realmente
      // vazio tem raiz de feed e passa aqui.
      if (!pareceFeed(body)) {
        throw new StepError('source', 'A resposta não é um feed RSS ou Atom.', true)
      }

      const { seenKeys, initialized } = await deps.sourceState.begin(step.id, fingerprint)
      const mudanca = detectRssChange(body, seenKeys, windowMs, deps.now(), initialized)

      if (!mudanca.changed) {
        // Nada a entregar. Se a fonte é nova, a linha de base é gravada AGORA: não
        // há etapa nenhuma para falhar depois, e sem isso o feed inteiro voltaria
        // como novo — com a janela já não valendo mais.
        if (mudanca.novasChaves.length || !initialized) {
          await deps.sourceState.advance(step.id, fingerprint, { novasChaves: mudanca.novasChaves, baseline: true })
        }
        return new SourceHalt('no_change', 'nenhum item novo no feed')
      }

      if (!(await deps.sourceState.acquire(step.id, fingerprint))) {
        return new SourceHalt('skipped_concurrent', 'outra verificação desta fonte já está em andamento')
      }
      leaseSink?.push({ stepId: step.id, fingerprint })

      pendingAdvance?.push({ stepId: step.id, fingerprint, avanco: { novasChaves: mudanca.novasChaves } })
      return mudanca.novos
    }
    case 'source.http': {
      const url = String(cfg.url)
      if (!deps.sourceState) {
        const { body, contentType } = await deps.fetchUrl(url).catch((e) => {
          throw new StepError('fetch', (e as Error).message, true)
        })
        return contentType.includes('html') ? strip(body) : body
      }

      const fingerprint = sourceFingerprint('http', url, typeof cfg.instanceId === 'string' ? cfg.instanceId : null)
      if (!(await deps.sourceState.isCurrent(fingerprint))) {
        return new SourceHalt('skipped_stale', 'a fonte desta rotina mudou depois que esta execução foi enfileirada')
      }

      const { body, contentType } = await deps.fetchUrl(url, { requireOk: true }).catch((e) => {
        throw new StepError('fetch', (e as Error).message, true)
      })

      // 2xx com corpo que não sobra nada depois de tirar a marcação: quase sempre
      // uma página que só monta no navegador, que aqui não roda. Comparar hash de
      // vazio com hash de vazio diria "não mudou" para sempre; mandar vazio para a
      // LLM gastaria tokens com nada. As duas saídas são piores que dizer o que
      // aconteceu.
      if (!normalizeHttpContent(body, contentType)) {
        throw new StepError(
          'source',
          'A resposta chegou vazia depois de remover a marcação. Esta página pode depender de JavaScript, que não é executado aqui.',
          false,
        )
      }

      const { contentHash, initialized } = await deps.sourceState.begin(step.id, fingerprint)
      const mudanca = detectHttpChange(body, contentType, contentHash, initialized)
      if (!mudanca.changed) return new SourceHalt('no_change', 'o conteúdo não mudou desde a última verificação')

      if (!(await deps.sourceState.acquire(step.id, fingerprint))) {
        return new SourceHalt('skipped_concurrent', 'outra verificação desta fonte já está em andamento')
      }
      leaseSink?.push({ stepId: step.id, fingerprint })

      pendingAdvance?.push({ stepId: step.id, fingerprint, avanco: { contentHash: mudanca.contentHash } })
      return mudanca.conteudo
    }
    case 'app.execute': {
      if (!deps.runApp) throw new StepError('validation', 'execução de App não disponível nesta execução', false)
      const valor = (step.dependsOn ?? []).length ? ctx[(step.dependsOn ?? [])[0]] : ctx.input
      // Uma recusa da camada de Apps (conexão revogada, ação não concedida) vem como
      // exceção e falha a etapa — deixar passar faria o fluxo seguir como se a ação
      // tivesse acontecido. Não é transitória: reconectar é coisa de gente.
      return deps.runApp(cfg, valor).catch((e) => {
        throw new StepError('app', (e as Error).message, false)
      })
    }
    // As três etapas de memória. Determinísticas: banco, e nada além disso.
    case 'memory.write': {
      if (!deps.memory) throw new StepError('validation', 'memória não disponível nesta execução', false)
      const valor = (step.dependsOn ?? []).length ? ctx[(step.dependsOn ?? [])[0]] : ctx.input
      return deps.memory.write(cfg, valor, step.id)
    }
    case 'memory.search': {
      if (!deps.memory) throw new StepError('validation', 'memória não disponível nesta execução', false)
      const valor = (step.dependsOn ?? []).length ? ctx[(step.dependsOn ?? [])[0]] : ctx.input
      return deps.memory.search(cfg, valor)
    }
    case 'memory.delete': {
      if (!deps.memory) throw new StepError('validation', 'memória não disponível nesta execução', false)
      const valor = (step.dependsOn ?? []).length ? ctx[(step.dependsOn ?? [])[0]] : ctx.input
      return deps.memory.remove(cfg, valor)
    }
    case 'agent.execute': {
      const context = (step.dependsOn ?? []).map((id) => `Etapa ${id}:\n${JSON.stringify(ctx[id])}`)
      const res = await deps
        .runAgent({
          agentId: String(cfg.agentId),
          objective: String(cfg.objective ?? ''),
          instructions: String(cfg.instruction),
          input: step.dependsOn?.length ? ctx[step.dependsOn[0]] : undefined,
          context,
          format: (cfg.format as 'text' | 'markdown' | 'json') ?? 'markdown',
          stepId: step.id,
          attempt,
          sectorId: typeof cfg.sectorId === 'string' ? cfg.sectorId : null,
        })
        .catch((e) => {
          const kind = (e as { kind?: string }).kind ?? 'provider'
          throw new StepError(kind, (e as Error).message, kind === 'timeout' || kind === 'provider')
        })
      // Usage flows up: step record → run total → owner accounting.
      if (usageSink && res.usage) {
        usageSink.inputTokens += res.usage.inputTokens
        usageSink.outputTokens += res.usage.outputTokens
      }
      // Accounting still in flight: hand it to the runner, which waits for it after
      // the timeout window has closed.
      if (settleSink && res.settle) settleSink.push(res.settle)
      return res.output
    }
    case 'transform.template': {
      try {
        return renderTemplate(String(cfg.template), templateVars(ctx))
      } catch (e) {
        throw new StepError('validation', (e as Error).message, false)
      }
    }
    case 'delivery.send': {
      const fromStepId = String(cfg.fromStepId)
      const content = typeof ctx[fromStepId] === 'string' ? (ctx[fromStepId] as string) : JSON.stringify(ctx[fromStepId])
      const res = await deps
        .deliver({
          connectionId: String(cfg.connectionId),
          destination: String(cfg.destination ?? ''),
          subject: String(cfg.subject ?? 'Resultado da automação'),
          content,
        })
        .catch((e) => {
          throw new StepError('delivery', (e as Error).message, true)
        })
      return { delivered: true, providerMessageId: res.providerMessageId }
    }
    default:
      throw new StepError('validation', `unknown step type: ${String(step.type)}`, false)
  }
}

export async function runDefinition(def: AutomationDefinition, deps: RunnerDeps, input?: unknown): Promise<RunOutcome> {
  const ctx: Record<string, unknown> = { input }
  const steps: StepRecord[] = []
  let finalOutput = ''
  let canceled = false
  let halt: SourceHalt | null = null
  const executionMode = executionModeOf(def)
  // Vira `true` no instante em que uma etapa de IA de fato roda — não quando ela
  // existe na definição. Uma etapa de agente pulada por condição não usou IA.
  let usedAI = false
  const runUsage: StepUsage = { inputTokens: 0, outputTokens: 0 }
  // Avanços de checkpoint pendentes: aplicados no fim, e SÓ se tudo deu certo.
  const pendingAdvance: { stepId: string; fingerprint: string; avanco: { novasChaves?: string[]; contentHash?: string | null; baseline?: boolean } }[] = []
  // Fontes tomadas por esta execução. Devolvidas no `finally`, aconteça o que
  // acontecer: se ficassem só no caminho feliz, uma falha travaria a rotina até o
  // lease expirar.
  const leases: { stepId: string; fingerprint: string }[] = []

  try {
    for (const step of def.steps) {
      if (!step.enabled) {
        steps.push({ stepId: step.id, stepType: step.type, status: 'skipped', attempts: 0 })
        continue
      }
      /**
       * A porteira que não pode ser furada: num modo sem IA, uma etapa de agente
       * nunca roda.
       *
       * O compilador já não gera essa etapa nesses modos. Isto aqui é a segunda
       * tranca, para uma definição vinda de outro caminho — importada, editada à
       * mão, criada por uma versão anterior — não gastar token de quem escolheu
       * explicitamente não gastar.
       */
      if (stepUsesAI(step.type) && modeNeverUsesAI(executionMode)) {
        steps.push({ stepId: step.id, stepType: step.type, status: 'skipped', attempts: 0 })
        continue
      }

      // A condição do modo híbrido/automático. Falsa: a etapa não roda, e se ela era
      // a da IA, nenhum token é gasto. A avaliação é pura — nada de perguntar a um
      // modelo se vale a pena chamar o modelo.
      if (step.runIf && !evaluateCondition(step.runIf, ctx)) {
        steps.push({ stepId: step.id, stepType: step.type, status: 'skipped', attempts: 0 })
        continue
      }

      if (await deps.isCanceled?.()) {
        steps.push({ stepId: step.id, stepType: step.type, status: 'canceled', attempts: 0 })
        canceled = true
        continue
      }

      const maxAttempts = Math.max(1, step.retryPolicy?.maxAttempts ?? 1)
      const backoff = step.retryPolicy?.backoffMs ?? 0
      let attempt = 0
      let done = false
      // Usage accumulates across this step's attempts — a retry really did consume
      // tokens, so the run total reflects it.
      const stepUsage: StepUsage = { inputTokens: 0, outputTokens: 0 }
      // Accounting handed back by agent.execute; awaited OUTSIDE the timeout below.
      const settlePending: Promise<unknown>[] = []
      for (;;) {
        attempt++
        try {
          // The timeout guards the EXTERNAL work only (the model call / fetch /
          // delivery). Every other step type keeps its timeout unchanged.
          const output = await withTimeout(
            executeStep(step, ctx, deps, attempt, stepUsage, settlePending, pendingAdvance, leases),
            step.timeoutMs ?? 0,
          )
          // The inference succeeded: from here on nothing may cause another one, so the
          // accounting finishes without any timeout over it.
          if (settlePending.length) await Promise.allSettled(settlePending.splice(0))
          // A fonte encerrou a execução: ou não havia nada novo, ou outra execução já
          // estava cuidando disto. Daqui para baixo não roda nada — nenhuma
          // inferência, nenhuma entrega, zero token. E não é retry: a resposta está
          // correta, não há o que tentar de novo.
          if (output instanceof SourceHalt) {
            steps.push({
              stepId: step.id,
              stepType: step.type,
              status: 'succeeded',
              attempts: attempt,
              output: { outcome: output.outcome, reason: output.reason },
              usage: { ...stepUsage },
            })
            halt = output
            done = true
            break
          }
          if (stepUsesAI(step.type)) usedAI = true
          ctx[step.id] = output
          if (typeof output === 'string') finalOutput = output
          steps.push({ stepId: step.id, stepType: step.type, status: 'succeeded', attempts: attempt, output, usage: { ...stepUsage } })
          done = true
          break
        } catch (error) {
          const retryable = error instanceof StepError ? error.retryable : true
          const kind = error instanceof StepError ? error.kind : 'unknown'
          if (attempt < maxAttempts && retryable) {
            await delay(backoff)
            continue
          }
          // A step that failed may still have a settle in flight (a retried attempt
          // that succeeded earlier); let it finish before moving on.
          if (settlePending.length) await Promise.allSettled(settlePending.splice(0))
          steps.push({
            stepId: step.id,
            stepType: step.type,
            status: 'failed',
            attempts: attempt,
            errorKind: kind,
            errorMessage: (error as Error).message,
            usage: { ...stepUsage },
          })
          break
        }
      }
      runUsage.inputTokens += stepUsage.inputTokens
      runUsage.outputTokens += stepUsage.outputTokens
      if (!done && !step.continueOnError) {
        // Falhou: o checkpoint NÃO avança. O próximo ciclo reprocessa o mesmo
        // conteúdo, que é o comportamento seguro.
        return { status: 'failed', executionMode, usedAI, steps, finalOutput, context: ctx, usage: runUsage }
      }
      // A fonte encerrou: o resto da rotina não tem o que fazer.
      if (halt) break
    }

    // As etapas que nem chegaram a ser tentadas ficam registradas como puladas, para
    // o histórico não parecer truncado.
    if (halt) {
      const executadas = new Set(steps.map((s) => s.stepId))
      for (const step of def.steps) {
        if (!executadas.has(step.id)) steps.push({ stepId: step.id, stepType: step.type, status: 'skipped', attempts: 0 })
      }
    }

    if (canceled) return { status: 'canceled', executionMode, usedAI, steps, finalOutput, context: ctx, usage: runUsage }

    // Chegou aqui: nada falhou. Só AGORA o checkpoint avança — depois da inferência e
    // da entrega, não antes.
    //
    // E não avança quando a fonte encerrou: se uma definição tiver duas fontes e a
    // segunda não tiver novidade, o que a primeira trouxe não chegou a ser
    // processado. Avançar ali perderia esse conteúdo. Uma rotina montada pela
    // interface só tem uma fonte, então na prática esta lista já vem vazia — a
    // guarda é para o runner, que é genérico.
    if (deps.sourceState && !halt) {
      for (const { stepId, fingerprint, avanco } of pendingAdvance) await deps.sourceState.advance(stepId, fingerprint, avanco)
    }
    if (halt) return { status: 'succeeded', sourceOutcome: halt.outcome, executionMode, usedAI, steps, finalOutput, context: ctx, usage: runUsage }
    const anyFailed = steps.some((s) => s.status === 'failed')
    return { status: anyFailed ? 'failed' : 'succeeded', executionMode, usedAI, steps, finalOutput, context: ctx, usage: runUsage }
  } finally {
    for (const { stepId, fingerprint } of leases) {
      await deps.sourceState?.release(stepId, fingerprint).catch(() => undefined)
    }
  }
}
