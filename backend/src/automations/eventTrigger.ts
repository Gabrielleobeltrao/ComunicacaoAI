// Agent EVENT TRIGGERS — the user-facing shape of "something out there happens and
// this agent reacts". Exactly like Rotinas, it is an automation underneath: a webhook
// trigger plus one agent.execute step, so the existing receiver, idempotency, queue,
// runs and accounting handle it unchanged. The user never sees the word "automação".
//
// The event payload reaches the agent through a template step, which is what the
// linear runner already does with a step's dependency — no engine change.
import { ObjectId } from 'mongodb'
import { getAgentById, ensureActivationMode } from '../agents.js'
import { createAutomation, getAutomation, publishAutomation, rotateWebhookSecret, setStatus, updateDraft } from './service.js'
import { listAutomations as repoListAutomations } from './repository.js'
import { DEFAULT_LIMITS, isExecutionMode } from './types.js'
import type { Automation, AutomationDefinition, ExecutionMode, InternalEventTrigger, OutputFormat, StepDefinition } from './types.js'
import { isEventType } from '../events/types.js'
import { isTimeframe } from '../marketData/types.js'
import { MAX_TRIGGER_SERIES, MAX_TRIGGER_SYMBOLS } from './validate.js'
import { DEFAULT_SERIES_LENGTH } from './internalEvents.js'
import {
  aiStepPlanned,
  appStep,
  describeFlow,
  emptyAppActionPlan,
  emptyMemoryPlan,
  memoryStep,
  normalizeAppActionPlan,
  normalizeMemoryPlan,
  readAppActionFromSteps,
  resolveConditionSource,
  semTrabalho,
  STEP_APP,
  STEP_MEMORY,
} from './executionPlan.js'
import type { AppActionPlan, MemoryPlan } from './executionPlan.js'
import { isConditionOperator } from './conditions.js'
import type { StepCondition } from './conditions.js'

/**
 * O gatilho ouvindo o BARRAMENTO em vez da porta pública.
 *
 * Desligado, tudo continua como sempre foi: webhook com chave e assinatura. Ligado, o
 * gatilho não tem endereço nenhum — ninguém de fora consegue dispará-lo, nem por
 * engano.
 */
export interface MarketTriggerPlan {
  enabled: boolean
  eventType: string
  /** Uma conexão específica, ou qualquer uma da conta. */
  installationId: string | null
  /** Uma assinatura específica, para os eventos que têm uma. */
  subscriptionId: string | null
  symbols: string[]
  timeframe: string | null
  /** Entregar a série fechada junto. É o que torna a análise possível sem outro passo. */
  includeSeries: boolean
  seriesLength: number
}

export const emptyMarketPlan = (): MarketTriggerPlan => ({
  enabled: false,
  eventType: 'market.candle.closed',
  installationId: null,
  subscriptionId: null,
  symbols: [],
  timeframe: null,
  includeSeries: true,
  seriesLength: DEFAULT_SERIES_LENGTH,
})

export function normalizeMarketPlan(raw: unknown): MarketTriggerPlan {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  if (p.enabled !== true) return emptyMarketPlan()
  // Tipo desconhecido desliga em vez de gravar um gatilho que nunca dispara.
  if (!isEventType(p.eventType)) return emptyMarketPlan()
  const symbols = Array.isArray(p.symbols)
    ? [...new Set(p.symbols.map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean))].slice(0, MAX_TRIGGER_SYMBOLS)
    : []
  const n = Number(p.seriesLength)
  return {
    enabled: true,
    eventType: p.eventType,
    installationId: typeof p.installationId === 'string' && p.installationId.trim() ? p.installationId.trim() : null,
    subscriptionId: typeof p.subscriptionId === 'string' && p.subscriptionId.trim() ? p.subscriptionId.trim() : null,
    symbols,
    timeframe: isTimeframe(p.timeframe) ? p.timeframe : null,
    includeSeries: p.includeSeries !== false,
    seriesLength: Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 2), MAX_TRIGGER_SERIES) : DEFAULT_SERIES_LENGTH,
  }
}

export const marketTriggerOf = (plan: MarketTriggerPlan): InternalEventTrigger => ({
  type: 'internal_event',
  eventType: plan.eventType,
  installationId: plan.installationId,
  subscriptionId: plan.subscriptionId,
  symbols: plan.symbols,
  timeframe: plan.timeframe,
  includeSeries: plan.includeSeries,
  seriesLength: plan.seriesLength,
})

/**
 * Publicar um SINAL no barramento quando o resultado merecer.
 *
 * A condição é o ponto inteiro: sem ela, toda vela fechada viraria um sinal, e um
 * sinal que acontece sempre não é sinal. Com ela, a etapa existe e não roda — e o
 * trace mostra por quê.
 */
