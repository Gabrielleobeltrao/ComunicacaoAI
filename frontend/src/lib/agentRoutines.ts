import { API_URL } from './api'

// Client for agent Rotinas (scheduled tasks that live inside an agent) and the
// agent's Histórico (routine runs + delegations). Backend enforces ownership.
export type RoutineStatus = 'draft' | 'active' | 'paused' | 'archived'

// Os intervalos curtos existem para MONITORAMENTO — verificar um feed ou uma
// página de tempos em tempos. Não têm hora do dia, e por isso são um tipo à parte.
export type Recurrence =
  | { kind: 'minutes'; every: 5 | 15 | 30 }
  | { kind: 'hourly' }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; weekdays: number[] }
  | { kind: 'monthly'; time: string; day: number }

export type InitialWindow = '24h' | '3d' | '7d'

/**
 * De onde vem o que o agente processa.
 *
 * `fixed` é o que sempre existiu: um texto igual em toda execução. As outras duas
 * transformam a rotina num monitoramento — ela consulta a URL e só aciona o agente
 * quando há conteúdo novo ou alteração real.
 */
export type RoutineSource =
  | { kind: 'fixed' }
  | { kind: 'rss'; url: string; initialWindow: InitialWindow; focus?: string }
  | { kind: 'http'; url: string; focus?: string }

// O estado do monitoramento, para a lista. Só existe em rotina com fonte.
export interface RoutineMonitoring {
  lastCheckedAt: string | null
  lastChangedAt: string | null
  // 'changed' = encontrou e processou; 'no_change' = verificou e não havia nada
  // (sucesso, zero token); 'skipped_concurrent' = outra execução já estava
  // verificando; 'skipped_stale' = a execução era de uma fonte que já foi trocada;
  // 'failed' = a verificação em si falhou.
  lastResult: 'changed' | 'no_change' | 'skipped_concurrent' | 'skipped_stale' | 'failed' | null
  lastRunAt: string | null
  lastError: PublicError | null
}

