import { API_URL } from './api'

// Shared SECTOR knowledge — a curated base the whole team reads. Same store as the
// agent knowledge base (documents/chunks/embeddings), just owned by the sector.
export interface SectorDocument {
  _id: string
  title: string
  source: 'manual' | 'run' | 'conversation' | string
  sourceRef: string | null
  authorId: string | null
  indexStatus: 'indexed' | 'pending' | 'error'
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export interface SectorDocumentDetail extends SectorDocument {
  content: string
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

const base = (sectorId: string) => `${API_URL}/api/sectors/${sectorId}/documents`

export const listSectorDocuments = (sectorId: string) => fetch(base(sectorId), req('GET')).then(json<SectorDocument[]>)
export const getSectorDocument = (sectorId: string, documentId: string) => fetch(`${base(sectorId)}/${documentId}`, req('GET')).then(json<SectorDocumentDetail>)
export const createSectorDocument = (sectorId: string, input: { title: string; content: string; source?: string; sourceRef?: string }) =>
  fetch(base(sectorId), req('POST', input)).then(json<SectorDocument>)
export const updateSectorDocument = (sectorId: string, documentId: string, input: { title?: string; content?: string }) =>
  fetch(`${base(sectorId)}/${documentId}`, req('PATCH', input)).then(json<SectorDocument>)
export const deleteSectorDocument = async (sectorId: string, documentId: string) => {
  const res = await fetch(`${base(sectorId)}/${documentId}`, req('DELETE'))
  if (!res.ok) throw new Error(String(res.status))
}

export const SOURCE_LABEL: Record<string, string> = {
  manual: 'Escrito aqui',
  run: 'Salvo de uma execução',
  conversation: 'Salvo de uma conversa',
}
export const INDEX_STATUS_LABEL: Record<SectorDocument['indexStatus'], string> = {
  indexed: 'Indexado',
  pending: 'Indexando…',
  error: 'Falha ao indexar',
}