export interface SignalPlan {
  enabled: boolean
  eventType: string
  condition: StepCondition | null
}

export const emptySignalPlan = (): SignalPlan => ({ enabled: false, eventType: 'market.signal.detected', condition: null })

export function normalizeSignalPlan(raw: unknown): SignalPlan {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  if (p.enabled !== true) return emptySignalPlan()
  if (!isEventType(p.eventType)) return emptySignalPlan()
  return { enabled: true, eventType: p.eventType, condition: normalizeCondition(p.condition) }
}

export interface EventTriggerSpec {
  name: string
  // What the agent must do with each event.
  objective: string
  outputFormat?: OutputFormat
  // Optional EXPLICIT sector context for knowledge grounding (authorised by the
  // service before the definition is stored).
  sectorId?: string | null
  // Ausente = 'ai', que é o comportamento de todo gatilho criado antes disto.
  executionMode?: ExecutionMode
  // Onde guardar o que chegou. Desligado por padrão.
  memory?: MemoryPlan
  // Quando chamar a IA nos modos híbrido e automático.
  aiCondition?: StepCondition | null
  // Uma ação de App executada direto, sem modelo. Desligada por padrão.
  action?: AppActionPlan
  // Ouvir o barramento em vez da porta pública. Desligado por padrão.
  market?: MarketTriggerPlan
  // Publicar um sinal quando a condição for verdadeira. Desligado por padrão.
  signal?: SignalPlan
}

// A condição vinda da API, saneada. Operador desconhecido some — e sem condição, os
// modos híbrido e automático não geram etapa de IA nenhuma.
export function normalizeCondition(raw: unknown): StepCondition | null {
  const c = (typeof raw === 'object' && raw !== null ? raw : null) as Record<string, unknown> | null
  if (!c || !isConditionOperator(c.operator)) return null
  return {
    source: typeof c.source === 'string' && c.source.trim() ? c.source.trim() : 'input',
    path: typeof c.path === 'string' ? c.path.trim() : '',
    operator: c.operator,
    ...(c.value !== undefined ? { value: c.value } : {}),
  }
}

// A fonte de verdade sobre o que um gatilho salvo faz: lida da definição publicada,
// porque não existe cópia da spec em lugar nenhum.
export function readEventTriggerConfig(def: AutomationDefinition | null | undefined): {
  executionMode: ExecutionMode
  memory: MemoryPlan
  aiCondition: StepCondition | null
  action: AppActionPlan
  market: MarketTriggerPlan
  signal: SignalPlan
} {
  const mode: ExecutionMode = isExecutionMode(def?.executionMode) ? def.executionMode : 'ai'
  const passoMemoria = (def?.steps ?? []).find((s) => s.id === STEP_MEMORY)
  const cfg = (passoMemoria?.config ?? {}) as Record<string, unknown>
  const memory: MemoryPlan = passoMemoria
    ? normalizeMemoryPlan({ ...cfg, enabled: true })
    : emptyMemoryPlan()
  const passoAgente = (def?.steps ?? []).find((s) => s.type === 'agent.execute')
  const passoSinal = (def?.steps ?? []).find((s) => s.id === STEP_SIGNAL && s.type === 'event.publish')
  const signal: SignalPlan = passoSinal
    ? normalizeSignalPlan({ ...(passoSinal.config ?? {}), enabled: true, condition: passoSinal.runIf ?? null })
    : emptySignalPlan()
  const trigger = def?.trigger
  const market: MarketTriggerPlan =
    trigger?.type === 'internal_event'
      ? normalizeMarketPlan({ ...trigger, enabled: true })
      : emptyMarketPlan()
  return { executionMode: mode, memory, aiCondition: passoAgente?.runIf ?? null, action: readAppActionFromSteps(def?.steps), market, signal }
}

const STEP_EVENT = 'evento'
const STEP_AGENT = 'run'
const STEP_SIGNAL = 'sinal'

export class EventTriggerError extends Error {}

