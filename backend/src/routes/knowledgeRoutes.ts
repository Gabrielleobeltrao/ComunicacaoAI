import { Router } from 'express'
import type { Response } from 'express'
import multer from 'multer'
import { getProviderApiKey } from '../userSettings.js'
import { parseScopeRef, providerForScope, resolveKnowledgeOwner } from '../knowledgeScope.js'
import {
  KnowledgeQuotaError,
  KnowledgeValidationError,
  extractUpload,
  getDocument,
  listPage,
  parseCuration,
  reindexDocument,
  removeDocument,
  saveDocument,
  serializeDocument,
  updateDocument,
} from '../knowledgeService.js'
import type { KnowledgeDocument } from '../knowledge.js'
import { oid, notFound } from './http.js'

// A API ÚNICA do conhecimento — os quatro escopos pela mesma porta.
//
// As rotas antigas (`/api/agents/:id/documents`, `/api/sectors/:id/documents`) continuam
// existindo e continuam com o mesmo contrato: elas são adaptadores desta mesma camada.
// Removê-las agora quebraria a tela que está em produção para não ganhar nada — o que
// importa é que exista UM lugar onde a regra mora, e não que exista um caminho só.
//
// Toda rota resolve o dono pelo servidor. O `scopeId` que chega é um pedido; o que
// decide é `resolveKnowledgeOwner`, que passa pelo getter dono-a-dono. Recurso de outra
// conta responde 404 igual ao que não existe.

export const knowledgeRouter = Router()

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })

const recusa = (res: Response, erro: unknown): boolean => {
  if (erro instanceof KnowledgeQuotaError) {
    res.status(413).json({ code: erro.code, error: erro.message, message: erro.message })
    return true
  }
  if (erro instanceof KnowledgeValidationError) {
    res.status(400).json({ code: erro.code, error: erro.message, message: erro.message })
    return true
  }
  return false
}

/** O dono do pedido, já conferido contra a conta da sessão. `null` → 404 e nada mais. */
async function donoDoPedido(res: Response, scopeType: unknown, scopeId: unknown) {
  const ref = parseScopeRef(scopeType, scopeId)
  if (!ref) return null
  return resolveKnowledgeOwner(res.locals.userId, ref)
}

/** O dono de um documento existente — descoberto pelo id, e reconferido contra a conta. */
async function donoDoDocumento(res: Response, documentId: string) {
  const id = oid(documentId)
  if (!id) return null
  const { db } = await import('../db.js')
  const bruto = await db.collection<KnowledgeDocument>('knowledge_documents').findOne({ _id: id }, { projection: { ownerType: 1, ownerId: 1, agentId: 1 } })
  if (!bruto) return null
  // Documento legado só tem `agentId`: o dono dele é o agente, e a conferência de conta
  // é a mesma. Sem este ramo, o que foi gravado antes do modelo de donos ficaria
  // inalcançável pela API nova.
  const scopeType = bruto.ownerType ?? 'agent'
  const scopeId = (bruto.ownerId ?? bruto.agentId)?.toString()
  const owner = await donoDoPedido(res, scopeType, scopeId)
  return owner ? { owner, documentId: id } : null
}

knowledgeRouter.get('/documents', async (req, res) => {
  const owner = await donoDoPedido(res, req.query.scopeType, req.query.scopeId)
  if (!owner) return notFound(res)
  const pagina = await listPage(owner, {
    status: req.query.status === 'indexed' || req.query.status === 'pending' || req.query.status === 'error' ? req.query.status : null,
    search: typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : null,
    limit: Number(req.query.limit) || 50,
    skip: Number(req.query.skip) || 0,
  })
  // Sem o conteúdo, e não por engano: uma base alimentada por um site tem centenas de
  // artigos, e mandar todos inteiros seria megabytes para desenhar uma lista.
  res.json({
    items: pagina.items.map((d) => serializeDocument(d as KnowledgeDocument)),
    total: pagina.total,
    summary: pagina.summary,
  })
})

