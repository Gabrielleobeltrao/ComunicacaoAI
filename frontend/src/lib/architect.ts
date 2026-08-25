import { API_URL } from './api'

/**
 * “Montar operação”, do lado da tela.
 *
 * Nada aqui monta recurso: as telas conversam, revisam e confirmam. Quem cria é o
 * servidor, e só depois de receber o hash da proposta que a pessoa de fato revisou.
 */

export type ArchitectStatus = 'discovery' | 'draft' | 'ready' | 'applying' | 'applied' | 'failed' | 'archived'

export interface ArchitectReadiness {
  requiredDone: number
  requiredTotal: number
  optionalDone: number
  optionalTotal: number
  ready: boolean
  blockers: string[]
}

export interface ChecklistItem {
  id: string
  category: 'structure' | 'knowledge' | 'app' | 'channel' | 'routine' | 'test' | 'review'
  title: string
  description: string
  required: boolean
  status: 'pending' | 'blocked' | 'ready' | 'done'
  completionMode: 'manual' | 'resource_state' | 'connection_state' | 'test_result'
  target?: { kind: string; key: string; id?: string }
  actionPath?: string
  dependsOn: string[]
}

export interface ArchitectQuestion {
  key: string
  text: string
  why: string
  choices?: { value: string; label: string }[]
  allowUnknown: boolean
}

export interface BlueprintIssue {
  path: string
  code: string
  message: string
  severity: 'error' | 'warning'
  suggestedAction?: string
}

export interface ArchitectLink {
  kind: string
  key: string
  id: string
  path: string
}

export interface ArchitectTargets {
  floors: { id: string; name: string }[]
  agents: { id: string; name: string; floorId: string }[]
  sectors: { id: string; name: string; floorId: string }[]
  routines: { id: string; name: string; status: string }[]
}

export interface BlueprintLink {
  kind: 'floor' | 'agent' | 'sector' | 'routine'
  key: string
  action: 'create' | 'reuse' | 'update'
  resourceId?: string | null
}

export interface ApplyStep {
  kind: string
  key: string
  status: string
  message?: string
  resourceId?: string | null
}

export interface ArchitectProject {
  id: string
  title: string
  objective: string
  status: ArchitectStatus
  locale: string
  readiness: ArchitectReadiness
  hasBlueprint: boolean
  createdAt: string
  updatedAt: string
  appliedAt: string | null
  provider?: 'anthropic' | 'openai'
  model?: string | null
  answers?: Record<string, unknown>
  pendingQuestion?: { key: string; text: string } | null
  assumptions?: { key: string; text: string; questionKey?: string }[]
  blueprint?: Blueprint | null
  blueprintHash?: string | null
  checklist?: ChecklistItem[]
  applyState?: { operationId: string; status: string; error: string | null } | null
  /** Vem junto no GET: um reload de projeto aplicado precisa reconstruí-los. */
  links?: ArchitectLink[]
}

export interface Blueprint {
  title: string
  objective: string
  floors: { key: string; name: string; workMode: string; rationale?: string }[]
  agents: { key: string; name: string; floorKey: string; objective?: string; rationale?: string }[]
  sectors: { key: string; name: string; mode: string; memberAgentKeys: string[]; coordinatorAgentKey?: string | null; rationale?: string }[]
  routines: { key: string; name: string; ownerAgentKey: string }[]
  appRequirements: { key: string; appKey: string; reason: string; required: boolean }[]
  knowledgeRequirements: { key: string; title: string; description: string; required: boolean; state: string }[]
  assumptions: { key: string; text: string }[]
  warnings: { path: string; message: string }[]
}

export interface PreviewItem {
  kind: 'floor' | 'agent' | 'sector' | 'routine' | 'app' | 'knowledge'
  key: string
  label: string
  action: 'create' | 'reuse' | 'update' | 'wait_user'
  detail: string
  dependsOn: string[]
  usesLlm: boolean
  requiresApproval: boolean
  issues: BlueprintIssue[]
}

export interface ArchitectPreview {
  blueprintHash: string
  valid: boolean
  issues: BlueprintIssue[]
  items: PreviewItem[]
  checklist: ChecklistItem[]
  readiness: ArchitectReadiness
  counts: { create: number; reuse: number; update: number; waitUser: number }
}

