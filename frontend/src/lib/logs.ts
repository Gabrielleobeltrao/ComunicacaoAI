import { API_URL } from './api'
import type { RunStatus } from './executions'

// Client + labels for "Logs e auditoria". Two timelines over data that already
// exists: executions (read from the runs, never copied) and changes (the append-only
// audit trail). Both are cursor-paged, so paging never repeats or skips a row.

export type LogTab = 'runs' | 'audit'

export type AuditActorType = 'user' | 'system' | 'agent'
export type AuditResult = 'success' | 'failure'
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'activate'
  | 'pause'
  | 'archive'
  | 'restore'
  | 'move'
  | 'rotate'
  | 'publish'
  | 'test'
  | 'disconnect'
export type AuditEntityType =
  | 'agent'
  | 'sector'
  | 'floor'
  | 'building'
  | 'tool'
  | 'channel'
  | 'connection'
  | 'routine'
  | 'event_trigger'
  | 'automation'
  | 'knowledge'
  | 'settings'

export interface AgentRef {
  id: string
  name: string
  objective: string
}
export interface PlaceRef {
  floorId: string | null
  floorName: string | null
  sectorId: string | null
  sectorName: string | null
}

export interface RunLogItem {
  id: string
  automationId: string
  name: string
  status: RunStatus
  triggerType: string
  agent: AgentRef | null
  place: PlaceRef
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  tokens: number
  errorKind: string | null
  steps: number
  deliveries: number
  artifacts: number
}

export interface RunLogDetail {
  id: string
  automationId: string
  automationVersion: number
  status: RunStatus
  triggerType: string
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  requestId: string | null
  usage: { inputTokens: number; outputTokens: number }
  error: { kind: string; message: string } | null
  steps: { id: string; stepId: string; stepType: string; attempt: number; status: string; startedAt: string | null; finishedAt: string | null; error: { kind: string; message: string } | null }[]
  deliveries: { id: string; provider: string; destinationMasked: string; status: string; attempt: number; createdAt: string; sentAt: string | null; error: { kind: string; message: string } | null }[]
  artifacts: { id: string; name: string; kind: string; mimeType: string; sizeBytes: number; createdAt: string }[]
}

export interface AuditLogItem {
  id: string
  actorType: AuditActorType
  actorId: string | null
  action: AuditAction
  entityType: AuditEntityType
  entityId: string | null
  // The entity's current name, or the one captured before it was deleted.
  entityLabel: string | null
  floorId: string | null
  result: AuditResult
  occurredAt: string
  requestId: string
  metadata: Record<string, string | number | boolean>
}

export interface LogPage<T> {
  items: T[]
  nextCursor: string | null
}

export interface RunLogFilters {
  floorId?: string
  sectorId?: string
  agentId?: string
  status?: string
  triggerType?: string
  from?: string
  to?: string
}

export interface AuditLogFilters {
  actorId?: string
  actorType?: string
  action?: string
  entityType?: string
  entityId?: string
  floorId?: string
  result?: string
  from?: string
  to?: string
  // Free text over the entity: its id, or the name kept for a deleted one.
  q?: string
}

const get = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export function logsQuery(path: string, filters: RunLogFilters | AuditLogFilters, page: { limit: number; cursor?: string }): string {
  const params = new URLSearchParams({ limit: String(page.limit) })
  if (page.cursor) params.set('cursor', page.cursor)
  for (const [key, value] of Object.entries(filters as Record<string, string | undefined>)) {
    if (value) params.set(key, value)
  }
  return `${path}?${params.toString()}`
}

export const listRunLogs = (filters: RunLogFilters, page: { limit: number; cursor?: string }) =>
  get<LogPage<RunLogItem>>(logsQuery('/api/logs/runs', filters, page))

export const getRunLogDetail = (id: string) => get<RunLogDetail>(`/api/logs/runs/${id}`)

export const listAuditLogs = (filters: AuditLogFilters, page: { limit: number; cursor?: string }) =>
  get<LogPage<AuditLogItem>>(logsQuery('/api/logs/audit', filters, page))

// --- labels ------------------------------------------------------------------------

export const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Manual',
  schedule: 'Agendada',
  webhook: 'Evento',
}

export const ACTION_LABEL: Record<AuditAction, string> = {
  create: 'criou',
  update: 'editou',
  delete: 'excluiu',
  activate: 'ativou',
  pause: 'pausou',
  archive: 'arquivou',
  restore: 'restaurou',
  move: 'moveu',
  rotate: 'gerou nova credencial de',
  publish: 'publicou',
  test: 'testou',
  disconnect: 'desconectou',
}

export const ENTITY_LABEL: Record<AuditEntityType, string> = {
  agent: 'agente',
  sector: 'setor',
  floor: 'andar',
  building: 'prédio',
  tool: 'ferramenta',
  channel: 'canal',
  connection: 'conexão',
  routine: 'rotina',
  event_trigger: 'gatilho',
  automation: 'automação',
  knowledge: 'conhecimento',
  settings: 'configurações',
}

// Portuguese needs the article to agree with the noun; without it the sentence reads
// broken ("o ferramenta"). Kept beside the labels so the two never drift.
export const ENTITY_ARTICLE: Record<AuditEntityType, string> = {
  agent: 'o',
  sector: 'o',
  floor: 'o',
  building: 'o',
  tool: 'a',
  channel: 'o',
  connection: 'a',
  routine: 'a',
  event_trigger: 'o',
  automation: 'a',
  knowledge: 'o',
  settings: 'as',
}

export const ACTOR_LABEL: Record<AuditActorType, string> = {
  user: 'Você',
  system: 'Sistema',
  agent: 'Agente',
}

// "Você editou o agente Pesquisador Político" — the sentence a person reads, built
// from the closed vocabulary the backend stores plus the entity's own name when
// there is one. Without a name it degrades to the plain form instead of inventing.
export function describeAudit(event: AuditLogItem): string {
  const actor = ACTOR_LABEL[event.actorType] ?? 'Alguém'
  const action = ACTION_LABEL[event.action] ?? event.action
  const entity = ENTITY_LABEL[event.entityType] ?? event.entityType
  const named = event.entityLabel ? `${ENTITY_ARTICLE[event.entityType] ?? 'o'} ${entity} ${event.entityLabel}` : entity
  return `${actor} ${action} ${named}`
}

// Where an audited entity can be opened, when the app has a page for it. null keeps
// the row as a plain record — a deleted entity has nowhere to go.
export function auditLink(event: AuditLogItem): string | null {
  if (!event.entityId || event.action === 'delete') return null
  const floor = event.floorId
  switch (event.entityType) {
    case 'agent':
      return floor ? `/floors/${floor}/agents/${event.entityId}` : `/agents/${event.entityId}`
    case 'routine':
    case 'event_trigger':
      // The entity id is the routine/trigger; the agent page is where it lives.
      return '/executions'
    case 'sector':
      return floor ? `/floors/${floor}/sectors/${event.entityId}` : `/setores/${event.entityId}`
    case 'floor':
      return `/floors/${event.entityId}`
    case 'tool':
      return '/tools'
    case 'channel':
      return '/widgets'
    default:
      return null
  }
}

// A duration a person can read: milliseconds are noise above a second.
export function durationLabel(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes} min ${seconds}s`
}
