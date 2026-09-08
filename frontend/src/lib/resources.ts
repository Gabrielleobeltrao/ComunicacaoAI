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




/** A matriz do agente: tudo o que existe, com a decisão de cada um — inclusive as negativas. */
export const getAgentResourceAccess = (agentId: string) => get<{ items: AccessRow[] }>(`/api/agents/${agentId}/resource-access`)