export interface ArchitectMessage {
  id: string
  role: 'user' | 'assistant' | 'system_notice'
  content: string
  createdAt: string
}

export interface TurnResponse extends ArchitectProject {
  assistantText: string
  question: ArchitectQuestion | null
  secretMasked?: boolean
}

export interface ApplyResponse extends ArchitectProject {
  operation: { id: string; status: string; steps: ApplyStep[]; error: string | null } | null
  links: ArchitectLink[]
}

/** O erro carrega o código do servidor: a tela reage a cada recusa de um jeito. */
export class ArchitectError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_URL}/api/architect${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string; error?: string } | null
    throw new ArchitectError(body?.code ?? 'error', body?.message ?? body?.error ?? 'Não foi possível concluir.')
  }
  return res.status === 204 ? (null as T) : ((await res.json()) as T)
}

export const listProjects = (includeArchived = false) => request<ArchitectProject[]>(`/projects${includeArchived ? '?includeArchived=true' : ''}`)
export const createProject = (objective: string) => request<ArchitectProject>('/projects', { method: 'POST', body: JSON.stringify({ objective }) })
export const getProject = (id: string) => request<ArchitectProject>(`/projects/${id}`)
export const listMessages = (id: string) => request<ArchitectMessage[]>(`/projects/${id}/messages`)
export const sendMessage = (id: string, content: string, forceProposal = false) =>
  request<TurnResponse>(`/projects/${id}/messages`, { method: 'POST', body: JSON.stringify({ content, forceProposal }) })
export const generateProposal = (id: string) => request<TurnResponse>(`/projects/${id}/generate`, { method: 'POST' })
/** Uma rodada sem mensagem nova — é o que responde à descrição inicial. */
export const advanceTurn = (id: string) => request<TurnResponse>(`/projects/${id}/turn`, { method: 'POST', body: JSON.stringify({}) })
export const validateProject = (id: string) => request<{ valid: boolean; issues: BlueprintIssue[] }>(`/projects/${id}/validate`, { method: 'POST' })
export const previewProject = (id: string) => request<ArchitectPreview>(`/projects/${id}/preview`)
export const listTargets = () => request<ArchitectTargets>('/targets')
export const setLinks = (id: string, links: BlueprintLink[]) => request<ArchitectProject>(`/projects/${id}/links`, { method: 'PATCH', body: JSON.stringify({ links }) })
export const rollbackProject = (id: string) => request<ArchitectProject & { removed: string[]; kept: { key: string; reason: string }[] }>(`/projects/${id}/rollback`, { method: 'POST' })
export const listProviders = () =>
  fetch(`${API_URL}/api/providers`, { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : []))
    .then((v) => v as { id: 'anthropic' | 'openai'; label: string; models: string[]; defaultModel: string; configured: boolean }[])
export const patchProject = (id: string, patch: { provider?: 'anthropic' | 'openai'; model?: string | null; title?: string }) =>
  request<ArchitectProject>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })

export const applyProject = (id: string, body: { blueprintHash: string; idempotencyKey: string; approvedAppKeys: string[]; approvedUpdateKeys: string[] }) =>
  request<ApplyResponse>(`/projects/${id}/apply`, { method: 'POST', body: JSON.stringify({ ...body, confirm: true }) })
export const resumeProject = (id: string) => request<ApplyResponse>(`/projects/${id}/resume`, { method: 'POST' })
export const recheckProject = (id: string) => request<ApplyResponse>(`/projects/${id}/recheck`, { method: 'POST' })
export const markChecklistItem = (id: string, itemId: string, done: boolean) =>
  request<ArchitectProject>(`/projects/${id}/checklist/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify({ done }) })
export const archiveProject = (id: string) => request<ArchitectProject>(`/projects/${id}/archive`, { method: 'POST' })

/**
 * A chave da operação, estável enquanto a aba estiver aberta e o hash for o mesmo.
 *
 * Sem isso, um clique duplo em "aplicar" seria duas operações; e uma nova revisão
 * precisa de chave nova, senão a segunda aplicação devolveria o resultado da primeira.
 */
export const idempotencyKeyFor = (projectId: string, hash: string): string => `${projectId}:${hash.slice(0, 16)}`
