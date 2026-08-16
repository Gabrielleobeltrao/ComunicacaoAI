// Agent ROUTINES — the user-facing shape of a scheduled agent task, living inside the
// agent (never a standalone "Automação"). A routine compiles to an AutomationDefinition
// (schedule trigger + one agent.execute step + optional delivery) so the existing
// engine — scheduler, queue, worker, runs, artifacts, deliveries — runs it unchanged.
import { TRIGGER_FOR_CONFIG } from '../agentReadiness.js'
import { ObjectId } from 'mongodb'
import { getAgentById, ensureActivationMode } from '../agents.js'
import { recurrenceToCron, isValidRecurrence, describeRecurrence } from './schedule.js'
import type { Recurrence } from './schedule.js'
import { INITIAL_WINDOWS, isInitialWindow } from './sourceChange.js'
import type { InitialWindow } from './sourceChange.js'
import { createAutomation, getAutomation, publishAutomation, setStatus, updateDraft } from './service.js'
import { listAutomations as repoListAutomations } from './repository.js'
import { DEFAULT_LIMITS } from './types.js'
import type { Automation, AutomationDefinition, OutputFormat } from './types.js'

/**
 * De onde vem o que o agente processa.
 *
 * `fixed` é o que sempre existiu: um texto que o usuário escreve e que vai igual em
 * toda execução. As outras duas transformam a rotina num MONITORAMENTO — ela passa a
 * consultar uma URL de tempos em tempos e só aciona o agente quando algo mudou.
 *
 * Ausente = `fixed`. É isso que faz toda rotina criada antes disto continuar
 * compilando exatamente como compilava.
 */
export type RoutineSource =
  | { kind: 'fixed' }
  | { kind: 'rss'; url: string; initialWindow: InitialWindow; focus?: string }
  | { kind: 'http'; url: string; focus?: string }

export interface RoutineSpec {
  name: string
  objective: string // the instruction/objective for each run
  recurrence: Recurrence // friendly recurrence (daily / weekly / monthly)
  timezone: string
  input?: string // static input text handed to the agent every run
  outputFormat?: OutputFormat
  // null = "no destination"; UNDEFINED on an update = "keep whatever it has", so an
  // edit made while the connections were still loading cannot erase one.
  delivery?: { provider: 'email' | 'telegram'; connectionId: string } | null
  retryMaxAttempts?: number
  maxOutputChars?: number
  // Optional EXPLICIT sector context for knowledge grounding. Authorised
  // owner-scoped by the service before the definition is stored/published, and
  // re-checked defensively by the worker.
  sectorId?: string | null
  // Fonte de entrada. Ausente ou `fixed` = comportamento de sempre.
  source?: RoutineSource
}

const STEP_AGENT = 'run'
const STEP_DELIVERY = 'deliver'
export const STEP_SOURCE = 'source'

// A fonte declarada na spec, normalizada. Uma URL vazia derruba a fonte para
// `fixed` em vez de gravar um monitoramento que nunca vai funcionar.
export function normalizeSource(source: RoutineSource | undefined): RoutineSource {
  if (!source || source.kind === 'fixed') return { kind: 'fixed' }
  const url = String(source.url ?? '').trim()
  if (!url) return { kind: 'fixed' }
  const focus = typeof source.focus === 'string' && source.focus.trim() ? source.focus.trim() : undefined
  if (source.kind === 'rss') {
    const initialWindow = isInitialWindow(source.initialWindow) ? source.initialWindow : '24h'
    return { kind: 'rss', url, initialWindow, ...(focus ? { focus } : {}) }
  }
  return { kind: 'http', url, ...(focus ? { focus } : {}) }
}

