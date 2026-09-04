import { ObjectId } from 'mongodb'
import { checkOwnerStorage } from './abuseGuards.js'
import { extractTextFromFile } from './fileExtraction.js'
import { resolveLinks } from './knowledgeLinks.js'
import {
  createDocumentFor,
  deleteDocumentFor,
  getDocumentFor,
  listDocumentsPage,
  reindexDocumentFor,
  updateDocumentFor,
  withKnowledgeDefaults,
  KNOWLEDGE_AUTHORITIES,
  KNOWLEDGE_LIFECYCLE_STATUSES,
} from './knowledge.js'
import type { CreateDocumentInput, DocumentQuery, KnowledgeAuthority, KnowledgeDocument, KnowledgeLifecycleStatus, KnowledgeOwner, UpdateDocumentInput } from './knowledge.js'

// A CAMADA COMPARTILHADA do conhecimento — uma só, para os quatro escopos.
//
// Antes havia dois caminhos escrevendo na mesma base com regras diferentes: o do agente
// conferia a cota da conta, o do setor não. Não era uma decisão; era um caminho que
// nasceu depois e não recebeu a mesma regra — e o resultado é que dava para encher o
// disco pelo setor. Cada endpoint que se acrescentasse repetiria a escolha, e uma delas
// erraria de novo.
//
// Aqui a regra mora num lugar só. As rotas antigas viraram adaptadores: elas continuam
// com o mesmo caminho, o mesmo contrato e a mesma forma de resposta, mas o que grava é
// esta camada.

export class KnowledgeValidationError extends Error {
  constructor(
    message: string,
    readonly code: string = 'invalid_input',
  ) {
    super(message)
  }
}

export class KnowledgeQuotaError extends Error {
  readonly code = 'storage_quota_exceeded'
  constructor(readonly usedBytes: number, readonly quotaBytes: number) {
    super('O espaço de armazenamento desta conta acabou. Apague documentos antigos para liberar.')
  }
}

export const MAX_TITLE = 200
/**
 * O teto do texto colado, e por que ele não vale para tudo.
 *
 * Uma nota curada não é um despejo de arquivo: cem mil caracteres já são umas trinta
 * páginas. O upload é outra história — um PDF extraído passa disso com facilidade, e
 * quem limita ali é a cota da conta, que mede o que realmente ocupa espaço.
 */
export const MAX_CONTENT = 100_000

const texto = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/**
 * A CURADORIA declarada no corpo do pedido.
 *
 * `confidence` não entra: ela só existe quando vem de um processo que mediu alguma
 * coisa. Aceitar o número que o cliente mandar transformaria um campo de evidência num
 * campo de opinião — e ele decide precedência entre documentos que se contradizem.
 */
export function parseCuration(body: Record<string, unknown>): {
  lifecycleStatus?: KnowledgeLifecycleStatus
  authority?: KnowledgeAuthority
  validFrom?: Date | null
  validUntil?: Date | null
  reviewIntervalDays?: number | null
} {
  const fora: Record<string, unknown> = {}
  const ciclo = texto(body.lifecycleStatus)
  if (ciclo !== undefined) {
    if (!KNOWLEDGE_LIFECYCLE_STATUSES.includes(ciclo as KnowledgeLifecycleStatus)) {
      throw new KnowledgeValidationError(`lifecycleStatus must be one of: ${KNOWLEDGE_LIFECYCLE_STATUSES.join(', ')}`)
    }
    fora.lifecycleStatus = ciclo
  }
  const autoridade = texto(body.authority)
  if (autoridade !== undefined) {
    if (!KNOWLEDGE_AUTHORITIES.includes(autoridade as KnowledgeAuthority)) {
      throw new KnowledgeValidationError(`authority must be one of: ${KNOWLEDGE_AUTHORITIES.join(', ')}`)
    }
    fora.authority = autoridade
  }
  for (const campo of ['validFrom', 'validUntil'] as const) {
    if (body[campo] === undefined) continue
    if (body[campo] === null) {
      fora[campo] = null
      continue
    }
    const d = new Date(String(body[campo]))
    if (Number.isNaN(d.getTime())) throw new KnowledgeValidationError(`${campo} must be a date`)
    fora[campo] = d
  }
  if (body.reviewIntervalDays !== undefined) {
    if (body.reviewIntervalDays === null) fora.reviewIntervalDays = null
    else {
      const n = Number(body.reviewIntervalDays)
      if (!Number.isFinite(n) || n <= 0 || n > 3650) throw new KnowledgeValidationError('reviewIntervalDays must be between 1 and 3650')
    fora.reviewIntervalDays = Math.round(n)
    }
  }
  if (fora.validFrom instanceof Date && fora.validUntil instanceof Date && fora.validFrom > fora.validUntil) {
    throw new KnowledgeValidationError('validFrom must come before validUntil')
  }
  return fora
}

/**
 * A cota, conferida com o tamanho REAL do que vai entrar.
 *
 * Antes de gravar e antes de indexar: indexar primeiro gastaria embedding — que se paga
 * por token — de um texto que a conta não tem espaço para guardar.
 */
async function exigirEspaco(accountId: string, conteudo: string): Promise<void> {
  const espaco = await checkOwnerStorage(accountId, Buffer.byteLength(conteudo, 'utf8'))
  if (!espaco.allowed) throw new KnowledgeQuotaError(espaco.usedBytes, espaco.quotaBytes)
}

export interface SaveInput extends Omit<CreateDocumentInput, 'title' | 'content'> {
  title: string
  content: string
  /** Teto do texto. `null` = sem teto (upload), onde quem limita é a cota. */
  maxContent?: number | null
}

