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
import { listDocumentsNeedingReview, scopeSearchFinds } from '../knowledge.js'
import { analyzeDocumentImpact, buildKnowledgeGraph, clearGraphLayout, getGraphLayout, saveGraphLayout } from '../knowledgeGraph.js'
import { dismissKnowledgeGap, listKnowledgeGaps, resolveKnowledgeGap } from '../knowledgeGaps.js'
import { ProposalError, approveKnowledgeProposal, getKnowledgeProposal, listKnowledgeProposals, rejectKnowledgeProposal } from '../knowledgeProposals.js'
import { listKnowledgeConflicts, resolveKnowledgeConflict, scanScopeForConflicts } from '../knowledgeConflicts.js'
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

// --- lacunas, propostas e conflitos ------------------------------------------------------
//
// Três listas que respondem perguntas diferentes sobre a MESMA base: o que falta, o que
// os agentes sugeriram e o que se contradiz. Todas owner-scoped, todas paginadas no
// servidor — baixar o histórico inteiro para contar no navegador é o que faz um painel
// ficar lento justamente na conta que mais precisa dele.

knowledgeRouter.get('/gaps', async (req, res) => {
  const escopo = req.query.scopeType ? await donoDoPedido(res, req.query.scopeType, req.query.scopeId) : null
  if (req.query.scopeType && !escopo) return notFound(res)
  const r = await listKnowledgeGaps(res.locals.userId, {
    status: ['open', 'dismissed', 'resolved'].includes(String(req.query.status)) ? (String(req.query.status) as 'open') : undefined,
    ...(escopo ? { scopeType: escopo.ownerType, scopeId: escopo.ownerId } : {}),
    limit: Number(req.query.limit) || 50,
    skip: Number(req.query.skip) || 0,
  })
  res.json({
    items: r.items.map((g) => ({
      id: g._id.toString(),
      scopeType: g.scopeType,
      scopeId: g.scopeId.toString(),
      subject: g.subject,
      examples: g.examples,
      count: g.count,
      cause: g.cause,
      status: g.status,
      agentIds: g.agentIds.map((a) => a.toString()),
      firstSeenAt: g.firstSeenAt,
      lastSeenAt: g.lastSeenAt,
      resolvedByDocumentId: g.resolvedByDocumentId?.toString() ?? null,
    })),
    total: r.total,
  })
})

knowledgeRouter.post('/gaps/:gapId/dismiss', async (req, res) => {
  const id = oid(String(req.params.gapId))
  if (!id) return notFound(res)
  const ok = await dismissKnowledgeGap(res.locals.userId, id)
  if (!ok) return notFound(res)
  res.status(204).end()
})

/**
 * Resolver a lacuna com um documento — e a resolução é CONFERIDA.
 *
 * A busca precisa encontrar o documento pelo assunto da lacuna. Marcar "resolvido"
 * porque alguém escreveu alguma coisa seria dar a pergunta por respondida sem ninguém
 * ter conferido que a resposta chega.
 */
knowledgeRouter.post('/gaps/:gapId/resolve', async (req, res) => {
  const id = oid(String(req.params.gapId))
  const documentId = oid(String((req.body ?? {}).documentId ?? ''))
  if (!id || !documentId) return notFound(res)
  const r = await resolveKnowledgeGap(res.locals.userId, id, documentId, async (assunto, escopo) =>
    (await scopeSearchFinds(escopo, assunto, documentId)) ? [documentId.toString()] : [],
  )
  if (!r.resolved) {
    res.status(409).json({ code: 'not_resolved', message: r.reason ?? 'não foi possível confirmar a resolução' })
    return
  }
  res.json({ resolved: true })
})

knowledgeRouter.get('/proposals', async (req, res) => {
  const r = await listKnowledgeProposals(res.locals.userId, {
    status: ['pending', 'approved', 'rejected', 'needs_review'].includes(String(req.query.status)) ? (String(req.query.status) as 'pending') : undefined,
    limit: Number(req.query.limit) || 50,
    skip: Number(req.query.skip) || 0,
  })
  res.json({
    items: r.items.map((pr) => ({
      id: pr._id.toString(),
      scopeType: pr.scopeType,
      scopeId: pr.scopeId.toString(),
      title: pr.title,
      status: pr.status,
      evidence: pr.evidence,
      confidence: pr.confidence,
      checks: pr.checks,
      agentId: pr.agentId?.toString() ?? null,
      executionId: pr.executionId,
      reviewerId: pr.reviewerId,
      reviewNote: pr.reviewNote,
      documentId: pr.documentId?.toString() ?? null,
      createdAt: pr.createdAt,
    })),
    total: r.total,
  })
})

