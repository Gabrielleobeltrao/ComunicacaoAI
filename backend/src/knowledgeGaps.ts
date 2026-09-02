import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { db } from './db.js'
import type { KnowledgeOwnerType } from './knowledge.js'

// ONDE A BASE NÃO RESPONDEU — agregado, e sem guardar a conversa.
//
// A pergunta que ninguém conseguia responder era "o que falta na nossa base?". Ela existe
// no histórico: toda vez que um agente respondeu "não tenho essa informação", alguém
// perguntou algo que a base não cobre. Mas esse sinal se perdia — cada execução era um
// registro solto, e ninguém ia ler dez mil deles.
//
// Aqui cada falta vira um evento AGREGADO por assunto: uma lacuna com contagem, primeira
// e última ocorrência, e exemplos curtos. O que NÃO entra é a mensagem integral: guardar
// conversas inteiras para formar exemplo é acumular dado pessoal para sempre por causa de
// um painel.

export type GapStatus = 'open' | 'dismissed' | 'resolved'

export interface KnowledgeGap {
  _id: ObjectId
  ownerId: string
  scopeType: KnowledgeOwnerType
  scopeId: ObjectId
  /** O assunto normalizado. É a chave da agregação — mesma dúvida, mesma lacuna. */
  fingerprint: string
  subject: string
  /** Trechos curtos e redigidos da pergunta. Nunca a mensagem inteira. */
  examples: string[]
  count: number
  firstSeenAt: Date
  lastSeenAt: Date
  agentIds: ObjectId[]
  status: GapStatus
  /** O documento que a resolveu — preenchido só depois de a busca voltar a encontrar. */
  resolvedByDocumentId: ObjectId | null
  resolvedAt: Date | null
  /** Por que ela nasceu: sem base, busca vazia, indisponível ou cobertura parcial. */
  cause: 'no_base' | 'empty' | 'unavailable' | 'partial' | 'denied'
}

const gaps = db.collection<KnowledgeGap>('knowledge_gaps')

export async function ensureKnowledgeGapIndexes(): Promise<void> {
  await gaps.createIndex({ ownerId: 1, scopeType: 1, scopeId: 1, fingerprint: 1 }, { unique: true })
  await gaps.createIndex({ ownerId: 1, status: 1, count: -1 })
  await gaps.createIndex({ ownerId: 1, lastSeenAt: -1 })
}

/** O comprimento de um exemplo. Curto o bastante para não ser uma cópia da conversa. */
const MAX_EXEMPLO = 160
const MAX_EXEMPLOS = 3

/**
 * O ASSUNTO, sem o que identifica quem perguntou.
 *
 * Números longos, e-mails, telefones e documentos saem antes de tudo: eles são o que
 * transforma "exemplo de pergunta" em dado pessoal guardado para sempre. O que sobra é o
 * assunto — que é o que interessa para saber o que falta na base.
 */
export function redigir(texto: string): string {
  return String(texto ?? '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento]')
    .replace(/\b\+?\d[\d\s().-]{7,}\d\b/g, '[telefone]')
    .replace(/\b\d{5,}\b/g, '[número]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_EXEMPLO)
}

/**
 * A impressão digital do assunto.
 *
 * Palavras normalizadas, sem acento, sem as muito curtas, ordenadas e reduzidas a um
 * hash. "qual o horário de funcionamento?" e "horário funcionamento qual" viram a mesma
 * lacuna — que é o ponto: contar duas vezes a mesma pergunta é o que faz o painel
 * ordenar errado por frequência.
 */
export function fingerprintOf(texto: string): string {
  const palavras = String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length >= 4)
    .sort()
  return createHash('sha256').update(palavras.join(' ')).digest('hex').slice(0, 32)
}

export interface RecordGapInput {
  ownerId: string
  scopeType: KnowledgeOwnerType
  scopeId: ObjectId
  agentId: ObjectId
  question: string
  cause: KnowledgeGap['cause']
}

/**
 * Registra (ou soma a) uma lacuna.
 *
 * Nunca lança: um erro ao registrar telemetria não pode derrubar a resposta que alguém
 * está esperando. Uma lacuna resolvida que volta a aparecer REABRE — porque a base pode
 * ter deixado de responder de novo, e um "resolvido" que não se desfaz mente.
 */
