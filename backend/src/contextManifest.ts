import { ObjectId } from 'mongodb'
import { db } from './db.js'
import type { GroundingStatus, KnowledgeOwnerType, KnowledgeSource } from './knowledge.js'
import type { OwnerReason, ResolvedOwner } from './knowledgeAccess.js'

// O QUE ESTA EXECUÇÃO REALMENTE LEU — registrado pelo servidor, não pelo modelo.
//
// "Baseado em" era uma frase que o modelo escrevia. Ele citava de memória, às vezes um
// documento que não tinha sido consultado, às vezes um que não existe — e não havia como
// conferir, porque o que foi de fato selecionado morria dentro da chamada.
//
// O manifesto é o registro do lado de cá: quais bases a política permitiu, o que foi
// procurado, o que voltou, o que coube no orçamento e o que ficou de fora, com o motivo.
// Ele guarda IDS, TÍTULOS e NÚMEROS — nunca o prompt, nunca o trecho inteiro, nunca uma
// credencial. É telemetria de decisão, não uma segunda cópia do conteúdo.

export const CONTEXT_MANIFEST_VERSION = 1

/** Uma necessidade declarada antes de buscar. Deriva da política, não do que o modelo pediu. */
export interface KnowledgeRequirement {
  scope: KnowledgeOwnerType
  targetId?: string
  reason: string
  required: boolean
  query?: string
}

export interface ContextRequirement {
  knowledge: KnowledgeRequirement[]
  liveData: { sourceKey: string; reason: string; required: boolean }[]
  historicalData: { recorderKey: string; period?: string; reason: string; required: boolean }[]
}

export interface ContextManifestKnowledgeEntry {
  documentId: string | null
  ownerType: KnowledgeOwnerType
  ownerId: string
  title: string | null
  topScore: number | null
  selectedChars: number
  /** Por busca direta ou por expansão pelo grafo — ver Fase 3.8. */
  retrieval: 'vector' | 'lexical' | 'graph_expansion' | null
  /** Por que a base estava disponível: própria, do andar, do setor da execução… */
  reason: string | null
  authority: string | null
  /** `null` quando o documento não declara validade — e não "válido" por omissão. */
  validAtExecution: boolean | null
}

export interface ContextManifest {
  _id: ObjectId
  ownerId: string
  executionId: string
  /** De onde veio esta execução: chat, playground, setor, rotina, canal, arquiteto. */
  executionKind: string
  agentId: ObjectId | null
  version: number
  requested: ContextRequirement
  /** As bases que a POLÍTICA permitiu — antes de qualquer busca. */
  allowed: { ownerType: KnowledgeOwnerType; ownerId: string; reason: OwnerReason }[]
  knowledge: ContextManifestKnowledgeEntry[]
  liveData: { sourceKey: string; status: 'used' | 'missing' | 'failed' | 'denied'; capturedAt?: Date }[]
  historicalData: { recorderKey: string; status: 'used' | 'missing' | 'failed' | 'denied'; period?: string }[]
  /** O que foi visto e NÃO entrou, com o motivo. Sem isto, "não usou" não tem explicação. */
  ignored: { kind: string; ref: string; reason: string }[]
  coverage: { required: number; satisfied: number; missing: number; score: number }
  groundingStatus: GroundingStatus | 'partial' | 'conflict' | 'denied'
  /** O que o orçamento permitia e o que foi gasto. */
  budget: { topK: number; charBudget: number; minScore: number; usedChars: number; usedChunks: number }
  createdAt: Date
}

const manifests = db.collection<ContextManifest>('context_manifests')

export async function ensureContextManifestIndexes(): Promise<void> {
  await manifests.createIndex({ ownerId: 1, executionId: 1 })
  await manifests.createIndex({ ownerId: 1, createdAt: -1 })
  // Por documento: é como a análise de impacto responde "quem REALMENTE usou isto".
  await manifests.createIndex({ ownerId: 1, 'knowledge.documentId': 1 })
  /**
   * RETENÇÃO. O manifesto é telemetria, e telemetria sem prazo vira um arquivo que
   * ninguém lê e todo mundo paga. Noventa dias cobrem a auditoria de uma decisão
   * recente; o que importa depois disso é o documento, que não expira.
   */
  await manifests.createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600, name: 'manifesto_retencao' })
}

/**
 * Os requisitos DERIVADOS da política — sem gastar uma inferência para decidir rota.
 *
 * O Planner pode declarar necessidades mais finas quando a tarefa é complexa; para o
 * caso comum, o que o agente precisa consultar é exatamente o que a política dele
 * permite, e uma chamada de modelo para chegar nessa conclusão seria uma chamada paga
 * para repetir uma regra que o servidor já conhece.
 */