knowledgeRouter.get('/proposals/:proposalId', async (req, res) => {
  const id = oid(String(req.params.proposalId))
  if (!id) return notFound(res)
  const p = await getKnowledgeProposal(res.locals.userId, id)
  if (!p) return notFound(res)
  res.json({ ...p, _id: undefined, id: p._id.toString(), scopeId: p.scopeId.toString(), agentId: p.agentId?.toString() ?? null, documentId: p.documentId?.toString() ?? null })
})

knowledgeRouter.post('/proposals/:proposalId/approve', async (req, res, next) => {
  const id = oid(String(req.params.proposalId))
  if (!id) return notFound(res)
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const p = await approveKnowledgeProposal(res.locals.userId, id, res.locals.userId, {
      authority: typeof body.authority === 'string' ? (body.authority as never) : undefined,
      note: typeof body.note === 'string' ? body.note : undefined,
    })
    res.json({ id: p._id.toString(), status: p.status, documentId: p.documentId?.toString() ?? null })
  } catch (erro) {
    if (erro instanceof ProposalError) {
      res.status(400).json({ code: 'invalid', message: erro.message, error: erro.message })
      return
    }
    if (recusa(res, erro)) return
    next(erro as Error)
  }
})

knowledgeRouter.post('/proposals/:proposalId/reject', async (req, res) => {
  const id = oid(String(req.params.proposalId))
  if (!id) return notFound(res)
  const nota = typeof (req.body ?? {}).note === 'string' ? String((req.body as Record<string, unknown>).note) : undefined
  const p = await rejectKnowledgeProposal(res.locals.userId, id, res.locals.userId, nota)
  if (!p) return notFound(res)
  res.json({ id: p._id.toString(), status: p.status })
})

knowledgeRouter.get('/conflicts', async (req, res) => {
  const status = ['open', 'resolved', 'accepted'].includes(String(req.query.status)) ? (String(req.query.status) as 'open') : 'open'
  const items = await listKnowledgeConflicts(res.locals.userId, status)
  res.json({
    items: items.map((c) => ({
      id: c._id.toString(),
      scopeType: c.scopeType,
      scopeId: c.scopeId.toString(),
      subject: c.subject,
      documentIds: c.documentIds.map((d) => d.toString()),
      values: c.values,
      status: c.status,
      resolvedBy: c.resolvedBy,
      resolutionNote: c.resolutionNote,
      winnerDocumentId: c.winnerDocumentId?.toString() ?? null,
      detectedAt: c.detectedAt,
    })),
  })
})

/** Roda a detecção num escopo. Determinística: reexecutar não duplica nem inventa. */
knowledgeRouter.post('/conflicts/scan', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const owner = await donoDoPedido(res, body.scopeType, body.scopeId)
  if (!owner) return notFound(res)
  const achados = await scanScopeForConflicts(res.locals.userId, owner)
  res.json({ found: achados.length, conflicts: achados })
})

knowledgeRouter.post('/conflicts/:conflictId/resolve', async (req, res) => {
  const id = oid(String(req.params.conflictId))
  if (!id) return notFound(res)
  const body = (req.body ?? {}) as Record<string, unknown>
  const nota = String(body.note ?? '').trim()
  if (!nota) {
    res.status(400).json({ code: 'invalid', message: 'diga por que esta é a decisão — sem isso ela não é auditável' })
    return
  }
  const vencedor = body.winnerDocumentId ? oid(String(body.winnerDocumentId)) : null
  const c = await resolveKnowledgeConflict(res.locals.userId, id, {
    resolvedBy: res.locals.userId,
    note: nota,
    winnerDocumentId: vencedor,
    accept: body.accept === true,
  })
  if (!c) return notFound(res)
  res.json({ id: c._id.toString(), status: c.status })
})

/** O que precisa de revisão neste escopo — calculado, nunca perguntado a um modelo. */
knowledgeRouter.get('/review', async (req, res) => {
  const owner = await donoDoPedido(res, req.query.scopeType, req.query.scopeId)
  if (!owner) return notFound(res)
  const itens = await listDocumentsNeedingReview(owner)
  res.json({
    items: itens.map(({ document, state }) => ({
      id: document._id.toString(),
      title: document.title,
      state,
      validUntil: document.validUntil ?? null,
      verifiedAt: document.verifiedAt ?? null,
      verifiedBy: document.verifiedBy ?? null,
      reviewIntervalDays: document.reviewIntervalDays ?? null,
      updatedAt: document.updatedAt,
    })),
  })
})