// Pure: routine spec + owning agent → a valid AutomationDefinition.
export function buildRoutineDefinition(spec: RoutineSpec, agentId: ObjectId): AutomationDefinition {
  const format = spec.outputFormat ?? 'markdown'
  const source = normalizeSource(spec.source)
  const monitorando = source.kind !== 'fixed'

  // Numa rotina de monitoramento, o que o agente recebe é o CONTEÚDO NOVO (vindo da
  // etapa anterior), não um texto fixo. O "foco" entra como orientação sobre o que
  // olhar nesse conteúdo.
  const instruction = monitorando
    ? [spec.objective, source.focus ? `Foco: ${source.focus}` : ''].filter(Boolean).join('\n\n')
    : spec.input
      ? `${spec.objective}\n\nEntrada: ${spec.input}`
      : spec.objective

  const steps: AutomationDefinition['steps'] = []

  if (monitorando) {
    steps.push({
      id: STEP_SOURCE,
      name: source.kind === 'rss' ? 'Verificar feed' : 'Verificar página',
      type: source.kind === 'rss' ? 'source.rss' : 'source.http',
      enabled: true,
      dependsOn: [],
      inputMapping: {},
      config: {
        url: source.url,
        ...(source.kind === 'rss' ? { windowMs: INITIAL_WINDOWS[source.initialWindow], initialWindow: source.initialWindow } : {}),
        ...(source.focus ? { focus: source.focus } : {}),
      },
      timeoutMs: 30_000,
      // Buscar é a única parte que vale repetir: uma falha de rede é transitória.
      // "Nada mudou" não passa por aqui — não é erro, e o runner nem chega a tentar
      // de novo.
      retryPolicy: { maxAttempts: 2, backoffMs: 2000 },
      continueOnError: false,
    })
  }

  steps.push(
    {
      id: STEP_AGENT,
      name: 'Executar agente',
      type: 'agent.execute',
      enabled: true,
      // Monitorando, o agente depende da fonte: é dela que vem a entrada.
      dependsOn: monitorando ? [STEP_SOURCE] : [],
      inputMapping: {},
      config: {
        agentId: agentId.toString(),
        objective: spec.objective,
        instruction,
        format,
        // Kept apart from the composed instruction so the editor can prefill the
        // field the user actually typed, instead of re-parsing prose.
        ...(spec.input ? { input: spec.input } : {}),
        ...(spec.sectorId ? { sectorId: spec.sectorId } : {}),
      },
      timeoutMs: 120_000,
      retryPolicy: { maxAttempts: Math.max(1, Math.min(spec.retryMaxAttempts ?? 1, 5)), backoffMs: 2000 },
      continueOnError: false,
    },
  )
  const deliveries: AutomationDefinition['deliveries'] = []
  if (spec.delivery) {
    steps.push({
      id: STEP_DELIVERY,
      name: 'Entregar resultado',
      type: 'delivery.send',
      enabled: true,
      dependsOn: [STEP_AGENT],
      inputMapping: {},
      config: { connectionId: spec.delivery.connectionId, fromStepId: STEP_AGENT },
      timeoutMs: 30_000,
      retryPolicy: { maxAttempts: 2, backoffMs: 2000 },
      continueOnError: false,
    })
    deliveries.push({ provider: spec.delivery.provider, connectionId: spec.delivery.connectionId, fromStepId: STEP_AGENT, required: false })
  }
  return {
    trigger: { type: 'schedule', timezone: spec.timezone, cron: recurrenceToCron(spec.recurrence) },
    inputs: [],
    steps,
    resultFormat: format,
    deliveries,
    limits: { ...DEFAULT_LIMITS, maxOutputChars: spec.maxOutputChars ?? DEFAULT_LIMITS.maxOutputChars },
  }
}

/**
 * A fonte de volta, lida da definição compilada.
 *
 * A interface precisa reabrir a rotina com os campos que o usuário preencheu, e a
 * definição é a única fonte de verdade — não há cópia da spec guardada em lugar
 * nenhum. Definição sem etapa de fonte devolve `fixed`, que é o que toda rotina
 * antiga é.
 */
export function readSourceFromDefinition(def: AutomationDefinition | null | undefined): RoutineSource {
  const passo = (def?.steps ?? []).find((s) => s.id === STEP_SOURCE)
  if (!passo) return { kind: 'fixed' }
  const cfg = passo.config ?? {}
  const url = String(cfg.url ?? '')
  const focus = typeof cfg.focus === 'string' ? cfg.focus : undefined
  if (passo.type === 'source.rss') {
    const initialWindow = isInitialWindow(cfg.initialWindow) ? cfg.initialWindow : '24h'
    return { kind: 'rss', url, initialWindow, ...(focus ? { focus } : {}) }
  }
  return { kind: 'http', url, ...(focus ? { focus } : {}) }
}

