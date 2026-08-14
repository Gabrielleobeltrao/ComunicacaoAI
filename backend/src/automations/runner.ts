import { renderTemplate } from './transform.js'
import { dedupeItems, filterByWindow, parseRssItems } from './sources.js'
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

export interface RunnerDeps {
  fetchUrl: (url: string, opts?: { contentTypeAllowlist?: string[] }) => Promise<FetchResult>
  // Returns the model usage so it reaches the step record and the run total.
  runAgent: (call: AgentCall) => Promise<{ output: string; usage?: StepUsage }>
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

async function executeStep(step: StepDefinition, ctx: Record<string, unknown>, deps: RunnerDeps, attempt = 1, usageSink?: StepUsage): Promise<unknown> {
  const cfg = step.config
  switch (step.type as StepType) {
    case 'source.rss': {
      const { body } = await deps.fetchUrl(String(cfg.url), { contentTypeAllowlist: ['xml', 'rss', 'atom', 'text'] }).catch((e) => {
        throw new StepError('fetch', (e as Error).message, true)
      })
      const windowMs = Number(cfg.windowMs ?? 24 * 3600 * 1000)
      return filterByWindow(dedupeItems(parseRssItems(body)), windowMs, deps.now())
    }
    case 'source.http': {
      const { body, contentType } = await deps.fetchUrl(String(cfg.url)).catch((e) => {
        throw new StepError('fetch', (e as Error).message, true)
      })
      return contentType.includes('html') ? strip(body) : body
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
  const runUsage: StepUsage = { inputTokens: 0, outputTokens: 0 }

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
    for (;;) {
      attempt++
      try {
        const output = await withTimeout(executeStep(step, ctx, deps, attempt, stepUsage), step.timeoutMs ?? 0)
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
      return { status: 'failed', steps, finalOutput, context: ctx, usage: runUsage }
    }
  }

  if (canceled) return { status: 'canceled', steps, finalOutput, context: ctx, usage: runUsage }
  const anyFailed = steps.some((s) => s.status === 'failed')
  return { status: anyFailed ? 'failed' : 'succeeded', steps, finalOutput, context: ctx, usage: runUsage }
}
