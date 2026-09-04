import { ObjectId } from 'mongodb'
import { db } from '../../db.js'
import { getAgentById } from '../../agents.js'
import { hasStoredPolicy, resolveKnowledgeOwnersForExecution } from '../../knowledgeAccess.js'
import { resolveKnowledgeOwner } from '../../knowledgeScope.js'
import { ownerFilter, reviewStateOf } from '../../knowledge.js'
import type { KnowledgeDocument } from '../../knowledge.js'
import { countExecutionsUsingDocument, executionsUsingDocument } from '../../contextManifest.js'
import { analyzeDocumentImpact } from '../../knowledgeGraph.js'
import { resolveSubject } from '../scope.js'
import { CAPABILITIES, denied } from '../types.js'
import type {
  ResourceAccessContext,
  ResourceAccessDecision,
  ResourceAdapter,
  ResourceDetail,
  ResourceImpact,
  ResourceListContext,
  ResourceSummary,
} from '../types.js'

// KNOWLEDGE no catálogo comum — e a decisão continua com quem já a tomava.
//
// A política de conhecimento é mais rica que qualquer regra genérica: distingue base
// própria, andar, prédio e quatro modos de setor, e reconfere os setores escolhidos a cada
// execução. Reimplementá-la aqui produziria uma segunda resposta para a mesma pergunta —
// e a segunda seria a errada, porque não é ela que roda quando o agente responde.
//
// Este adapter DELEGA. O que ele acrescenta é a forma comum: listar, referenciar e
// explicar em que a decisão se apoiou.

const documents = db.collection<KnowledgeDocument>('knowledge_documents')

const resumoDe = (doc: KnowledgeDocument): ResourceSummary => {
  const estado = reviewStateOf(doc)
  const flags: string[] = []
  if (estado !== 'ok') flags.push(estado)
  if ((doc.lifecycleStatus ?? 'approved') !== 'approved') flags.push(String(doc.lifecycleStatus))
  if (doc.indexStatus === 'error') flags.push('index_error')
  return {
    kind: 'knowledge',
    id: doc._id.toString(),
    name: doc.title,
    owner: {
      ownerType: (doc.ownerType ?? 'agent') as ResourceSummary['owner']['ownerType'],
      ownerId: ((doc.ownerId ?? doc.agentId) as ObjectId | null)?.toString() ?? '',
    },
    status: doc.indexStatus ?? 'indexed',
    ...(flags.length ? { flags } : {}),
    updatedAt: doc.updatedAt,
  }
}

const MOTIVO: Record<string, string> = {
  own: 'é a base própria dele',
  floor: 'a política inclui o andar',
  building: 'a política inclui o prédio',
  execution_sector: 'a execução começou neste setor',
  home_sector: 'ele é membro deste setor',
  selected_sector: 'este setor foi escolhido na política',
}

const ORIGEM: Record<string, ResourceAccessDecision['origin']> = {
  own: 'direct',
  floor: 'floor',
  building: 'building',
  execution_sector: 'sector',
  home_sector: 'sector',
  selected_sector: 'sector',
}