export function deriveRequirement(owners: ResolvedOwner[], query: string, opts: { requireGrounding?: boolean } = {}): ContextRequirement {
  return {
    knowledge: owners.map((o) => ({
      scope: o.ownerType,
      targetId: o.ownerId.toString(),
      reason: o.reason,
      // Obrigatório só quando o agente foi configurado para não responder sem base: é a
      // única situação em que a ausência de conhecimento muda o que acontece.
      required: Boolean(opts.requireGrounding) && o.reason === 'own',
      query: query.slice(0, 300),
    })),
    liveData: [],
    historicalData: [],
  }
}

export interface RecordManifestInput {
  ownerId: string
  executionId: string
  executionKind: string
  agentId?: ObjectId | null
  requested: ContextRequirement
  allowed: ResolvedOwner[]
  sources: KnowledgeSource[]
  contextChars: number
  groundingStatus: ContextManifest['groundingStatus']
  budget: { topK: number; charBudget: number; minScore: number }
  ignored?: ContextManifest['ignored']
  documentMeta?: Map<string, { authority: string | null; validAtExecution: boolean | null }>
}

/**
 * Grava o manifesto desta execução.
 *
 * Nunca lança: um erro ao registrar telemetria não pode derrubar a resposta que o
 * usuário está esperando. O pior caso é uma execução sem manifesto — que a tela mostra
 * como "sem telemetria desta versão", e não como "nenhuma fonte usada".
 */
export async function recordContextManifest(input: RecordManifestInput): Promise<ObjectId | null> {
  try {
    const knowledge: ContextManifestKnowledgeEntry[] = input.sources.map((s) => {
      const meta = s.documentId ? input.documentMeta?.get(s.documentId) : undefined
      return {
        documentId: s.documentId ?? null,
        ownerType: s.ownerType,
        ownerId: s.ownerId,
        title: s.title ?? null,
        topScore: typeof s.score === 'number' ? s.score : null,
        selectedChars: 0,
        retrieval: (s.retrieval as ContextManifestKnowledgeEntry['retrieval']) ?? null,
        reason: s.reason ?? null,
        authority: meta?.authority ?? null,
        validAtExecution: meta?.validAtExecution ?? null,
      }
    })

    const obrigatorios = input.requested.knowledge.filter((k) => k.required)
    // Cobertura mede os REQUISITOS declarados, e não "confiança da IA": um requisito
    // obrigatório está satisfeito quando algum trecho daquele escopo entrou.
    const satisfeitos = obrigatorios.filter((k) => knowledge.some((e) => e.ownerType === k.scope && (!k.targetId || e.ownerId === k.targetId))).length

    const doc: ContextManifest = {
      _id: new ObjectId(),
      ownerId: input.ownerId,
      executionId: input.executionId,
      executionKind: input.executionKind,
      agentId: input.agentId ?? null,
      version: CONTEXT_MANIFEST_VERSION,
      requested: input.requested,
      allowed: input.allowed.map((o) => ({ ownerType: o.ownerType, ownerId: o.ownerId.toString(), reason: o.reason })),
      knowledge,
      liveData: [],
      historicalData: [],
      ignored: input.ignored ?? [],
      coverage: {
        required: obrigatorios.length,
        satisfied: satisfeitos,
        missing: obrigatorios.length - satisfeitos,
        score: obrigatorios.length === 0 ? 1 : satisfeitos / obrigatorios.length,
      },
      groundingStatus: input.groundingStatus,
      budget: { ...input.budget, usedChars: input.contextChars, usedChunks: knowledge.length },
      createdAt: new Date(),
    }
    await manifests.insertOne(doc)
    return doc._id
  } catch (erro) {
    console.error('[contexto] não foi possível registrar o manifesto:', (erro as Error).message)
    return null
  }
}

/** O manifesto de uma execução — para a tela mostrar o que foi usado, ignorado e faltou. */
export const getContextManifest = (ownerId: string, executionId: string) =>
  manifests.find({ ownerId, executionId }).sort({ createdAt: -1 }).limit(20).toArray()

/**
 * Quem REALMENTE usou este documento — a evidência, e não a permissão.
 *
 * É a metade que faltava na análise de impacto: "pode acessar" sai da política, e
 * qualquer agente com a base ligada aparece ali. "Usou" só sai daqui.
 */
export async function executionsUsingDocument(ownerId: string, documentId: string, limit = 50) {
  return manifests
    .find({ ownerId, 'knowledge.documentId': documentId }, { projection: { executionId: 1, executionKind: 1, agentId: 1, createdAt: 1 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()
}

export const countExecutionsUsingDocument = (ownerId: string, documentId: string) =>
  manifests.countDocuments({ ownerId, 'knowledge.documentId': documentId })
