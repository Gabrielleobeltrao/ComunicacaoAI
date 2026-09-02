import { API_URL } from './api'

// O cliente do Knowledge Brain. Uma porta só, como no servidor.

export type KnowledgeScopeType = 'building' | 'floor' | 'sector' | 'agent'
export type LifecycleStatus = 'draft' | 'approved' | 'archived'
export type Authority = 'official_policy' | 'procedure' | 'reference' | 'note'

export const AUTHORITY_LABEL: Record<Authority, string> = {
  official_policy: 'Política oficial',
  procedure: 'Procedimento',
  reference: 'Referência',
  note: 'Nota',
}

export const LIFECYCLE_LABEL: Record<LifecycleStatus, string> = {
  draft: 'Rascunho',
  approved: 'Aprovado',
  archived: 'Arquivado',
}

export const SCOPE_LABEL: Record<KnowledgeScopeType, string> = {
  building: 'Prédio',
  floor: 'Andar',
  sector: 'Setor',
  agent: 'Agente',
}

export interface KnowledgeDoc {
  id: string
  scopeType: KnowledgeScopeType
  scopeId: string | null
  title: string
  format: 'markdown'
  lifecycleStatus: LifecycleStatus
  authority: Authority
  validFrom: string | null
  validUntil: string | null
  verifiedAt: string | null
  verifiedBy: string | null
  reviewIntervalDays: number | null
  confidence: { value: number; method: string } | null
  links: { target: string; resolvedDocumentId?: string | null; label?: string }[]
  source: string | null
  sourceRef: string | null
  indexStatus: 'indexed' | 'pending' | 'error'
  indexError: string | null
  chunkCount: number
  createdAt: string
  updatedAt: string
  /** Só na leitura de UM documento. A listagem não carrega o texto. */
  content?: string
}

export interface DocumentPage {
  items: KnowledgeDoc[]
  total: number
  summary: { manual: number; web: number; total: number; lastWebFetchAt: string | null }
}

/**
 * A recusa do servidor é o texto que importa.
 *
 * "409" não diz nada a quem tentou resolver uma lacuna; "a busca ainda não encontra este
 * documento" diz o que fazer. O corpo é lido antes de virar erro.
 */
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
    throw new Error(corpo?.message ?? corpo?.error ?? `${res.status}`)
  }
  return (res.status === 204 ? (null as T) : ((await res.json()) as T))
}

const api = <T>(caminho: string, init: { method?: string; body?: string } = {}): Promise<T> =>
  fetch(`${API_URL}${caminho}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body,
  }).then(json<T>)

const qs = (params: Record<string, string | number | null | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')

export const listDocuments = (scopeType: KnowledgeScopeType, scopeId: string | null, opts: { q?: string; status?: string; limit?: number; skip?: number } = {}) =>
  api<DocumentPage>(`/api/knowledge/documents?${qs({ scopeType, scopeId, ...opts })}`)

export const getDocument = (id: string) => api<KnowledgeDoc>(`/api/knowledge/documents/${id}`)

export interface DocumentInput {
  scopeType: KnowledgeScopeType
  scopeId: string | null
  title: string
  content: string
  lifecycleStatus?: LifecycleStatus
  authority?: Authority
  validFrom?: string | null
  validUntil?: string | null
  reviewIntervalDays?: number | null
}

export const createDocument = (input: DocumentInput) =>
  api<KnowledgeDoc>('/api/knowledge/documents', { method: 'POST', body: JSON.stringify(input) })

export const updateDocument = (id: string, patch: Partial<DocumentInput>) =>
  api<KnowledgeDoc>(`/api/knowledge/documents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })

export const deleteDocument = (id: string) => api<null>(`/api/knowledge/documents/${id}`, { method: 'DELETE' })

export const reindexDocument = (id: string) => api<KnowledgeDoc>(`/api/knowledge/documents/${id}/reindex`, { method: 'POST' })

// --- o mapa ---------------------------------------------------------------------------

export interface GraphNode {
  id: string
  kind: 'building' | 'floor' | 'sector' | 'agent' | 'document'
  label: string
  ownerType?: KnowledgeScopeType
  ownerId?: string
  color?: string | null
  portraitKey?: string | null
  indexStatus?: 'indexed' | 'pending' | 'error'
  source?: string | null
  flags?: string[]
  counts?: { connections: number; accessibleByAgents: number }
  position?: { x: number; y: number } | null
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: 'contains' | 'references' | 'can_access'
}

export interface KnowledgeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  documentTotal: number
  documentLimit: number
  truncated: boolean
  viewKey: string
}

export const getGraph = (opts: { floorId?: string; viewAs?: string | null; q?: string; status?: string; source?: string; limit?: number; skip?: number } = {}) =>
  api<KnowledgeGraph>(`/api/knowledge/graph?${qs(opts as Record<string, string>)}`)

export const saveLayout = (viewKey: string, positions: { nodeId: string; x: number; y: number }[]) =>
  api<{ saved: number }>('/api/knowledge/graph/layout', { method: 'PUT', body: JSON.stringify({ viewKey, positions }) })

export const clearLayout = (viewKey: string) => api<{ cleared: number }>(`/api/knowledge/graph/layout?viewKey=${encodeURIComponent(viewKey)}`, { method: 'DELETE' })

// --- lacunas, propostas, conflitos, revisão e impacto ------------------------------------

