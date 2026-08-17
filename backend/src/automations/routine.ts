// Agent ROUTINES — the user-facing shape of a scheduled agent task, living inside the
// agent (never a standalone "Automação"). A routine compiles to an AutomationDefinition
// (schedule trigger + one agent.execute step + optional delivery) so the existing
// engine — scheduler, queue, worker, runs, artifacts, deliveries — runs it unchanged.
import { TRIGGER_FOR_CONFIG } from '../agentReadiness.js'
import { ObjectId } from 'mongodb'
import { getAgentById, ensureActivationMode } from '../agents.js'
import { recurrenceToCron, isValidRecurrence, describeRecurrence } from './schedule.js'
import type { Recurrence } from './schedule.js'
import { INITIAL_WINDOWS, isInitialWindow, sourceFingerprint } from './sourceChange.js'
import type { InitialWindow } from './sourceChange.js'
import { createAutomation, getAutomation, publishAutomation, setStatus, updateDraft } from './service.js'
import { listAutomations as repoListAutomations } from './repository.js'
import { DEFAULT_LIMITS, isExecutionMode } from './types.js'
import type { Automation, AutomationDefinition, ExecutionMode, OutputFormat, StepDefinition } from './types.js'
import {
  aiStepPlanned,
  appStep,
  describeFlow,
  emptyMemoryPlan,
  memoryStep,
  normalizeAppActionPlan,
  normalizeMemoryPlan,
  readAppActionFromSteps,
  semTrabalho,
  STEP_APP,
  STEP_MEMORY,
} from './executionPlan.js'
import type { AppActionPlan, MemoryPlan } from './executionPlan.js'
import type { StepCondition } from './conditions.js'

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

/**
 * Qual "vez" deste monitoramento.
 *
 * Desligar o monitoramento e religar na mesma URL é começar de novo, não continuar
 * de onde parou: no meio do desligamento o feed andou, e o dono que reativa espera
 * ser avisado do que há agora — não receber de uma vez tudo que passou enquanto
 * estava desligado, nem ficar em silêncio porque aquilo "já foi visto".
 *
 * A URL sozinha não sabe disso: ela é a mesma nas duas vezes. Daí a geração, que
 * entra na identidade do checkpoint junto com tipo e URL.
 *
 * Ausente nas rotinas criadas antes deste campo, e é assim que elas continuam
 * valendo: sem geração, a identidade é a de sempre e o checkpoint delas segue
 * servindo.
 */
