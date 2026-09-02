import { API_URL } from './api'

// O cliente do catálogo comum de recursos.

export type ResourceKind = 'knowledge' | 'app' | 'database' | 'tool'

export const KIND_LABEL: Record<ResourceKind, string> = {
  knowledge: 'Conhecimento',
  app: 'Apps',
  database: 'Databases',
  tool: 'Ferramentas',
}

export const KIND_SINGULAR: Record<ResourceKind, string> = {
  knowledge: 'Documento',
  app: 'App',
  database: 'Database',
  tool: 'Ferramenta',
}

export interface ResourceSummary {
  kind: ResourceKind
  id: string
  name: string
  description?: string
  owner: { ownerType: string; ownerId: string }
  status?: string
  flags?: string[]
  updatedAt?: string
}

export interface ResourceDetail extends ResourceSummary {
  capabilities: string[]
  meta: Record<string, unknown>
}

export interface AccessDecision {
  allowed: boolean
  capabilities: string[]
  origin: 'direct' | 'sector' | 'floor' | 'building' | 'specialized_policy' | 'owner' | 'none'
  reason: string
  pending?: { code: string; message: string } | null
}

export const ORIGIN_LABEL: Record<AccessDecision['origin'], string> = {
  direct: 'direto',
  sector: 'pelo setor',
  floor: 'pelo andar',
  building: 'pelo prédio',
  specialized_policy: 'pela política',
  owner: 'você administra',
  none: '—',
}

export interface AccessRow {
  kind: ResourceKind
  resourceId: string
  name: string
  allowed: boolean
  capabilities: string[]
  origin: AccessDecision['origin']
  reason: string
  pending: { code: string; message: string } | null
}

export interface ResourceImpact {
  resource: { kind: ResourceKind; id: string }
  accessibleBy: { subjectType: string; subjectId: string; name: string }[]
  usedBy: { executionId: string; kind: string; at: string }[]
  usedCount: number
  dependents: { kind: string; id: string; name: string; reason: string }[]
  recommendation: 'safe_to_delete' | 'prefer_archive'
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
    throw new Error(corpo?.message ?? corpo?.error ?? `${res.status}`)
  }
  return (res.status === 204 ? (null as T) : ((await res.json()) as T))
}

const get = <T>(caminho: string) => fetch(`${API_URL}${caminho}`, { credentials: 'include' }).then(json<T>)

const qs = (p: Record<string, string | number | null | undefined>) =>
  Object.entries(p)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')

export const listResources = (opts: { kind?: string; scopeType?: string; scopeId?: string; access?: 'owned' | 'available'; q?: string; limit?: number } = {}) =>
  get<{ items: ResourceSummary[]; byKind: Record<string, number>; kinds: ResourceKind[] }>(`/api/resources?${qs(opts)}`)

export const getResource = (kind: ResourceKind, id: string) => get<ResourceDetail>(`/api/resources/${kind}/${id}`)

export const getResourceAccess = (kind: ResourceKind, id: string, agentId?: string) =>
  get<AccessDecision>(`/api/resources/${kind}/${id}/access?${qs({ agentId })}`)

export const getResourceImpact = (kind: ResourceKind, id: string) => get<ResourceImpact>(`/api/resources/${kind}/${id}/impact`)

/** A matriz do agente: tudo o que existe, com a decisão de cada um — inclusive as negativas. */
export const getAgentResourceAccess = (agentId: string) => get<{ items: AccessRow[] }>(`/api/agents/${agentId}/resource-access`)
