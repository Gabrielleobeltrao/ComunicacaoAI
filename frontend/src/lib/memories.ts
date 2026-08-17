import { API_URL } from './api'
import type { MemoryScope } from './agentRoutines'

// A memória vista de fora. Tudo é escopado à conta pelo servidor: a lista de lugares
// vem de lá pronta, e a interface nunca inventa um destino.

export interface MemoryScopeSummary {
  scope: MemoryScope
  scopeKey: string
  label: string
  count: number
  lastAt: string | null
}

export interface MemoryRecord {
  id: string
  scope: MemoryScope
  scopeKey: string
  scopeLabel: string | null
  key: string
  payload: unknown
  sourceType: string
  sourceId: string | null
  metadata: Record<string, unknown>
  dedupeKey: string | null
  createdAt: string
  updatedAt: string
  expiresAt: string | null
}

export interface MemoryQuery {
  scopeKey?: string | null
  scope?: MemoryScope | null
  q?: string | null
  key?: string | null
  sourceType?: string | null
  limit?: number
  skip?: number
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(String(res.status))
  return res.json() as Promise<T>
}
const req = (method: string, body?: unknown): RequestInit => ({
  method,
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

const base = `${API_URL}/api/memories`

export const listMemoryScopes = (floorId?: string | null) =>
  fetch(`${base}/scopes${floorId ? `?floorId=${encodeURIComponent(floorId)}` : ''}`, req('GET')).then(json<MemoryScopeSummary[]>)

export const searchMemories = (q: MemoryQuery = {}) => {
  const params = new URLSearchParams()
  if (q.scopeKey) params.set('scopeKey', q.scopeKey)
  if (q.scope) params.set('scope', q.scope)
  if (q.q) params.set('q', q.q)
  if (q.key) params.set('key', q.key)
  if (q.sourceType) params.set('sourceType', q.sourceType)
  if (q.limit) params.set('limit', String(q.limit))
  if (q.skip) params.set('skip', String(q.skip))
  const qs = params.toString()
  return fetch(`${base}${qs ? `?${qs}` : ''}`, req('GET')).then(json<{ items: MemoryRecord[]; total: number }>)
}

export const deleteMemory = (id: string) => fetch(`${base}/${id}`, req('DELETE')).then(json<{ deleted: number }>)

// Limpar exige o destino: sem ele o servidor recusa, porque apagar a memória inteira
// do prédio não é um erro do qual se volta.
export const clearMemories = (scopeKey: string, key?: string | null) =>
  fetch(`${base}/clear`, req('POST', { scopeKey, ...(key ? { key } : {}) })).then(json<{ deleted: number }>)