// Pure: spec + owning agent → a valid AutomationDefinition with a webhook trigger.
// Signature is REQUIRED by default: an endpoint that runs an agent must not be
// callable by anyone who merely guesses the URL.
export function buildEventTriggerDefinition(spec: EventTriggerSpec, agentId: ObjectId): AutomationDefinition {
  const format = spec.outputFormat ?? 'markdown'
  const executionMode: ExecutionMode = isExecutionMode(spec.executionMode) ? spec.executionMode : 'ai'
  const memory = normalizeMemoryPlan(spec.memory)
  const condition = spec.aiCondition ?? null
  const action = normalizeAppActionPlan(spec.action)
  // Sem ação, o conteúdo do evento está em `input`. Com ação, no resultado dela.
  const conditionResolved = resolveConditionSource(condition, action.enabled ? STEP_APP : 'input')

  const steps: StepDefinition[] = [
    {
      // Carries the event body into the next step: the runner hands a step its
      // first dependency's output as `input`.
      id: STEP_EVENT,
      name: 'Evento recebido',
      type: 'transform.template',
      enabled: true,
      dependsOn: [],
      inputMapping: {},
      config: { template: '{{input}}' },
      timeoutMs: 5_000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
      continueOnError: false,
    },
  ]

  // Guardar vem antes de qualquer coisa cara. Se a IA falhar depois, o evento já
  // está salvo — perder o dado que chegou é o pior desfecho possível para um
  // recebedor de eventos.
  //
  // A ação vem ANTES de guardar: é o resultado dela que costuma valer a pena guardar,
  // não o evento cru. Ela lê o evento estruturado direto de `input`.
  if (action.enabled) steps.push(appStep(action, [], agentId))

  // Sem dependência quando não há ação: a memória quer o evento ESTRUTURADO, e a etapa
  // de template serializa para texto (é o que a IA precisa receber). Ler dali faria o
  // mapeamento de campos e o `{{pedido.id}}` da chave procurarem caminho dentro de uma
  // string.
  if (memory.enabled) steps.push(memoryStep(memory, action.enabled ? [STEP_APP] : [], agentId))

  // A etapa que gasta token só existe quando o modo pede. Num modo sem IA ela não
  // é gerada — não há flag para inverter nem passo para pular.
  if (aiStepPlanned(executionMode, condition)) {
    steps.push({
      id: STEP_AGENT,
      name: 'Executar agente',
      type: 'agent.execute',
      enabled: true,
      // O que a ação produziu, quando existe; senão o evento. Gravar é efeito
      // colateral, não elo — depender da memória entregaria ao agente o recibo da
      // gravação em vez do conteúdo.
      dependsOn: [action.enabled ? STEP_APP : STEP_EVENT],
      inputMapping: {},
      config: {
        agentId: agentId.toString(),
        objective: spec.objective,
        instruction: spec.objective,
        format,
        ...(spec.sectorId ? { sectorId: spec.sectorId } : {}),
      },
      timeoutMs: 120_000,
      retryPolicy: { maxAttempts: 1, backoffMs: 2_000 },
      continueOnError: false,
      // Nos modos híbrido e automático a IA só roda se isto for verdade.
      ...(conditionResolved && executionMode !== 'ai' ? { runIf: conditionResolved } : {}),
    })
  }

  // O SINAL vem por último: ele fala sobre o que a ação achou, então precisa da ação
  // já executada. Sem ação, fala sobre o próprio evento.
  const signal = normalizeSignalPlan(spec.signal)
  if (signal.enabled) {
    const origem = action.enabled ? STEP_APP : STEP_EVENT
    steps.push({
      id: STEP_SIGNAL,
      name: 'Publicar sinal',
      type: 'event.publish',
      enabled: true,
      dependsOn: [origem],
      inputMapping: {},
      config: { eventType: signal.eventType },
      timeoutMs: 10_000,
      retryPolicy: { maxAttempts: 2, backoffMs: 1_000 },
      // Falhar em publicar o sinal não pode desfazer o que já foi analisado e guardado.
      continueOnError: true,
      ...(resolveConditionSource(signal.condition, origem) ? { runIf: resolveConditionSource(signal.condition, origem)! } : {}),
    })
  }

  const market = normalizeMarketPlan(spec.market)
  return {
    // Assinatura obrigatória no webhook: um endereço que roda um agente não pode ser
    // chamável por quem só adivinhou a URL. O gatilho interno não tem endereço.
    trigger: market.enabled ? marketTriggerOf(market) : { type: 'webhook', requireSignature: true },
    executionMode,
    inputs: [],
    steps,
    resultFormat: format,
    deliveries: [],
    limits: { ...DEFAULT_LIMITS },
  }
}

// A frase de conferência mostrada antes de salvar.
export const describeEventTriggerFlow = (spec: EventTriggerSpec, destinoLabel?: string | null): string =>
  describeFlow({
    mode: isExecutionMode(spec.executionMode) ? spec.executionMode : 'ai',
    origem: normalizeMarketPlan(spec.market).enabled ? 'Evento de mercado' : 'Webhook',
    memory: normalizeMemoryPlan(spec.memory),
    condition: spec.aiCondition ?? null,
    action: normalizeAppActionPlan(spec.action),
    destinoLabel,
  })