export async function saveDocument(accountId: string, owner: KnowledgeOwner, input: SaveInput): Promise<KnowledgeDocument> {
  const title = input.title?.trim()
  const content = typeof input.content === 'string' ? input.content : ''
  if (!title || !content.trim()) throw new KnowledgeValidationError('title and content are required')
  if (title.length > MAX_TITLE) throw new KnowledgeValidationError(`title must be 1..${MAX_TITLE} characters`)
  const teto = input.maxContent === undefined ? MAX_CONTENT : input.maxContent
  if (teto !== null && content.length > teto) throw new KnowledgeValidationError(`content must be at most ${teto} characters`)

  await exigirEspaco(accountId, content)
  const { maxContent: _teto, ...resto } = input
  // As ligações `[[Título]]` viram referências por ID no momento de salvar. Guardar o
  // título quebraria a conexão no dia em que alguém renomeasse o alvo.
  const links = resto.links ?? (await resolveLinks(accountId, [owner], content))
  return (await createDocumentFor(owner, { ...resto, title, content, links })) as KnowledgeDocument
}

export async function updateDocument(
  accountId: string,
  owner: KnowledgeOwner,
  documentId: ObjectId,
  updates: UpdateDocumentInput & { maxContent?: number | null },
): Promise<KnowledgeDocument | null> {
  const { maxContent, ...campos } = updates
  if (campos.title !== undefined) {
    const t = campos.title.trim()
    if (!t) throw new KnowledgeValidationError('title cannot be empty')
    if (t.length > MAX_TITLE) throw new KnowledgeValidationError(`title must be 1..${MAX_TITLE} characters`)
    campos.title = t
  }
  if (campos.content !== undefined) {
    const teto = maxContent === undefined ? MAX_CONTENT : maxContent
    if (!campos.content.trim()) throw new KnowledgeValidationError('content cannot be empty')
    if (teto !== null && campos.content.length > teto) throw new KnowledgeValidationError(`content must be at most ${teto} characters`)
    /**
     * A cota vale para a EDIÇÃO também.
     *
     * Um texto trocado por outro dez vezes maior ocupa espaço igual ao de um documento
     * novo. Conferir só na criação deixava a porta aberta: bastava criar pequeno e
     * crescer depois. O que já está gravado conta duas vezes nesta soma, e essa é a
     * folga que a conta perde — a alternativa seria descontar o tamanho anterior antes
     * de saber se a gravação vai acontecer.
     */
    await exigirEspaco(accountId, campos.content)
    campos.links = await resolveLinks(accountId, [owner], campos.content)
  }
  return (await updateDocumentFor(owner, documentId, campos)) as KnowledgeDocument | null
}

export const getDocument = (owner: KnowledgeOwner, documentId: ObjectId) => getDocumentFor(owner, documentId)
export const removeDocument = (owner: KnowledgeOwner, documentId: ObjectId) => deleteDocumentFor(owner, documentId)
export const reindexDocument = (owner: KnowledgeOwner, documentId: ObjectId) => reindexDocumentFor(owner, documentId)
export const listPage = (owner: KnowledgeOwner, query: DocumentQuery) => listDocumentsPage(owner, query)

/**
 * O texto de um arquivo enviado.
 *
 * Imagem exige um modelo para transcrever, e modelo exige provedor. Fora do escopo do
 * agente não há provedor para resolver — e escolher um "qualquer que a conta tenha"
 * seria inventar de quem é a conta que paga. Nesse caso a recusa é dita: texto e PDF
 * passam, imagem não.
 */
export async function extractUpload(
  buffer: Buffer,
  mimeType: string,
  provider: 'anthropic' | 'openai' | null,
  apiKey: string | null,
): Promise<string> {
  if (mimeType?.startsWith('image/') && (!provider || !apiKey)) {
    throw new KnowledgeValidationError('images can only be transcribed in an agent base, where the provider is known', 'no_provider')
  }
  const conteudo = await extractTextFromFile(buffer, mimeType, provider, apiKey)
  if (!conteudo.trim()) throw new KnowledgeValidationError('Could not extract any text from this file')
  return conteudo
}

/** A forma de um documento na API unificada — sem o conteúdo, com os defaults aplicados. */
export function serializeDocument(doc: KnowledgeDocument, opts: { withContent?: boolean } = {}) {
  const d = withKnowledgeDefaults(doc)
  return {
    id: d._id.toString(),
    scopeType: d.ownerType,
    scopeId: d.ownerId?.toString() ?? null,
    title: d.title,
    format: d.format,
    lifecycleStatus: d.lifecycleStatus,
    authority: d.authority,
    validFrom: d.validFrom ?? null,
    validUntil: d.validUntil ?? null,
    verifiedAt: d.verifiedAt ?? null,
    verifiedBy: d.verifiedBy ?? null,
    reviewIntervalDays: d.reviewIntervalDays ?? null,
    // Ausente quando ninguém mediu — e ausente é a informação, não um buraco.
    confidence: d.confidence ?? null,
    links: d.links ?? [],
    source: d.source ?? 'manual',
    sourceRef: d.sourceRef ?? null,
    authorId: d.authorId ?? null,
    indexStatus: d.indexStatus ?? 'indexed',
    indexError: d.indexError ?? null,
    chunkCount: d.chunkCount ?? 0,
    ...(d.web ? { web: { url: d.web.canonicalUrl, domain: d.web.domain, fetchedAt: d.web.fetchedAt } } : {}),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    ...(opts.withContent ? { content: d.content } : {}),
  }
}
