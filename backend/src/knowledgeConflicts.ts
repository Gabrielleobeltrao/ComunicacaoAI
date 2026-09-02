import { ObjectId } from 'mongodb'
import { db } from './db.js'
import type { KnowledgeAuthority, KnowledgeOwnerType } from './knowledge.js'

// QUANDO DOIS DOCUMENTOS DIZEM COISAS DIFERENTES.
//
// O caso real: a política do prédio diz "troca em 7 dias", a nota do setor diz "troca em
// 30 dias". Os dois trechos casam com a mesma pergunta, os dois vão para o modelo, e ele
// escolhe um — sem dizer que escolheu, e sem que ninguém saiba que havia dois.
//
// A detecção é DETERMINÍSTICA: números e prazos com unidade, comparados dentro do mesmo
// assunto. Não é um detector de contradição semântica, e não pretende ser — um modelo
// sinalizando contradição seria um palpite decidindo o que a empresa responde. O que ele
// pode fazer, mais tarde, é sugerir; a autoridade continua sendo da regra e da pessoa.
//
// A precedência é a da especificação, e é aplicada ANTES de o texto chegar ao modelo:
// aprovado supera rascunho; política oficial supera procedimento, referência e nota;
// entre iguais, ganha o verificado mais recentemente — e não o editado mais recentemente,
// que mede quem mexeu por último, não quem conferiu.

export interface ConflictCandidate {
  id: string
  title: string
  content: string
  authority: string
  lifecycleStatus?: string
  verifiedAt?: Date | null
  updatedAt?: Date | null
}

export interface DetectedConflict {
  /** O assunto em disputa — "prazo de troca", "desconto máximo". */
  subject: string
  documentIds: string[]
  /** Os valores incompatíveis encontrados, em texto. */
  values: string[]
}