export interface Gap {
  id: string
  scopeType: KnowledgeScopeType
  scopeId: string
  subject: string
  examples: string[]
  count: number
  cause: string
  status: 'open' | 'dismissed' | 'resolved'
  agentIds: string[]
  firstSeenAt: string
  lastSeenAt: string
  resolvedByDocumentId: string | null
}

export const listGaps = (opts: { status?: string; scopeType?: string; scopeId?: string; limit?: number } = {}) =>
  api<{ items: Gap[]; total: number }>(`/api/knowledge/gaps?${qs(opts as Record<string, string>)}`)

export const dismissGap = (id: string) => api<null>(`/api/knowledge/gaps/${id}/dismiss`, { method: 'POST' })
export const resolveGap = (id: string, documentId: string) =>
  api<{ resolved: boolean }>(`/api/knowledge/gaps/${id}/resolve`, { method: 'POST', body: JSON.stringify({ documentId }) })

export interface Proposal {
  id: string
  scopeType: KnowledgeScopeType
  scopeId: string
  title: string
  status: 'pending' | 'approved' | 'rejected' | 'needs_review'
  evidence: { kind: string; ref: string; note?: string }[]
  confidence: { value: number; method: string } | null
  checks: { duplicateOfDocumentId: string | null; conflictsWith: string[]; reason: string | null }
  agentId: string | null
  executionId: string | null
  reviewerId: string | null
  reviewNote: string | null
  documentId: string | null
  createdAt: string
}

export const listProposals = (opts: { status?: string; limit?: number } = {}) =>
  api<{ items: Proposal[]; total: number }>(`/api/knowledge/proposals?${qs(opts as Record<string, string>)}`)

export const approveProposal = (id: string, body: { authority?: Authority; note?: string } = {}) =>
  api<{ id: string; status: string; documentId: string | null }>(`/api/knowledge/proposals/${id}/approve`, { method: 'POST', body: JSON.stringify(body) })

export const rejectProposal = (id: string, note?: string) =>
  api<{ id: string; status: string }>(`/api/knowledge/proposals/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) })

export interface Conflict {
  id: string
  scopeType: KnowledgeScopeType
  scopeId: string
  subject: string
  documentIds: string[]
  values: string[]
  status: 'open' | 'resolved' | 'accepted'
  resolvedBy: string | null
  resolutionNote: string | null
  winnerDocumentId: string | null
  detectedAt: string
}

export const listConflicts = (status = 'open') => api<{ items: Conflict[] }>(`/api/knowledge/conflicts?status=${status}`)
export const scanConflicts = (scopeType: KnowledgeScopeType, scopeId: string | null) =>
  api<{ found: number }>('/api/knowledge/conflicts/scan', { method: 'POST', body: JSON.stringify({ scopeType, scopeId }) })
export const resolveConflict = (id: string, body: { note: string; winnerDocumentId?: string | null; accept?: boolean }) =>
  api<{ id: string; status: string }>(`/api/knowledge/conflicts/${id}/resolve`, { method: 'POST', body: JSON.stringify(body) })

export interface ReviewItem {
  id: string
  title: string
  state: 'due_for_review' | 'expiring_soon' | 'expired'
  validUntil: string | null
  verifiedAt: string | null
  verifiedBy: string | null
  reviewIntervalDays: number | null
  updatedAt: string
}

export const listReview = (scopeType: KnowledgeScopeType, scopeId: string | null) =>
  api<{ items: ReviewItem[] }>(`/api/knowledge/review?${qs({ scopeType, scopeId })}`)

export interface DocumentImpact {
  documentId: string
  title: string
  scopeType: KnowledgeScopeType
  scopeId: string
  accessibleBy: { agentId: string; name: string }[]
  actuallyUsedBy: { executionId: string; executionKind: string; agentId: string | null; at: string }[]
  usedCount: number
  resolvedGaps: { subject: string; count: number }[]
  linkedFrom: { documentId: string; title: string }[]
  proposals: { id: string; title: string; status: string }[]
  openConflicts: { subject: string; documentIds: string[] }[]
  recommendation: 'safe_to_delete' | 'prefer_archive'
}

export const getImpact = (id: string) => api<DocumentImpact>(`/api/knowledge/documents/${id}/impact`)

// --- a política de acesso do agente --------------------------------------------------------

export type SectorAccessMode = 'execution_context' | 'home_sector' | 'selected' | 'none'

export interface KnowledgeAccess {
  own: boolean
  building: boolean
  floor: boolean
  sectorMode: SectorAccessMode
  selectedSectorIds: string[]
  version: number
  /** A política foi escolhida, ou é o padrão? Dizer "configurado" sobre um default mente. */
  configured: boolean
}

export const getKnowledgeAccess = (agentId: string) => api<KnowledgeAccess>(`/api/agents/${agentId}/knowledge-access`)

export const setKnowledgeAccess = (agentId: string, policy: Omit<KnowledgeAccess, 'version' | 'configured'>) =>
  api<KnowledgeAccess>(`/api/agents/${agentId}/knowledge-access`, { method: 'PUT', body: JSON.stringify(policy) })

export interface ResolvedAccess {
  policy: KnowledgeAccess
  owners: { ownerType: KnowledgeScopeType; ownerId: string; reason: string; name: string | null }[]
}

export const getResolvedAccess = (agentId: string) => api<ResolvedAccess>(`/api/agents/${agentId}/knowledge-access/resolved`)