export const knowledgeAdapter: ResourceAdapter = {
  kind: 'knowledge',
  capabilities: () => CAPABILITIES.knowledge,

  async list(ctx: ResourceListContext): Promise<ResourceSummary[]> {
    /**
     * Os donos possíveis saem da CONTA, e não de uma varredura na coleção. Uma consulta
     * sem escopo de dono mostraria a base de outra conta na primeira falha de filtro.
     */
    const donos: { ownerType: 'building' | 'floor' | 'sector' | 'agent'; ownerId: ObjectId }[] = []
    if (ctx.subject) {
      const sujeito = await resolveSubject(ctx.accountId, ctx.subject)
      if (!sujeito) return []
      if (ctx.access === 'available' && sujeito.subjectType === 'agent') {
        // O que ele CONSEGUE usar é exatamente o que a política resolve — nem mais.
        const agente = await getAgentById(ctx.accountId, sujeito.subjectId)
        if (!agente) return []
        const r = await resolveKnowledgeOwnersForExecution(ctx.accountId, agente)
        donos.push(...r.owners.map((o) => ({ ownerType: o.ownerType, ownerId: o.ownerId })))
      } else {
        donos.push({ ownerType: sujeito.subjectType, ownerId: sujeito.subjectId })
      }
    } else {
      for (const [tipo, colecao] of [
        ['building', 'buildings'],
        ['floor', 'offices'],
        ['sector', 'sectors'],
        ['agent', 'agents'],
      ] as const) {
        const ids = await db.collection(colecao).find({ ownerId: ctx.accountId }, { projection: { _id: 1 } }).toArray()
        donos.push(...ids.map((d) => ({ ownerType: tipo, ownerId: d._id as ObjectId })))
      }
    }
    if (donos.length === 0) return []

    const partes: Record<string, unknown>[] = [{ $or: donos.map((o) => ownerFilter(o)) }]
    if (ctx.search?.trim()) partes.push({ title: { $regex: ctx.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })

    const docs = await documents
      .find({ $and: partes }, { projection: { content: 0 } })
      .sort({ updatedAt: -1 })
      .skip(Math.max(ctx.skip ?? 0, 0))
      .limit(Math.min(Math.max(ctx.limit ?? 100, 1), 300))
      .toArray()
    return docs.map(resumoDe)
  },

  async get(accountId: string, resourceId: string): Promise<ResourceDetail | null> {
    if (!ObjectId.isValid(resourceId)) return null
    const doc = await documents.findOne({ _id: new ObjectId(resourceId) }, { projection: { content: 0 } })
    if (!doc) return null
    // O documento guarda o id do DONO, não o da conta: a posse é conferida pelo dono.
    const dono = await resolveKnowledgeOwner(accountId, {
      scopeType: (doc.ownerType ?? 'agent') as 'agent',
      scopeId: ((doc.ownerId ?? doc.agentId) as ObjectId | null)?.toString() ?? null,
    })
    if (!dono) return null
    return {
      ...resumoDe(doc),
      capabilities: [...CAPABILITIES.knowledge],
      // Metadados reconstruíveis. O CONTEÚDO fica na fonte canônica, onde já está.
      meta: {
        authority: doc.authority ?? 'reference',
        lifecycleStatus: doc.lifecycleStatus ?? 'approved',
        chunkCount: doc.chunkCount ?? 0,
        validUntil: doc.validUntil ?? null,
        verifiedAt: doc.verifiedAt ?? null,
        source: doc.source ?? 'manual',
      },
    }
  },

  async resolveAccess(ctx: ResourceAccessContext): Promise<ResourceAccessDecision> {
    const detalhe = await knowledgeAdapter.get(ctx.accountId, ctx.resourceId)
    if (!detalhe) return denied()
    if (!ctx.actorAgentId) {
      return { allowed: true, capabilities: [...CAPABILITIES.knowledge], origin: 'owner', reason: 'você administra esta conta' }
    }

    const agente = await getAgentById(ctx.accountId, ctx.actorAgentId)
    if (!agente) return denied()

    /**
     * A DECISÃO é da política de conhecimento — a mesma que roda quando o agente
     * responde. Um segundo cálculo aqui divergiria dela, e o que a tela mostrasse
     * deixaria de ser o que acontece.
     */
    const r = await resolveKnowledgeOwnersForExecution(ctx.accountId, agente, {
      verifiedSectorId: ctx.executionContext?.verifiedSectorId ?? null,
    })
    const alcanca = r.owners.find((o) => o.ownerType === detalhe.owner.ownerType && o.ownerId.toString() === detalhe.owner.ownerId)
    if (!alcanca) {
      return {
        allowed: false,
        capabilities: [],
        origin: 'none',
        reason: hasStoredPolicy(agente)
          ? 'a política de conhecimento deste agente não inclui esta base'
          : 'o padrão do sistema não dá a este agente acesso a esta base',
      }
    }
    return {
      allowed: true,
      // Agente descobre e lê; curar e administrar continuam sendo ação de gente.
      capabilities: ['discover', 'retrieve'],
      origin: ORIGEM[alcanca.reason] ?? 'specialized_policy',
      reason: MOTIVO[alcanca.reason] ?? 'a política de conhecimento permite',
    }
  },

  async impact(accountId: string, resourceId: string): Promise<ResourceImpact | null> {
    if (!ObjectId.isValid(resourceId)) return null
    const detalhado = await analyzeDocumentImpact(accountId, new ObjectId(resourceId))
    if (!detalhado) return null
    const usos = await executionsUsingDocument(accountId, resourceId, 20)
    return {
      resource: { kind: 'knowledge', id: resourceId },
      accessibleBy: detalhado.accessibleBy.map((a) => ({ subjectType: 'agent' as const, subjectId: a.agentId, name: a.name })),
      usedBy: usos.map((u) => ({ executionId: u.executionId, kind: u.executionKind, at: u.createdAt })),
      usedCount: await countExecutionsUsingDocument(accountId, resourceId),
      dependents: [
        ...detalhado.linkedFrom.map((l) => ({ kind: 'knowledge', id: l.documentId, name: l.title, reason: 'cita este documento' })),
        ...detalhado.resolvedGaps.map((g) => ({ kind: 'gap', id: g.subject, name: g.subject, reason: 'esta lacuna foi resolvida por ele' })),
      ],
      recommendation: detalhado.recommendation,
    }
  },
}
