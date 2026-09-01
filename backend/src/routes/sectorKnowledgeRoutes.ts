import { Router } from 'express'
import type { Response } from 'express'
import { ObjectId } from 'mongodb'
import { getSectorById } from '../sectors.js'
import { listDocumentsFor } from '../knowledge.js'
import type { KnowledgeDocument } from '../knowledge.js'
import { KnowledgeQuotaError, KnowledgeValidationError, getDocument, removeDocument, reindexDocument, saveDocument, updateDocument } from '../knowledgeService.js'
import { oid } from './http.js'

// Shared SECTOR knowledge — a curated base the whole team reads, reusing the same
// documents/chunks/embeddings/vector index as agent knowledge (no second RAG).
// Mounted at /api/sectors/:sectorId behind requireAuth. Every route resolves the
// sector through the OWNER's scope first, so an ObjectId from another tenant simply
// 404s — never leaks.
//
// ADAPTADOR: o contrato desta rota não muda (é o que a tela do setor consome), mas
// quem grava é `knowledgeService`. Era aqui que faltava a conferência de cota — o
// caminho do agente conferia, o do setor não, e dava para encher o disco pelo setor.
// Com uma camada só, a regra deixa de depender de qual porta alguém usou.
export const sectorKnowledgeRouter = Router({ mergeParams: true })

// Content limits: a curated note, not a file dump.
const MAX_TITLE = 200
const MAX_CONTENT = 100_000

function serialize(doc: KnowledgeDocument | (Omit<KnowledgeDocument, '_id'> & { _id: ObjectId })) {
  return {
    _id: doc._id.toString(),
    title: doc.title,
    source: doc.source ?? 'manual',
    sourceRef: doc.sourceRef ?? null,
    authorId: doc.authorId ?? null,
    indexStatus: doc.indexStatus ?? 'indexed',
    chunkCount: doc.chunkCount ?? 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

/** A recusa da camada compartilhada, traduzida sem mudar o que a tela já lia. */
function recusa(res: Response, erro: unknown): boolean {
  if (erro instanceof KnowledgeQuotaError) {
    res.status(413).json({ error: erro.message, code: erro.code })
    return true
  }
  if (erro instanceof KnowledgeValidationError) {
    res.status(400).json({ error: erro.message })
    return true
  }
  return false
}

async function requireSector(ownerId: string, raw: string): Promise<ObjectId | null> {
  const id = oid(raw)
  if (!id) return null
  const sector = await getSectorById(ownerId, id) // owner-scoped: another tenant's id yields null
  return sector ? sector._id : null
}

function parseBody(body: Record<string, unknown>, requireContent: boolean): { title?: string; content?: string; error?: string } {
  const title = typeof body.title === 'string' ? body.title.trim() : undefined
  const content = typeof body.content === 'string' ? body.content : undefined
  if (requireContent && (!title || !content)) return { error: 'title and content are required' }
  if (title !== undefined && (!title || title.length > MAX_TITLE)) return { error: `title must be 1..${MAX_TITLE} characters` }
  if (content !== undefined && content.length > MAX_CONTENT) return { error: `content must be at most ${MAX_CONTENT} characters` }
  return { title, content }
}

sectorKnowledgeRouter.get('/documents', async (req, res) => {
  const sectorId = await requireSector(res.locals.userId, String((req.params as Record<string, string>).sectorId))
  if (!sectorId) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }
  const docs = await listDocumentsFor({ ownerType: 'sector', ownerId: sectorId })
  res.json(docs.map(serialize))
})

sectorKnowledgeRouter.post('/documents', async (req, res) => {
  const sectorId = await requireSector(res.locals.userId, String((req.params as Record<string, string>).sectorId))
  if (!sectorId) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }
  const { title, content, error } = parseBody(req.body ?? {}, true)
  if (error) {
    res.status(400).json({ error })
    return
  }
  // `source`/`sourceRef` describe provenance for an explicit "save to the sector
  // knowledge" action (a run/conversation the user chose to keep) — never automatic.
  const rawSource = typeof (req.body ?? {}).source === 'string' ? String((req.body as Record<string, unknown>).source) : 'manual'
  const source = ['manual', 'run', 'conversation'].includes(rawSource) ? rawSource : 'manual'
  const sourceRef = typeof (req.body ?? {}).sourceRef === 'string' ? String((req.body as Record<string, unknown>).sourceRef).slice(0, 200) : null
  try {
    const doc = await saveDocument(res.locals.userId, { ownerType: 'sector', ownerId: sectorId }, { title: title!, content: content!, source, sourceRef, authorId: res.locals.userId })
    res.status(201).json(serialize(doc))
  } catch (e) {
    if (recusa(res, e)) return
    console.error('Failed to create sector knowledge document:', e)
    res.status(502).json({ error: 'Failed to process document. Check the embedding service configuration.' })
  }
})

sectorKnowledgeRouter.get('/documents/:documentId', async (req, res) => {
  const params = req.params as Record<string, string>
  const sectorId = await requireSector(res.locals.userId, String(params.sectorId))
  const documentId = oid(String(params.documentId))
  if (!sectorId || !documentId) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const doc = await getDocument({ ownerType: 'sector', ownerId: sectorId }, documentId)
  if (!doc) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  res.json({ ...serialize(doc), content: doc.content })
})

sectorKnowledgeRouter.patch('/documents/:documentId', async (req, res) => {
  const params = req.params as Record<string, string>
  const sectorId = await requireSector(res.locals.userId, String(params.sectorId))
  const documentId = oid(String(params.documentId))
  if (!sectorId || !documentId) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const { title, content, error } = parseBody(req.body ?? {}, false)
  if (error) {
    res.status(400).json({ error })
    return
  }
  if (title === undefined && content === undefined) {
    res.status(400).json({ error: 'Nothing to update' })
    return
  }
  try {
    const doc = await updateDocument(res.locals.userId, { ownerType: 'sector', ownerId: sectorId }, documentId, { title, content })
    if (!doc) {
      res.status(404).json({ error: 'Document not found' })
      return
    }
    res.json(serialize(doc))
  } catch (e) {
    if (recusa(res, e)) return
    console.error('Failed to update sector knowledge document:', e)
    res.status(502).json({ error: 'Failed to process document.' })
  }
})

// "Tentar novamente": re-run indexing for a document whose last attempt failed.
sectorKnowledgeRouter.post('/documents/:documentId/reindex', async (req, res) => {
  const params = req.params as Record<string, string>
  const sectorId = await requireSector(res.locals.userId, String(params.sectorId))
  const documentId = oid(String(params.documentId))
  if (!sectorId || !documentId) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const doc = await reindexDocument({ ownerType: 'sector', ownerId: sectorId }, documentId)
  if (!doc) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  res.json(serialize(doc))
})

sectorKnowledgeRouter.delete('/documents/:documentId', async (req, res) => {
  const params = req.params as Record<string, string>
  const sectorId = await requireSector(res.locals.userId, String(params.sectorId))
  const documentId = oid(String(params.documentId))
  if (!sectorId || !documentId) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const deleted = await removeDocument({ ownerType: 'sector', ownerId: sectorId }, documentId)
  if (!deleted) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  res.status(204).end()
})