export interface Routine {
  id: string
  source: RoutineSource
  monitoring?: RoutineMonitoring
  name: string
  objective: string
  status: RoutineStatus
  timezone: string
  cron: string
  recurrence: Recurrence | null
  scheduleLabel: string
  // What the edit form opens with.
  input: string
  outputFormat: 'text' | 'markdown' | 'json'
  delivery: { provider: 'email' | 'telegram'; connectionId: string } | null
  lastPublishedVersion: number | null
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RoutineInput {
  name?: string
  // Ausente = mantém a fonte atual. Só um `{ kind: 'fixed' }` explícito desliga o
  // monitoramento — a mesma regra do destino de entrega.
  source?: RoutineSource
  objective: string
  recurrence: Recurrence
  timezone?: string
  input?: string
  outputFormat?: 'text' | 'markdown' | 'json'
  delivery?: { provider: 'email' | 'telegram'; connectionId: string } | null
  retryMaxAttempts?: number
}

// A failure as the API reports it: a category and a controlled sentence. NEVER the
// engine's stored message, which can quote the prompt, the payload or a credential.
export interface PublicError {
  kind: string
  message: string
}

export interface RunHistoryItem {
  id: string
  routineId: string
  routineName: string
  status: string
  triggerType: string
  queuedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  error: PublicError | null
}

export interface DelegationHistoryItem {
  id: string
  direction: 'outgoing' | 'incoming'
  targetType: 'agent' | 'sector'
  targetAgentId: string | null
  targetSectorId: string | null
  objective: string
  status: 'running' | 'succeeded' | 'failed' | 'denied' | 'canceled'
  denyCode: string | null
  outputPreview: string | null
  error: PublicError | null
  createdAt: string
  finishedAt: string | null
}

export interface AgentHistory {
  total: number
  items: RunHistoryItem[]
  delegations: DelegationHistoryItem[]
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(String(res.status))
  return res.json() as Promise<T>
}
const req = (method: string, body?: unknown): RequestInit => ({
  method,
  credentials: 'include',
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

const base = (agentId: string) => `${API_URL}/api/agents/${agentId}`

export const listRoutines = (agentId: string) => fetch(`${base(agentId)}/routines`, req('GET')).then(json<Routine[]>)
export const createRoutine = (agentId: string, input: RoutineInput) => fetch(`${base(agentId)}/routines`, req('POST', input)).then(json<Routine>)

// O que a fonte devolve HOJE, sem executar nada: nenhuma LLM, nenhum token,
// nenhum checkpoint tocado.
export interface SourcePreview {
  ok: boolean
  kind: 'rss' | 'http'
  message: string
  itemCount?: number
  items?: { title: string; url: string; publishedAt: string | null }[]
  excerpt?: string
}

export const testSource = (agentId: string, body: { kind: 'rss' | 'http'; url: string; initialWindow?: InitialWindow }) =>
  fetch(`${base(agentId)}/routines/test-source`, req('POST', body)).then(json<SourcePreview>)

// Enfileira a MESMA execução que o agendador dispararia, fora do horário. Se não
// houver novidade, ela termina como sucesso sem alteração — diferente de
// `testSource`, que não executa nada.
export const checkRoutineNow = (agentId: string, routineId: string) =>
  fetch(`${base(agentId)}/routines/${routineId}/check-now`, req('POST', {})).then(json<{ runId: string; status: string }>)
export const updateRoutine = (agentId: string, routineId: string, input: RoutineInput) =>
  fetch(`${base(agentId)}/routines/${routineId}`, req('PATCH', input)).then(json<Routine>)
export const routineAction = (agentId: string, routineId: string, action: 'activate' | 'pause' | 'archive') =>
  fetch(`${base(agentId)}/routines/${routineId}/${action}`, req('POST')).then(json<Routine>)
export const getAgentHistory = (agentId: string, limit = 25) => fetch(`${base(agentId)}/history?limit=${limit}`, req('GET')).then(json<AgentHistory>)

// --- Event triggers (webhooks that belong to this agent) -------------------------
// Agent-native: the user creates "um gatilho por evento", never an automation. The
// signing secret exists in this contract ONLY in the response of create and rotate —
// it is never listed and never stored in the browser.
/**
 * Como o gatilho processa o que chega.
 *
 * `ai` é o de sempre, e é o padrão de quem não escolheu. Os outros existem porque a
 * maior parte do que um webhook recebe não precisa de inteligência: guardar um
 * pedido é um INSERT, e mandar para um modelo custa tokens a cada evento.
 */
export type ExecutionMode = 'collect_only' | 'deterministic' | 'ai' | 'hybrid' | 'automatic'
export type MemoryScope = 'agent' | 'sector' | 'floor' | 'building'
export type MemoryStrategy = 'append' | 'upsert' | 'replace'

export interface MemoryPlan {
  enabled: boolean
  scope: MemoryScope
  agentId?: string | null
  sectorId?: string | null
  floorId?: string | null
  buildingId?: string | null
  strategy: MemoryStrategy
  key: string
  dedupeKey?: string | null
  fieldMap?: Record<string, string>
  ttlSeconds?: number | null
}

export type ConditionOperator = 'exists' | 'absent' | 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt' | 'matches'

export interface StepCondition {
  source: string
  path: string
  operator: ConditionOperator
  value?: unknown
}

export interface EventTrigger {
  id: string
  executionMode: ExecutionMode
  memory: MemoryPlan
  aiCondition: StepCondition | null
  name: string
  objective: string
  status: RoutineStatus
  endpoint: string | null
  requireSignature: boolean
  hasSecret: boolean
  createdAt: string
  updatedAt: string
}

export interface EventTriggerInput {
  name?: string
  objective: string
  // Ausentes = mantém o comportamento de sempre: modo `ai`, sem memória.
  executionMode?: ExecutionMode
  memory?: MemoryPlan
  aiCondition?: StepCondition | null
}

export const listEventTriggers = (agentId: string) => fetch(`${base(agentId)}/event-triggers`, req('GET')).then(json<EventTrigger[]>)
export const createEventTrigger = (agentId: string, input: EventTriggerInput) =>
  fetch(`${base(agentId)}/event-triggers`, req('POST', input)).then(json<EventTrigger & { secret: string }>)
export const updateEventTrigger = (agentId: string, triggerId: string, input: EventTriggerInput) =>
  fetch(`${base(agentId)}/event-triggers/${triggerId}`, req('PATCH', input)).then(json<EventTrigger>)
export const rotateEventTriggerSecret = (agentId: string, triggerId: string) =>
  fetch(`${base(agentId)}/event-triggers/${triggerId}/rotate`, req('POST')).then(json<EventTrigger & { secret: string }>)
export const eventTriggerAction = (agentId: string, triggerId: string, action: 'activate' | 'pause' | 'archive') =>
  fetch(`${base(agentId)}/event-triggers/${triggerId}/${action}`, req('POST')).then(json<EventTrigger>)

// The request a caller has to make. Shown in the UI so integrating does not require
// reading any documentation — and so the signature headers are never a surprise.
export function eventTriggerExample(endpoint: string | null, requireSignature: boolean): string {
  const url = endpoint ?? 'https://…/api/hooks/automations/<chave>'
  const lines = [`curl -X POST ${url} \\`, `  -H 'content-type: application/json' \\`, `  -H 'x-event-id: <id único do evento>' \\`]
  if (requireSignature) lines.push(`  -H 'x-signature: <HMAC-SHA256 do corpo, em hex, com o segredo>' \\`)
  lines.push(`  -d '{"exemplo":"dados do evento"}'`)
  return lines.join('\n')
}

// Delivery destinations available to a routine. The API returns public metadata
// only — a connection's credentials never reach the browser.
export interface DeliveryConnection {
  id: string
  provider: 'email' | 'telegram'
  name: string
  status: string
}
export const listDeliveryConnections = () =>
  fetch(`${API_URL}/api/connections`, req('GET'))
    .then(json<DeliveryConnection[]>)
    .then((list) => list.filter((c) => c.provider === 'email' || c.provider === 'telegram'))