export const novaGeracaoDeFonte = (): string => new ObjectId().toHexString()

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
  // A "vez" deste monitoramento. Quem monta a spec decide se continua a anterior
  // ou começa outra; ver `resolverGeracao`.
  sourceInstanceId?: string
  // Ausente = 'ai', que é o comportamento de toda rotina criada antes disto.
  executionMode?: ExecutionMode
  // Onde guardar o que a fonte trouxe. Desligado por padrão.
  memory?: MemoryPlan
  // Quando chamar a IA nos modos híbrido e automático.
  aiCondition?: StepCondition | null
  // Uma ação de App executada direto, sem modelo. Desligada por padrão.
  action?: AppActionPlan
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

  const executionMode: ExecutionMode = isExecutionMode(spec.executionMode) ? spec.executionMode : 'ai'
  const memoria = normalizeMemoryPlan(spec.memory)
  const condicao = spec.aiCondition ?? null
  const acao = normalizeAppActionPlan(spec.action)
  const comIA = aiStepPlanned(executionMode, condicao)

  const steps: StepDefinition[] = []

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
        ...(spec.sourceInstanceId ? { instanceId: spec.sourceInstanceId } : {}),
      },
      timeoutMs: 30_000,
      // Buscar é a única parte que vale repetir: uma falha de rede é transitória.
      // "Nada mudou" não passa por aqui — não é erro, e o runner nem chega a tentar
      // de novo.
      retryPolicy: { maxAttempts: 2, backoffMs: 2000 },
      continueOnError: false,
    })
  }

  // A ação vem antes de guardar: é o resultado dela que costuma valer a pena guardar,
  // não o conteúdo cru da fonte.
  if (acao.enabled) steps.push(appStep(acao, monitorando ? [STEP_SOURCE] : [], agentId))

  // Guardar vem antes do que é caro: se a IA falhar depois, o que a fonte trouxe já
  // está salvo.
  if (memoria.enabled) steps.push(memoryStep(memoria, acao.enabled ? [STEP_APP] : monitorando ? [STEP_SOURCE] : [], agentId))

  // A etapa que gasta token só existe quando o modo pede.
  if (comIA) {
    steps.push({
      id: STEP_AGENT,
      name: 'Executar agente',
      type: 'agent.execute',
      enabled: true,
      // Monitorando, o agente depende da fonte: é dela que vem a entrada.
      // O que a ação produziu, quando existe; senão a fonte. Gravar é efeito
      // colateral, não elo da corrente.
      dependsOn: acao.enabled ? [STEP_APP] : monitorando ? [STEP_SOURCE] : [],
      inputMapping: {},
      config: {
        agentId: agentId.toString(),
        objective: spec.objective,
        instruction,
        format,
        ...(spec.sectorId ? { sectorId: spec.sectorId } : {}),
      },
      timeoutMs: 120_000,
      retryPolicy: { maxAttempts: Math.max(1, Math.min(spec.retryMaxAttempts ?? 1, 5)), backoffMs: 2000 },
      continueOnError: false,
      ...(condicao && executionMode !== 'ai' ? { runIf: condicao } : {}),
    })
  }

  const deliveries: AutomationDefinition['deliveries'] = []
  // Sem etapa de IA, o que se entrega é o que a etapa anterior produziu — o que a
  // fonte trouxe, ou o recibo da gravação. Se nenhuma delas existe, a entrega NÃO é
  // gerada: apontar para uma etapa inexistente produziria uma definição inválida na
  // publicação, com um erro que não diz nada ao dono.
  const origemDaEntrega = comIA ? STEP_AGENT : acao.enabled ? STEP_APP : monitorando ? STEP_SOURCE : memoria.enabled ? STEP_MEMORY : null
  if (spec.delivery && origemDaEntrega) {
    steps.push({
      id: STEP_DELIVERY,
      name: 'Entregar resultado',
      type: 'delivery.send',
      enabled: true,
      dependsOn: [origemDaEntrega],
      inputMapping: {},
      config: { connectionId: spec.delivery.connectionId, fromStepId: origemDaEntrega },
      timeoutMs: 30_000,
      retryPolicy: { maxAttempts: 2, backoffMs: 2000 },
      continueOnError: false,
    })
    deliveries.push({ provider: spec.delivery.provider, connectionId: spec.delivery.connectionId, fromStepId: origemDaEntrega, required: false })
  }
  return {
    executionMode,
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
/**
 * Modo, destino de memória e condição de uma rotina salva.
 *
 * Lido da definição, que é a única fonte de verdade — é isto que faz a interface
 * reabrir a rotina preenchida do jeito que ela foi salva.
 */
export function readRoutineExecution(def: AutomationDefinition | null | undefined): {
  executionMode: ExecutionMode
  memory: MemoryPlan
  aiCondition: StepCondition | null
  action: AppActionPlan
} {
  const mode: ExecutionMode = isExecutionMode(def?.executionMode) ? def.executionMode : 'ai'
  const passoMemoria = (def?.steps ?? []).find((s) => s.id === STEP_MEMORY)
  const memory: MemoryPlan = passoMemoria ? normalizeMemoryPlan({ ...(passoMemoria.config ?? {}), enabled: true }) : emptyMemoryPlan()
  const passoAgente = (def?.steps ?? []).find((s) => s.type === 'agent.execute')
  return { executionMode: mode, memory, aiCondition: passoAgente?.runIf ?? null, action: readAppActionFromSteps(def?.steps) }
}

// A geração gravada na definição, ou null nas rotinas anteriores ao campo.
export function readSourceInstanceId(def: AutomationDefinition | null | undefined): string | null {
  const passo = (def?.steps ?? []).find((s) => s.id === STEP_SOURCE)
  return typeof passo?.config?.instanceId === 'string' ? passo.config.instanceId : null
}

/**
 * Qual geração vale para a fonte que está sendo salva.
 *
 * Continua a mesma quando a fonte continua a mesma — mudar foco, horário, formato
 * ou destino não recomeça nada. Começa outra quando o tipo ou a URL mudam, e
 * também quando o monitoramento é religado depois de ter sido desligado, que é o
 * caso que a URL sozinha não distingue.
 */
export function resolverGeracao(anterior: RoutineSource, nova: RoutineSource, geracaoAtual: string | null): string | undefined {
  if (nova.kind === 'fixed') return undefined
  // `anterior` fixa cai aqui como fonte diferente, que é exatamente o caso do
  // religar: mesma URL, monitoramento novo.
  const mesmaFonte = anterior.kind !== 'fixed' && anterior.kind === nova.kind && anterior.url === nova.url
  return mesmaFonte ? (geracaoAtual ?? undefined) : novaGeracaoDeFonte()
}

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

/**
 * Recorrência de minutos e de hora em hora existem para MONITORAMENTO.
 *
 * Uma rotina de entrada fixa rodando de 5 em 5 minutos chama a LLM 288 vezes por
 * dia com exatamente a mesma entrada — é conta alta em troca de nada. O
 * monitoramento pode: ele verifica de graça e só paga quando encontra algo.
 *
 * A interface já não oferece a combinação; isto aqui é a porteira, porque a API é
 * pública e a interface não é a única forma de chegar nela.
 */
export function recorrenciaIncompativelComFonte(spec: RoutineSpec): string | null {
  const curta = spec.recurrence?.kind === 'minutes' || spec.recurrence?.kind === 'hourly'
  if (!curta) return null
  if (normalizeSource(spec.source).kind !== 'fixed') return null
  return 'Frequências de minutos ou de hora em hora só valem para rotinas que monitoram uma fonte. Escolha diária, semanal ou mensal.'
}

export class RoutineError extends Error {}

// Create a routine on an agent: build the definition, create the (agent-owned)
// automation, publish it (immutable version) and activate it so the scheduler picks
// it up. Returns the resulting Automation.
export async function createRoutine(ownerId: string, agentId: ObjectId, spec: RoutineSpec): Promise<Automation> {
  const agent = await getAgentById(ownerId, agentId)
  if (!agent) throw new RoutineError('agent not found')
  if (!isValidRecurrence(spec.recurrence)) throw new RoutineError('invalid recurrence')
  const incompativel = recorrenciaIncompativelComFonte(spec)
  if (incompativel) throw new RoutineError(incompativel)
  const vazia = semTrabalho({
    mode: isExecutionMode(spec.executionMode) ? spec.executionMode : 'ai',
    memory: normalizeMemoryPlan(spec.memory),
    condition: spec.aiCondition ?? null,
    temFonte: normalizeSource(spec.source).kind !== 'fixed',
    temAcao: normalizeAppActionPlan(spec.action).enabled,
  })
  if (vazia) throw new RoutineError(vazia)
  // Rotina nova que monitora começa a primeira geração.
  const sourceInstanceId = normalizeSource(spec.source).kind === 'fixed' ? undefined : novaGeracaoDeFonte()
  const definition = buildRoutineDefinition({ ...spec, sourceInstanceId }, agentId)
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
  const anterior = readSourceFromDefinition(existing.draftDefinition)
  const source = spec.source !== undefined ? spec.source : anterior

  // Modo, memória e condição seguem a regra da fonte e da entrega: ausentes, o update
  // PRESERVA o que a rotina já tinha. Sem isto, um PATCH que só muda o objetivo
  // transformaria uma rotina "somente coletar" numa rotina com IA — e o dono
  // descobriria pela conta.
  const salvo = readRoutineExecution(existing.draftDefinition)
  const executionMode = spec.executionMode !== undefined ? spec.executionMode : salvo.executionMode
  const memory = spec.memory !== undefined ? spec.memory : salvo.memory
  const aiCondition = spec.aiCondition !== undefined ? spec.aiCondition : salvo.aiCondition
  const action = spec.action !== undefined ? spec.action : salvo.action

  // A frequência é julgada contra a fonte EFETIVA, não contra o que veio no corpo:
  // um monitor existente que verifica de 15 em 15 minutos não pode ser recusado
  // como "rotina fixa" só porque o cliente omitiu `source`.
  const incompativel = recorrenciaIncompativelComFonte({ ...spec, source })
  if (incompativel) throw new RoutineError(incompativel)
  const vazia = semTrabalho({
    mode: executionMode,
    memory: normalizeMemoryPlan(memory),
    condition: aiCondition,
    temFonte: normalizeSource(source).kind !== 'fixed',
    temAcao: normalizeAppActionPlan(action).enabled,
  })
  if (vazia) throw new RoutineError(vazia)

  const sourceInstanceId = resolverGeracao(anterior, normalizeSource(source), readSourceInstanceId(existing.draftDefinition))
  const definition = buildRoutineDefinition({ ...spec, delivery, source, sourceInstanceId, executionMode, memory, aiCondition, action }, agentId)
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

/**
 * A identidade da fonte que a rotina publica AGORA.
 *
 * `null` quando a rotina não monitora nada. Serve para uma execução perguntar se a
 * fonte que ela carrega ainda é a que vale — a definição publicada é a única fonte
 * de verdade, e o snapshot da execução pode ter envelhecido na fila.
 */
export function publishedSourceFingerprint(def: AutomationDefinition | null | undefined): string | null {
  const passo = (def?.steps ?? []).find((s) => s.id === STEP_SOURCE)
  if (!passo || (passo.type !== 'source.rss' && passo.type !== 'source.http')) return null
  const url = typeof passo.config?.url === 'string' ? passo.config.url : ''
  if (!url) return null
  const instanceId = typeof passo.config?.instanceId === 'string' ? passo.config.instanceId : null
  return sourceFingerprint(passo.type === 'source.rss' ? 'rss' : 'http', url, instanceId)
}