/** Unidades que tornam um número comparável. Um número solto não é uma regra. */
const UNIDADES = '(dias?|dias corridos|horas?|meses?|anos?|%|por cento|reais|r\\$)'
const VALOR = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${UNIDADES}`, 'gi')

/** As palavras que dizem de QUE assunto aquele número é. */
const assuntoDe = (texto: string, indice: number): string => {
  const antes = texto.slice(Math.max(0, indice - 60), indice)
  const palavras = antes
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length >= 4)
  return palavras.slice(-2).join(' ')
}

/**
 * Os conflitos entre um conjunto de documentos.
 *
 * Só compara valores do MESMO assunto: "7 dias" numa frase sobre troca e "30 dias" numa
 * frase sobre garantia não são contradição, são dois fatos. Sem esse recorte, qualquer
 * base com dois números viraria um conflito, e um painel que grita sempre é um painel
 * que ninguém lê.
 */
export function detectConflicts(candidatos: ConflictCandidate[]): DetectedConflict[] {
  const porAssunto = new Map<string, { id: string; valor: string }[]>()
  for (const c of candidatos) {
    const texto = `${c.title}. ${c.content}`
    for (const m of texto.matchAll(VALOR)) {
      const assunto = assuntoDe(texto, m.index ?? 0)
      if (!assunto) continue
      const lista = porAssunto.get(assunto) ?? []
      lista.push({ id: c.id, valor: m[0].toLowerCase().replace(/\s+/g, ' ') })
      porAssunto.set(assunto, lista)
    }
  }

  const fora: DetectedConflict[] = []
  for (const [assunto, ocorrencias] of porAssunto) {
    const porDocumento = new Map<string, Set<string>>()
    for (const o of ocorrencias) {
      const s = porDocumento.get(o.id) ?? new Set<string>()
      s.add(o.valor)
      porDocumento.set(o.id, s)
    }
    if (porDocumento.size < 2) continue
    const valores = new Set(ocorrencias.map((o) => o.valor))
    // Um valor só, repetido em dois documentos, é acordo — não conflito.
    if (valores.size < 2) continue
    fora.push({ subject: assunto, documentIds: [...porDocumento.keys()], values: [...valores] })
  }
  return fora
}

// --- precedência --------------------------------------------------------------------

const PESO_AUTORIDADE: Record<string, number> = { official_policy: 3, procedure: 2, reference: 1, note: 0 }

/**
 * Qual dos dois vale — e a resposta precisa ser a mesma toda vez.
 *
 * Devolve `null` quando a regra não decide: mesma autoridade, mesma verificação. Aí o
 * conflito é REAL e precisa de gente — resolver no par ou no critério aleatório seria o
 * mesmo que deixar o modelo escolher, com um passo a mais.
 */
export function precedence(a: ConflictCandidate, b: ConflictCandidate): ConflictCandidate | null {
  const aprovado = (c: ConflictCandidate) => (c.lifecycleStatus ?? 'approved') === 'approved'
  if (aprovado(a) !== aprovado(b)) return aprovado(a) ? a : b

  const pa = PESO_AUTORIDADE[a.authority] ?? 1
  const pb = PESO_AUTORIDADE[b.authority] ?? 1
  if (pa !== pb) return pa > pb ? a : b

  // Entre iguais, o mais recentemente VERIFICADO — não o mais recentemente editado, que
  // mede quem mexeu por último e não quem conferiu.
  const va = a.verifiedAt ? new Date(a.verifiedAt).getTime() : null
  const vb = b.verifiedAt ? new Date(b.verifiedAt).getTime() : null
  if (va !== vb) {
    if (va === null) return b
    if (vb === null) return a
    return va > vb ? a : b
  }
  return null
}

// --- o registro do conflito -----------------------------------------------------------

export type ConflictStatus = 'open' | 'resolved' | 'accepted'

export interface KnowledgeConflict {
  _id: ObjectId
  ownerId: string
  scopeType: KnowledgeOwnerType
  scopeId: ObjectId
  subject: string
  documentIds: ObjectId[]
  values: string[]
  status: ConflictStatus
  /** Quem decidiu, o que decidiu e por quê. Sem isto, "resolvido" não é auditável. */
  resolvedBy: string | null
  resolutionNote: string | null
  winnerDocumentId: ObjectId | null
  detectedAt: Date
  resolvedAt: Date | null
}

const conflicts = db.collection<KnowledgeConflict>('knowledge_conflicts')

export async function ensureKnowledgeConflictIndexes(): Promise<void> {
  await conflicts.createIndex({ ownerId: 1, status: 1, detectedAt: -1 })
  await conflicts.createIndex({ ownerId: 1, documentIds: 1 })
  await conflicts.createIndex({ ownerId: 1, scopeType: 1, scopeId: 1, subject: 1 }, { unique: true })
}

/** Roda a detecção num escopo e registra o que achou. Reexecutar não duplica. */
export async function scanScopeForConflicts(
  ownerId: string,
  scope: { ownerType: KnowledgeOwnerType; ownerId: ObjectId },
): Promise<DetectedConflict[]> {
  const { ownerFilter, curationFilter } = await import('./knowledge.js')
  const docs = await db
    .collection('knowledge_documents')
    .find({ $and: [ownerFilter(scope), curationFilter()] }, { projection: { title: 1, content: 1, authority: 1, lifecycleStatus: 1, verifiedAt: 1, updatedAt: 1 } })
    .limit(300)
    .toArray()

  const achados = detectConflicts(
    docs.map((d) => ({
      id: d._id.toString(),
      title: String(d.title ?? ''),
      content: String(d.content ?? ''),
      authority: String(d.authority ?? 'reference'),
      lifecycleStatus: d.lifecycleStatus as string,
      verifiedAt: d.verifiedAt as Date,
      updatedAt: d.updatedAt as Date,
    })),
  )

  for (const c of achados) {
    await conflicts.updateOne(
      { ownerId, scopeType: scope.ownerType, scopeId: scope.ownerId, subject: c.subject },
      {
        $setOnInsert: { detectedAt: new Date(), status: 'open' as ConflictStatus, resolvedBy: null, resolutionNote: null, winnerDocumentId: null, resolvedAt: null },
        $set: { documentIds: c.documentIds.map((id) => new ObjectId(id)), values: c.values },
      },
      { upsert: true },
    )
  }
  return achados
}

export async function listKnowledgeConflicts(ownerId: string, status: ConflictStatus | null = 'open') {
  const filtro: Record<string, unknown> = { ownerId }
  if (status) filtro.status = status
  return conflicts.find(filtro).sort({ detectedAt: -1 }).limit(200).toArray()
}

/** Os conflitos EM ABERTO que envolvem estes documentos. É o que a busca precisa saber. */
export const openConflictsForDocuments = (ownerId: string, documentIds: ObjectId[]) =>
  documentIds.length === 0
    ? Promise.resolve([])
    : conflicts.find({ ownerId, status: 'open', documentIds: { $in: documentIds } }).toArray()

export async function resolveKnowledgeConflict(
  ownerId: string,
  id: ObjectId,
  input: { resolvedBy: string; note: string; winnerDocumentId?: ObjectId | null; accept?: boolean },
): Promise<KnowledgeConflict | null> {
  return conflicts.findOneAndUpdate(
    { _id: id, ownerId },
    {
      $set: {
        status: (input.accept ? 'accepted' : 'resolved') as ConflictStatus,
        resolvedBy: input.resolvedBy,
        resolutionNote: input.note.slice(0, 500),
        winnerDocumentId: input.winnerDocumentId ?? null,
        resolvedAt: new Date(),
      },
    },
    { returnDocument: 'after' },
  )
}
