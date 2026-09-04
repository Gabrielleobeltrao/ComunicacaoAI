import { API_URL } from './api'

// O cliente de Monitors.
//
// Salvar e publicar são chamadas DIFERENTES de propósito: o backend nunca publica ao
// salvar, e a tela não pode dar a impressão de que publica.

export type TriggerMode = 'level' | 'enter' | 'exit' | 'cross_up' | 'cross_down' | 'change'
export type ComparisonOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne'
export type MonitorStatus = 'draft' | 'published' | 'paused'

export const TRIGGER_LABEL: Record<TriggerMode, string> = {
  level: 'sempre que estiver verdadeira',
  enter: 'quando passar a ser verdadeira',
  exit: 'quando deixar de ser verdadeira',
  cross_up: 'quando cruzar o limiar para cima',
  cross_down: 'quando cruzar o limiar para baixo',
  change: 'quando o valor mudar',
}

export const OP_LABEL: Record<ComparisonOp, string> = {
  gt: 'acima de',
  gte: 'no mínimo',
  lt: 'abaixo de',
  lte: 'no máximo',
  eq: 'igual a',
  ne: 'diferente de',
}

export const STATUS_LABEL: Record<MonitorStatus, string> = {
  draft: 'rascunho',
  published: 'de plantão',
  paused: 'pausado',
}

export interface ConditionCompare {
  kind: 'compare'
  field: string
  op: ComparisonOp
  value: number | string | boolean
}

export interface MonitorState {
  status: 'watching' | 'paused' | 'degraded' | 'error'
  conditionIsTrue: boolean
  lastObservedAt: string | null
  lastTriggeredAt: string | null
  error: { code: string; message: string } | null
}

/** De onde o monitor observa. `database` é também o que uma fonte da Central alimenta. */
export type MonitorSource =
  | { kind: 'internal_event'; eventType: string }
  | { kind: 'database'; dataStoreId: string; datasetKey: string }

export interface MonitorSummary {
  id: string
  name: string
  status: MonitorStatus
  source: MonitorSource
  condition: ConditionNode
  conditionText: string
  triggerMode: TriggerMode
  threshold: number | null
  thresholdField: string | null
  debounceMs: number
  cooldownMs: number
  flowId: string | null
  /** O que este alarme já custou — contado das execuções que ele pediu, nunca de um contador próprio. */
  cost: { runs: number; inputTokens: number; outputTokens: number }
  state: MonitorState | null
}

export interface MonitorMeta {
  eventTypes: string[]
  triggerModes: TriggerMode[]
  operators: ComparisonOp[]
}

export interface MonitorInput {
  name: string
  source: MonitorSource
  condition: ConditionNode
  triggerMode: TriggerMode
  threshold?: number | null
  thresholdField?: string | null
  debounceMs: number
  cooldownMs: number
  flowId: string | null
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
    throw new Error(corpo?.message ?? corpo?.error ?? `${res.status}`)
  }
  return (res.status === 204 ? (null as T) : ((await res.json()) as T))
}

const req = <T>(caminho: string, init: { method?: string; body?: unknown } = {}): Promise<T> =>
  fetch(`${API_URL}${caminho}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
  }).then((r) => json<T>(r))

export const listMonitors = () => req<MonitorSummary[]>('/api/monitors')
export const monitorMeta = () => req<MonitorMeta>('/api/monitors/meta')
export const createMonitor = (body: MonitorInput) => req<{ id: string; status: MonitorStatus }>('/api/monitors', { method: 'POST', body })
export const updateMonitor = (id: string, body: MonitorInput) => req<{ id: string; status: MonitorStatus }>(`/api/monitors/${id}`, { method: 'PUT', body })
export const publishMonitor = (id: string) => req<{ id: string; status: MonitorStatus }>(`/api/monitors/${id}/publish`, { method: 'POST' })
export const pauseMonitor = (id: string) => req<{ id: string; status: MonitorStatus }>(`/api/monitors/${id}/pause`, { method: 'POST' })
export const deleteMonitor = (id: string) => req<null>(`/api/monitors/${id}`, { method: 'DELETE' })

export interface FlowOption {
  id: string
  name: string
  status: string
  lastPublishedVersion: number | null
}

/**
 * Os Flows que o monitor pode acionar.
 *
 * A tela mostra TODOS e marca quais ainda não foram publicados, em vez de esconder os
 * rascunhos: sumir com um Flow que a pessoa acabou de criar parece defeito, e a recusa
 * na publicação já explica o que falta.
 */
export const listFlows = () =>
  req<{ items: { id: string; name: string; status: string; lastPublishedVersion: number | null }[] }>('/api/automations?limit=100').then((r) =>
    r.items.map((a) => ({ id: String(a.id), name: a.name, status: a.status, lastPublishedVersion: a.lastPublishedVersion })),
  )

// --- a AST e a simulação ------------------------------------------------------------

/** Um nó da condição. AND/OR aninham; `compare` e `delta` são as folhas. */
export type ConditionNode =
  | { kind: 'compare'; field: string; op: ComparisonOp; value: number | string | boolean }
  | { kind: 'delta'; field: string; op: ComparisonOp; value: number; mode: 'absolute' | 'percent' }
  | { kind: 'and'; children: ConditionNode[] }
  | { kind: 'or'; children: ConditionNode[] }
  | { kind: 'not'; child: ConditionNode }

export interface SimulationResult {
  conditionIsTrue: boolean
  wouldTrigger: boolean
  explanation: string
  conditionText: string
}

export const simulate = (body: {
  condition: ConditionNode
  triggerMode: TriggerMode
  threshold?: number | null
  thresholdField?: string | null
  value: Record<string, unknown>
  previous?: Record<string, unknown> | null
  fields?: string[]
}) => req<SimulationResult>('/api/monitors/simulate', { method: 'POST', body })

/**
 * A frase da condição, montada na tela.
 *
 * O backend também descreve — e é ele quem manda quando a regra já existe. Esta versão é
 * para o RASCUNHO, que ainda não foi ao servidor: sem ela, quem monta a condição só
 * descobre o que escreveu depois de salvar.
 */
export function descreverCondicao(no: ConditionNode): string {
  if (no.kind === 'compare') return `${no.field} ${OP_LABEL[no.op]} ${no.value}`
  if (no.kind === 'delta') return `${no.field} variou ${OP_LABEL[no.op]} ${no.value}${no.mode === 'percent' ? '%' : ''}`
  if (no.kind === 'not') return `não (${descreverCondicao(no.child)})`
  const juncao = no.kind === 'and' ? ' e ' : ' ou '
  return no.children.map((c) => (c.kind === 'and' || c.kind === 'or' ? `(${descreverCondicao(c)})` : descreverCondicao(c))).join(juncao)
}

/** Os campos que a condição cita — é o que a simulação precisa preencher. */
export function camposDaCondicao(no: ConditionNode, saida: string[] = []): string[] {
  if (no.kind === 'compare' || no.kind === 'delta') saida.push(no.field)
  else if (no.kind === 'not') camposDaCondicao(no.child, saida)
  else for (const c of no.children) camposDaCondicao(c, saida)
  return [...new Set(saida.filter(Boolean))]
}