// Create the trigger and arm it. The signing secret is returned HERE and never
// again — only its encrypted form is stored.
export async function createEventTrigger(
  ownerId: string,
  agentId: ObjectId,
  spec: EventTriggerSpec,
): Promise<{ trigger: Automation; publicKey: string; secret: string }> {
  const agent = await getAgentById(ownerId, agentId)
  if (!agent) throw new EventTriggerError('agent not found')
  const objective = spec.objective.trim()
  // Sem etapa de IA não há a quem dar instrução: exigir objetivo aqui obrigaria a
  // escrever um texto que ninguém vai ler.
  const modo = isExecutionMode(spec.executionMode) ? spec.executionMode : 'ai'
  const precisaObjetivo = aiStepPlanned(modo, spec.aiCondition ?? null)
  if (precisaObjetivo && !objective) throw new EventTriggerError('objective is required')
  const vazio = semTrabalho({
    mode: modo,
    memory: normalizeMemoryPlan(spec.memory),
    condition: spec.aiCondition ?? null,
    temAcao: normalizeAppActionPlan(spec.action).enabled,
    temSinal: normalizeSignalPlan(spec.signal).enabled,
  })
  if (vazio) throw new EventTriggerError(vazio)

  const created = await createAutomation(ownerId, {
    floorId: agent.officeId.toString(),
    name: spec.name.trim() || 'Gatilho por evento',
    description: (objective || 'Recebe e guarda o evento').slice(0, 2000),
    definition: buildEventTriggerDefinition({ ...spec, objective }, agentId),
    agentId,
  })
  // O gatilho interno não tem porta: armar um endereço para ele seria publicar uma URL
  // que o receptor recusa, e um segredo que ninguém usa.
  const market = normalizeMarketPlan(spec.market)
  const rotated = market.enabled ? null : await rotateWebhookSecret(ownerId, created._id)
  if (!market.enabled && !rotated) throw new EventTriggerError('could not arm the trigger')
  await publishAutomation(ownerId, created._id, ownerId)
  const active = await setStatus(ownerId, created._id, 'active')
  // A configured trigger must also be an allowed one, or the agent page would show
  // an armed webhook while its activation reads "desligado".
  await ensureActivationMode(ownerId, agentId, 'event')
  return { trigger: active ?? created, publicKey: rotated?.publicKey ?? '', secret: rotated?.secret ?? '' }
}

// Change name/objective. The endpoint and its secret are untouched — a rename must
// never break a caller that is already integrated.
export async function updateEventTrigger(ownerId: string, agentId: ObjectId, triggerId: ObjectId, spec: EventTriggerSpec): Promise<Automation | null> {
  const existing = await getEventTriggerForAgent(ownerId, agentId, triggerId)
  if (!existing) return null
  const objective = spec.objective.trim()
  const modo = isExecutionMode(spec.executionMode) ? spec.executionMode : 'ai'
  const precisaObjetivo = aiStepPlanned(modo, spec.aiCondition ?? null)
  if (precisaObjetivo && !objective) throw new EventTriggerError('objective is required')
  const vazio = semTrabalho({
    mode: modo,
    memory: normalizeMemoryPlan(spec.memory),
    condition: spec.aiCondition ?? null,
    temAcao: normalizeAppActionPlan(spec.action).enabled,
    temSinal: normalizeSignalPlan(spec.signal).enabled,
  })
  if (vazio) throw new EventTriggerError(vazio)
  await updateDraft(ownerId, triggerId, {
    name: spec.name.trim() || existing.name,
    description: objective.slice(0, 2000),
    definition: buildEventTriggerDefinition({ ...spec, objective }, agentId),
  })
  await publishAutomation(ownerId, triggerId, ownerId)
  return getAutomation(ownerId, triggerId)
}

const isEventTrigger = (a: Automation): boolean => {
  const tipo = a.publishedTrigger?.type ?? a.trigger?.type
  // Os dois são "gatilho por evento" para o dono: um ouve de fora, o outro de dentro.
  return tipo === 'webhook' || tipo === 'internal_event'
}

export async function listEventTriggers(ownerId: string, agentId: ObjectId): Promise<Automation[]> {
  const { items } = await repoListAutomations(ownerId, { agentId, limit: 100, skip: 0 })
  return items.filter(isEventTrigger)
}

// Ownership guard for every mutation: the trigger must belong to THIS agent, of
// THIS owner, and actually be an event trigger.
export async function getEventTriggerForAgent(ownerId: string, agentId: ObjectId, triggerId: ObjectId): Promise<Automation | null> {
  const doc = await getAutomation(ownerId, triggerId)
  if (!doc || doc.agentId?.toString() !== agentId.toString()) return null
  return isEventTrigger(doc) ? doc : null
}