export class RoutineError extends Error {}

// Create a routine on an agent: build the definition, create the (agent-owned)
// automation, publish it (immutable version) and activate it so the scheduler picks
// it up. Returns the resulting Automation.
export async function createRoutine(ownerId: string, agentId: ObjectId, spec: RoutineSpec): Promise<Automation> {
  const agent = await getAgentById(ownerId, agentId)
  if (!agent) throw new RoutineError('agent not found')
  if (!isValidRecurrence(spec.recurrence)) throw new RoutineError('invalid recurrence')
  const definition = buildRoutineDefinition(spec, agentId)
  const created = await createAutomation(ownerId, {
    floorId: agent.officeId.toString(),
    name: spec.name || describeRecurrence(spec.recurrence),
    description: spec.objective.slice(0, 2000),
    definition,
    agentId,
  })
  await publishAutomation(ownerId, created._id, ownerId)
  const active = await setStatus(ownerId, created._id, 'active')
  // A configured trigger must also be an allowed one — otherwise the agent page
  // would show a routine that runs while the schedule reads "desligado".
  await ensureActivationMode(ownerId, agentId, TRIGGER_FOR_CONFIG.routine)
  return active ?? created
}

// Update a routine's definition (name/schedule/objective) by rebuilding it, then
// re-publish + keep its current active/paused status.
export async function updateRoutine(ownerId: string, agentId: ObjectId, routineId: ObjectId, spec: RoutineSpec): Promise<Automation | null> {
  const existing = await getAutomation(ownerId, routineId)
  if (!existing || existing.agentId?.toString() !== agentId.toString()) return null
  if (!isValidRecurrence(spec.recurrence)) throw new RoutineError('invalid recurrence')
  // An omitted delivery keeps the current one: only an explicit null removes it.
  const current = (existing.draftDefinition?.deliveries ?? [])[0]
  const delivery =
    spec.delivery !== undefined
      ? spec.delivery
      : current
        ? { provider: current.provider, connectionId: current.connectionId.toString() }
        : null
  // Uma fonte omitida no update MANTÉM a atual, pela mesma razão da entrega: um
  // formulário salvo antes de a fonte carregar não pode apagar o monitoramento.
  // Só um `{ kind: 'fixed' }` explícito o desliga.
  const source = spec.source !== undefined ? spec.source : readSourceFromDefinition(existing.draftDefinition)
  const definition = buildRoutineDefinition({ ...spec, delivery, source }, agentId)
  await updateDraft(ownerId, routineId, { name: spec.name || describeRecurrence(spec.recurrence), description: spec.objective.slice(0, 2000), definition })
  await publishAutomation(ownerId, routineId, ownerId)
  return getAutomation(ownerId, routineId)
}

// Everything this agent owns — scheduled routines AND event triggers. Used where
// the agent's whole automatic work matters (its history).
export async function listAgentAutomations(ownerId: string, agentId: ObjectId): Promise<Automation[]> {
  const { items } = await repoListAutomations(ownerId, { agentId, limit: 100, skip: 0 })
  return items
}

// Only the SCHEDULED ones: an event trigger is a different surface (Gatilhos) and
// must not show up as a routine with an empty recurrence.
export async function listRoutines(ownerId: string, agentId: ObjectId): Promise<Automation[]> {
  const items = await listAgentAutomations(ownerId, agentId)
  return items.filter((a) => (a.publishedTrigger?.type ?? a.trigger?.type) === 'schedule')
}

// Guard that a routine belongs to the given agent before status/delete actions.
export async function getRoutineForAgent(ownerId: string, agentId: ObjectId, routineId: ObjectId): Promise<Automation | null> {
  const doc = await getAutomation(ownerId, routineId)
  return doc && doc.agentId?.toString() === agentId.toString() ? doc : null
}
