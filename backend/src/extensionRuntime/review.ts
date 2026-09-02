import { ObjectId } from 'mongodb'
import { db } from '../db.js'

// A REVISÃO — gravada pelo servidor, imutável, e ligada ao que foi revisado.
//
// O erro que este arquivo existe para não cometer: aceitar "isto já foi revisado" vindo do
// manifesto que o AUTOR envia. Um campo assim é o autor assinando o próprio atestado — e
// a revisão inteira vira decoração.
//
// Aqui, quem grava é o servidor, a partir de uma pessoa com papel de revisor definido na
// configuração da plataforma. E o registro é preso ao HASH: revisar a versão 1.0.0 não
// aprova outro código publicado depois com o mesmo número.

export type ReviewSubject = 'extension' | 'tool'
export type ReviewDecision = 'approved' | 'changes_requested'

export interface ReviewRecord {
  _id: ObjectId
  subjectType: ReviewSubject
  /** O pacote ou a ferramenta. */
  subjectId: ObjectId
  version: string
  /** O hash do que foi revisado. É ele que impede a aprovação de viajar para outro código. */
  sha256: string
  decision: ReviewDecision
  reviewerId: string
  notes: string
  createdAt: Date
}

const reviews = db.collection<ReviewRecord>('extension_reviews')

export async function ensureReviewIndexes(): Promise<void> {
  // Uma decisão por revisor, por hash: reenviar a mesma aprovação não cria uma segunda.
  await reviews.createIndex({ subjectType: 1, subjectId: 1, sha256: 1, reviewerId: 1 }, { unique: true })
  await reviews.createIndex({ subjectType: 1, subjectId: 1, createdAt: -1 })
}

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly code = 'invalid',
  ) {
    super(message)
  }
}

/**
 * Quem pode revisar — lido da CONFIGURAÇÃO do servidor, nunca do pedido.
 *
 * Sem a lista, ninguém revisa: e como publicar código exige revisão, o efeito é código
 * continuar impublicável. É o fail-closed de sempre — o que não foi configurado não existe.
 */
export const platformReviewers = (): string[] =>
  String(process.env.PLATFORM_REVIEWERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export const isPlatformReviewer = (accountId: string | null | undefined): boolean =>
  Boolean(accountId) && platformReviewers().includes(String(accountId))

export interface RecordReviewInput {
  subjectType: ReviewSubject
  subjectId: ObjectId
  version: string
  sha256: string
  decision: ReviewDecision
  reviewerId: string
  notes?: string
}

/**
 * Grava a decisão. Só um revisor da plataforma consegue, e o registro não muda depois.
 *
 * Não existe caminho de atualização neste arquivo de propósito: mudar de ideia é gravar
 * uma decisão NOVA, e as duas ficam. Um histórico que pode ser editado não é histórico.
 */
export async function recordReview(input: RecordReviewInput): Promise<ReviewRecord> {
  if (!isPlatformReviewer(input.reviewerId)) throw new ReviewError('esta conta não tem papel de revisão', 'forbidden')
  if (!/^[a-f0-9]{64}$/i.test(input.sha256)) throw new ReviewError('a revisão precisa apontar para um hash', 'invalid')

  const doc: ReviewRecord = {
    _id: new ObjectId(),
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    version: String(input.version),
    sha256: input.sha256.toLowerCase(),
    decision: input.decision,
    reviewerId: input.reviewerId,
    notes: String(input.notes ?? '').slice(0, 2000),
    createdAt: new Date(),
  }
  try {
    await reviews.insertOne(doc)
  } catch (erro) {
    if ((erro as { code?: number }).code === 11000) throw new ReviewError('este revisor já decidiu sobre este hash', 'duplicate')
    throw erro
  }
  return doc
}

/**
 * Existe aprovação para ESTE hash?
 *
 * A pergunta é sobre o hash, e não sobre o número da versão. Aprovar `1.0.0` e publicar
 * outro código com o mesmo número é exatamente o ataque que a amarração pelo hash impede.
 */
export async function findApproval(subjectType: ReviewSubject, subjectId: ObjectId, sha256: string): Promise<ReviewRecord | null> {
  const aprovacao = await reviews.findOne({ subjectType, subjectId, sha256: sha256.toLowerCase(), decision: 'approved' })
  if (!aprovacao) return null
  // O papel pode ter sido tirado depois. Uma aprovação de quem não é mais revisor não
  // vale — senão bastaria revisar uma vez e perder o papel para deixar rastro válido.
  return isPlatformReviewer(aprovacao.reviewerId) ? aprovacao : null
}

export const listReviews = (subjectType: ReviewSubject, subjectId: ObjectId) =>
  reviews.find({ subjectType, subjectId }).sort({ createdAt: -1 }).limit(50).toArray()

export const reviewsCollection = reviews