knowledgeRouter.post('/documents', async (req, res, next) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const owner = await donoDoPedido(res, body.scopeType, body.scopeId)
  if (!owner) return notFound(res)
  try {
    const doc = await saveDocument(res.locals.userId, owner, {
      title: String(body.title ?? ''),
      content: typeof body.content === 'string' ? body.content : '',
      source: typeof body.source === 'string' && ['manual', 'run', 'conversation'].includes(body.source) ? body.source : 'manual',
      sourceRef: typeof body.sourceRef === 'string' ? body.sourceRef.slice(0, 200) : null,
      authorId: res.locals.userId,
      ...parseCuration(body),
    })
    res.status(201).json(serializeDocument(doc))
  } catch (erro) {
    if (recusa(res, erro)) return
    console.error('Failed to create knowledge document:', erro)
    res.status(502).json({ error: 'Failed to process document. Check the embedding service configuration.' })
  }
})

knowledgeRouter.post('/documents/upload', upload.single('file'), async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const owner = await donoDoPedido(res, body.scopeType, body.scopeId)
  if (!owner) return notFound(res)
  if (!req.file || !String(body.title ?? '').trim()) {
    res.status(400).json({ error: 'title and file are required' })
    return
  }
  try {
    const provider = await providerForScope(res.locals.userId, owner)
    const apiKey = provider ? await getProviderApiKey(res.locals.userId, provider) : null
    const content = await extractUpload(req.file.buffer, req.file.mimetype, provider, apiKey)
    const doc = await saveDocument(res.locals.userId, owner, {
      title: String(body.title),
      content,
      authorId: res.locals.userId,
      // O texto extraído de um PDF passa de cem mil caracteres com facilidade; aqui
      // quem limita é a cota, que mede o que de fato ocupa espaço.
      maxContent: null,
      ...parseCuration(body),
    })
    res.status(201).json(serializeDocument(doc))
  } catch (erro) {
    if (recusa(res, erro)) return
    console.error('Failed to process uploaded document:', erro)
    res.status(502).json({ error: 'Failed to process the uploaded file.' })
  }
})

knowledgeRouter.get('/documents/:documentId', async (req, res) => {
  const alvo = await donoDoDocumento(res, String(req.params.documentId))
  if (!alvo) return notFound(res)
  const doc = await getDocument(alvo.owner, alvo.documentId)
  if (!doc) return notFound(res)
  // O conteúdo vem AQUI, e só aqui: é o pedido por um documento, não por uma lista.
  res.json(serializeDocument(doc, { withContent: true }))
})

knowledgeRouter.patch('/documents/:documentId', async (req, res) => {
  const alvo = await donoDoDocumento(res, String(req.params.documentId))
  if (!alvo) return notFound(res)
  const body = (req.body ?? {}) as Record<string, unknown>
  try {
    const updates = {
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.content === 'string' ? { content: body.content } : {}),
      ...parseCuration(body),
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'Nothing to update' })
      return
    }
    const doc = await updateDocument(res.locals.userId, alvo.owner, alvo.documentId, updates)
    if (!doc) return notFound(res)
    res.json(serializeDocument(doc))
  } catch (erro) {
    if (recusa(res, erro)) return
    console.error('Failed to update knowledge document:', erro)
    res.status(502).json({ error: 'Failed to process document.' })
  }
})

knowledgeRouter.post('/documents/:documentId/reindex', async (req, res) => {
  const alvo = await donoDoDocumento(res, String(req.params.documentId))
  if (!alvo) return notFound(res)
  const doc = await reindexDocument(alvo.owner, alvo.documentId)
  if (!doc) return notFound(res)
  res.json(serializeDocument(doc as KnowledgeDocument))
})

knowledgeRouter.delete('/documents/:documentId', async (req, res) => {
  const alvo = await donoDoDocumento(res, String(req.params.documentId))
  if (!alvo) return notFound(res)
  // `deleteDocumentFor` apaga os CHUNKS junto: um documento removido que deixasse os
  // pedaços para trás continuaria respondendo na busca depois de ter sumido da tela.
  const apagou = await removeDocument(alvo.owner, alvo.documentId)
  if (!apagou) return notFound(res)
  res.status(204).end()
})