export async function recordKnowledgeGap(input: RecordGapInput): Promise<void> {
  const assunto = redigir(input.question)
  if (!assunto || assunto.length < 8) return
  try {
    const agora = new Date()
    const fingerprint = fingerprintOf(assunto)
    await gaps.updateOne(
      { ownerId: input.ownerId, scopeType: input.scopeType, scopeId: input.scopeId, fingerprint },
      {
        $setOnInsert: { firstSeenAt: agora, subject: assunto, resolvedByDocumentId: null, resolvedAt: null },
        $set: { lastSeenAt: agora, status: 'open' as GapStatus, cause: input.cause },
        $inc: { count: 1 },
        $addToSet: { agentIds: input.agentId },
        // Um teto no acumulado: exemplos são amostra, não histórico.
        $push: { examples: { $each: [assunto], $slice: -MAX_EXEMPLOS } },
      },
      { upsert: true },
    )
  } catch (erro) {
    console.error('[lacuna] não foi possível registrar:', (erro as Error).message)
  }
}

export interface GapQuery {
  status?: GapStatus
  scopeType?: KnowledgeOwnerType
  scopeId?: ObjectId
  limit?: number
  skip?: number
}

/** As lacunas desta conta, das mais frequentes para as menos. */
export async function listKnowledgeGaps(ownerId: string, q: GapQuery = {}) {
  const filtro: Record<string, unknown> = { ownerId }
  if (q.status) filtro.status = q.status
  if (q.scopeType) filtro.scopeType = q.scopeType
  if (q.scopeId) filtro.scopeId = q.scopeId
  const limite = Math.min(Math.max(q.limit ?? 50, 1), 200)
  const [items, total] = await Promise.all([
    gaps.find(filtro).sort({ count: -1, lastSeenAt: -1 }).skip(Math.max(q.skip ?? 0, 0)).limit(limite).toArray(),
    gaps.countDocuments(filtro),
  ])
  return { items, total }
}

export const getKnowledgeGap = (ownerId: string, id: ObjectId) => gaps.findOne({ _id: id, ownerId })

/** Dispensar: alguém olhou e decidiu que aquilo não precisa virar documento. */
export async function dismissKnowledgeGap(ownerId: string, id: ObjectId): Promise<boolean> {
  const r = await gaps.updateOne({ _id: id, ownerId }, { $set: { status: 'dismissed' as GapStatus } })
  return r.matchedCount > 0
}

/**
 * Resolver — e a resolução é CONFERIDA, não declarada.
 *
 * Ligar um documento à lacuna e marcar "resolvido" no mesmo gesto seria confiar que o
 * texto novo responde a pergunta. Aqui a confirmação vem de uma busca de verdade: se o
 * documento não é encontrado pelo assunto da lacuna, ela continua aberta e quem tentou
 * resolver descobre agora, e não quando o cliente perguntar de novo.
 */
export async function resolveKnowledgeGap(
  ownerId: string,
  id: ObjectId,
  documentId: ObjectId,
  buscar: (assunto: string, scope: { ownerType: KnowledgeOwnerType; ownerId: ObjectId }) => Promise<string[]>,
): Promise<{ resolved: boolean; reason?: string }> {
  const lacuna = await gaps.findOne({ _id: id, ownerId })
  if (!lacuna) return { resolved: false, reason: 'lacuna não encontrada' }

  const encontrados = await buscar(lacuna.subject, { ownerType: lacuna.scopeType, ownerId: lacuna.scopeId })
  if (!encontrados.includes(documentId.toString())) {
    return { resolved: false, reason: 'o documento existe, mas a busca pelo assunto da lacuna ainda não o encontra' }
  }
  await gaps.updateOne(
    { _id: id, ownerId },
    { $set: { status: 'resolved' as GapStatus, resolvedByDocumentId: documentId, resolvedAt: new Date() } },
  )
  return { resolved: true }
}

/** As lacunas que este documento resolveu — para a análise de impacto. */
export const gapsResolvedByDocument = (ownerId: string, documentId: ObjectId) =>
  gaps.find({ ownerId, resolvedByDocumentId: documentId }, { projection: { subject: 1, count: 1, resolvedAt: 1 } }).toArray()
