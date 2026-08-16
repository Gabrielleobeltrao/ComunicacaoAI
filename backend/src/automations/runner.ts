import { renderTemplate } from './transform.js'
import { dedupeItems, filterByWindow, parseRssItems } from './sources.js'
import { detectHttpChange, detectRssChange } from './sourceChange.js'
import type { AutomationDefinition, StepDefinition, StepType } from './types.js'

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
 * O que a fonte já viu, e como registrar o que ela viu agora.
 *
 * Opcional de propósito: uma rotina sem fonte — que é a esmagadora maioria das que
 * existem hoje — não passa nada disto, e o runner se comporta exatamente como
 * antes. Quando está presente, o passo de fonte deixa de ser "buscar" e passa a ser
 * "buscar o que mudou".
 *
 * `advance` NÃO é chamado aqui dentro do passo. O runner guarda o avanço e só o
 * aplica se a execução inteira terminar bem — se a LLM falhar ou a entrega falhar,
 * o próximo ciclo reprocessa o mesmo conteúdo. Entregar duas vezes é recuperável;
 * perder uma notícia, não.
 */
export interface SourceState {
  read: (stepId: string) => Promise<{ seenKeys: string[]; contentHash: string | null }>
  checked: (stepId: string) => Promise<void>
  advance: (stepId: string, avanco: { novasChaves?: string[]; contentHash?: string | null }) => Promise<void>
}

/**
 * "Consultei a fonte e não havia nada novo."
 *
 * Não é erro e não é falha: é o resultado esperado da maioria das verificações de
 * um monitoramento. O runner reconhece este valor, pula o resto das etapas — nenhuma
 * LLM, nenhuma entrega — e encerra a execução como sucesso sem alteração.
 */
export class NoChange {
  constructor(public readonly reason: string) {}
}

export interface RunnerDeps {
  fetchUrl: (url: string, opts?: { contentTypeAllowlist?: string[] }) => Promise<FetchResult>
  // Presente só em rotinas de monitoramento.
  sourceState?: SourceState
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
  // Sucesso SEM alteração: a fonte foi consultada e não havia nada novo. Fica
  // separado de `status` porque não é um desfecho diferente — é um sucesso com
  // zero token, e a interface precisa saber distinguir para não parecer parada.
  noChange?: boolean
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
  pendingAdvance?: { stepId: string; avanco: { novasChaves?: string[]; contentHash?: string | null } }[],
): Promise<unknown> {
  const cfg = step.config
  switch (step.type as StepType) {
    case 'source.rss': {
      const { body } = await deps.fetchUrl(String(cfg.url), { contentTypeAllowlist: ['xml', 'rss', 'atom', 'text'] }).catch((e) => {
        throw new StepError('fetch', (e as Error).message, true)
      })
      const windowMs = Number(cfg.windowMs ?? 24 * 3600 * 1000)

      // Sem estado de fonte: comportamento antigo, intacto. É por aqui que passam as
      // definições que já existiam antes do monitoramento existir.
      if (!deps.sourceState) return filterByWindow(dedupeItems(parseRssItems(body)), windowMs, deps.now())

      await deps.sourceState.checked(step.id)
      const { seenKeys } = await deps.sourceState.read(step.id)
      const mudanca = detectRssChange(body, seenKeys, windowMs, deps.now())
      if (!mudanca.changed) return new NoChange('nenhum item novo no feed')
      pendingAdvance?.push({ stepId: step.id, avanco: { novasChaves: mudanca.novasChaves } })
      return mudanca.novos
    }
    case 'source.http': {
      const { body, contentType } = await deps.fetchUrl(String(cfg.url)).catch((e) => {
        throw new StepError('fetch', (e as Error).message, true)
      })
      if (!deps.sourceState) return contentType.includes('html') ? strip(body) : body

      await deps.sourceState.checked(step.id)
      const { contentHash } = await deps.sourceState.read(step.id)
      const mudanca = detectHttpChange(body, contentType, contentHash)
      if (!mudanca.changed) return new NoChange('o conteúdo não mudou desde a última verificação')
      pendingAdvance?.push({ stepId: step.id, avanco: { contentHash: mudanca.contentHash } })
      return mudanca.conteudo
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
  let noChange = false
  const runUsage: StepUsage = { inputTokens: 0, outputTokens: 0 }
  // Avanços de checkpoint pendentes: aplicados no fim, e SÓ se tudo deu certo.
  const pendingAdvance: { stepId: string; avanco: { novasChaves?: string[]; contentHash?: string | null } }[] = []

  for (const step of def.steps) {
    if (!step.enabled) {
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
        const output = await withTimeout(executeStep(step, ctx, deps, attempt, stepUsage, settlePending, pendingAdvance), step.timeoutMs ?? 0)
        // The inference succeeded: from here on nothing may cause another one, so the
        // accounting finishes without any timeout over it.
        if (settlePending.length) await Promise.allSettled(settlePending.splice(0))
        // A fonte disse que não há nada novo. Daqui para baixo não roda mais nada:
        // nenhuma inferência, nenhuma entrega, zero token. E não é retry — não há o
        // que tentar de novo, a resposta está correta.
        if (output instanceof NoChange) {
          steps.push({
            stepId: step.id,
            stepType: step.type,
            status: 'succeeded',
            attempts: attempt,
            output: { noChange: true, reason: output.reason },
            usage: { ...stepUsage },
          })
          noChange = true
          done = true
          break
        }
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
      return { status: 'failed', steps, finalOutput, context: ctx, usage: runUsage }
    }
    // Sem novidade na fonte: o resto da rotina não tem o que fazer.
    if (noChange) break
  }

  // As etapas que nem chegaram a ser tentadas por falta de novidade ficam
  // registradas como puladas, para o histórico não parecer truncado.
  if (noChange) {
    const executadas = new Set(steps.map((s) => s.stepId))
    for (const step of def.steps) {
      if (!executadas.has(step.id)) steps.push({ stepId: step.id, stepType: step.type, status: 'skipped', attempts: 0 })
    }
  }

  if (canceled) return { status: 'canceled', steps, finalOutput, context: ctx, usage: runUsage }

  // Chegou aqui: nada falhou. Só AGORA o checkpoint avança — depois da inferência e
  // da entrega, não antes.
  //
  // E não avança em `noChange`: se uma definição tiver duas fontes e a segunda não
  // tiver novidade, o que a primeira trouxe não chegou a ser processado. Avançar ali
  // perderia esse conteúdo para sempre. Uma rotina montada pela interface só tem uma
  // fonte, então na prática esta lista já vem vazia — a guarda é para o runner, que
  // é genérico.
  if (deps.sourceState && !noChange) {
    for (const { stepId, avanco } of pendingAdvance) await deps.sourceState.advance(stepId, avanco)
  }
  if (noChange) return { status: 'succeeded', noChange: true, steps, finalOutput, context: ctx, usage: runUsage }
  const anyFailed = steps.some((s) => s.status === 'failed')
  return { status: anyFailed ? 'failed' : 'succeeded', steps, finalOutput, context: ctx, usage: runUsage }
}