// --- o mapa, o layout e o impacto ---------------------------------------------------------

knowledgeRouter.get('/graph', async (req, res) => {
  const floorId = req.query.floorId ? oid(String(req.query.floorId)) : null
  if (req.query.floorId && !floorId) return notFound(res)
  // O andar precisa ser DESTA conta: um id alheio não desenha o mapa de outra pessoa.
  if (floorId) {
    const { getFloor } = await import('../floors.js')
    if (!(await getFloor(res.locals.userId, floorId))) return notFound(res)
  }
  const viewAs = req.query.viewAs ? oid(String(req.query.viewAs)) : null
  if (req.query.viewAs && !viewAs) return notFound(res)

  const grafo = await buildKnowledgeGraph(res.locals.userId, {
    floorId,
    viewAsAgentId: viewAs,
    search: typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : null,
    status: ['indexed', 'pending', 'error'].includes(String(req.query.status)) ? (String(req.query.status) as 'indexed') : null,
    source: typeof req.query.source === 'string' ? req.query.source.slice(0, 40) : null,
    limit: Number(req.query.limit) || 200,
    skip: Number(req.query.skip) || 0,
  })

  /**
   * As posições arrastadas entram no DTO: sem elas, o mapa reorganizaria por baixo de
   * quem acabou de organizá-lo.
   *
   * A GERAÇÃO na chave existe porque uma posição só significa alguma coisa DENTRO do
   * sistema de coordenadas em que foi gravada. O mapa era uma pilha de fileiras com vãos
   * de 150 unidades, onde duzentos documentos ocupavam vinte e dois mil de largura;
   * agora é uma nuvem resolvida por forças, com algumas centenas. Misturar os dois é o
   * que se via na tela: os poucos nós arrastados lá longe e todo o resto colapsado num
   * ponto só, um em cima do outro.
   *
   * Trocar a chave não APAGA nada — as linhas antigas continuam gravadas, apenas deixam
   * de ser lidas por um layout que não as produziu. Quem quiser reorganizar recomeça de
   * um mapa que se enxerga.
   */
  const viewKey = floorId ? `floor:${floorId.toString()}#2` : 'building#2'
  const posicoes = new Map((await getGraphLayout(res.locals.userId, viewKey)).map((p) => [p.nodeId, { x: p.x, y: p.y }]))
  res.json({
    ...grafo,
    viewKey,
    nodes: grafo.nodes.map((n) => ({ ...n, position: posicoes.get(n.id) ?? null })),
  })
})

knowledgeRouter.put('/graph/layout', async (req, res) => {
  const body = (req.body ?? {}) as { viewKey?: unknown; positions?: unknown }
  const viewKey = String(body.viewKey ?? '').slice(0, 120)
  if (!viewKey) {
    res.status(400).json({ code: 'invalid', message: 'informe a visão' })
    return
  }
  const saved = await saveGraphLayout(res.locals.userId, viewKey, Array.isArray(body.positions) ? (body.positions as { nodeId: string; x: number; y: number }[]) : [])
  res.json({ saved })
})

knowledgeRouter.delete('/graph/layout', async (req, res) => {
  const viewKey = String(req.query.viewKey ?? '').slice(0, 120)
  if (!viewKey) {
    res.status(400).json({ code: 'invalid', message: 'informe a visão' })
    return
  }
  res.json({ cleared: await clearGraphLayout(res.locals.userId, viewKey) })
})

/**
 * O que quebra se este documento sair.
 *
 * `accessibleBy` é permissão; `actuallyUsedBy` é evidência. As duas contagens vêm de
 * lugares diferentes de propósito — "três agentes usam este documento" era a frase que
 * dava para escrever só com a permissão na mão, e ela é falsa.
 */
knowledgeRouter.get('/documents/:documentId/impact', async (req, res) => {
  const alvo = await donoDoDocumento(res, String(req.params.documentId))
  if (!alvo) return notFound(res)
  const impacto = await analyzeDocumentImpact(res.locals.userId, alvo.documentId)
  if (!impacto) return notFound(res)
  res.json(impacto)
})
