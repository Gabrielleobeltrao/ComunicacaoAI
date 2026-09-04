import { ObjectId } from 'mongodb'
import { db } from './db.js'
import { ownerFilter } from './knowledge.js'
import type { KnowledgeDocument, KnowledgeOwner } from './knowledge.js'

// AS LIGAÇÕES ENTRE DOCUMENTOS — escritas por título, guardadas por id.
//
// `[[Política de troca]]` é como uma pessoa escreve uma referência: ela sabe o nome, não
// o ObjectId. Mas guardar o TÍTULO como ligação quebraria a conexão no dia em que alguém
// renomeasse o documento — e ninguém liga uma coisa à outra meses depois.
//
// Por isso o texto continua com o título (é o que a pessoa lê e edita) e a ligação
// resolvida guarda o `documentId`. Renomear o alvo não quebra nada; o texto continua
// mostrando o nome antigo até alguém editar, o que é honesto: foi isso que a pessoa
// escreveu.
//
// O que NÃO é encontrado fica como pendência VISÍVEL. Criar um edge para um documento
// inventado seria desenhar no grafo uma relação que não existe.

/** `[[Título]]` e `[[Título|Rótulo]]`. O rótulo é só apresentação. */
const LINK = /\[\[([^\]|]{1,200})(?:\|([^\]]{1,200}))?\]\]/g

export interface ParsedLink {
  target: string
  label?: string
}

export function parseLinks(markdown: string): ParsedLink[] {
  const fora: ParsedLink[] = []
  const vistos = new Set<string>()
  for (const m of String(markdown ?? '').matchAll(LINK)) {
    const target = m[1].trim()
    if (!target || vistos.has(target.toLowerCase())) continue
    vistos.add(target.toLowerCase())
    fora.push({ target, ...(m[2]?.trim() ? { label: m[2].trim() } : {}) })
    if (fora.length >= 50) break
  }
  return fora
}

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Resolve os títulos citados contra os documentos que o AUTOR pode administrar.
 *
 * O recorte é o ponto: sem ele, escrever `[[Política]]` no rascunho de um agente
 * resolveria para a política de outro andar — e o grafo passaria a mostrar uma ligação
 * que atravessa um escopo que a pessoa nem administra.
 */
export async function resolveLinks(
  ownerId: string,
  escoposPermitidos: KnowledgeOwner[],
  markdown: string,
): Promise<NonNullable<KnowledgeDocument['links']>> {
  const citados = parseLinks(markdown)
  if (citados.length === 0 || escoposPermitidos.length === 0) return citados.map((c) => ({ target: c.target, resolvedDocumentId: null, ...(c.label ? { label: c.label } : {}) }))

  const docs = await db
    .collection<KnowledgeDocument>('knowledge_documents')
    .find({ $or: escoposPermitidos.map((o) => ownerFilter(o)) }, { projection: { title: 1 } })
    .limit(2000)
    .toArray()
  const porTitulo = new Map(docs.map((d) => [normalizar(String(d.title ?? '')), d._id]))

  return citados.map((c) => ({
    target: c.target,
    resolvedDocumentId: porTitulo.get(normalizar(c.target)) ?? null,
    ...(c.label ? { label: c.label } : {}),
  }))
}

/**
 * Os vizinhos de UM SALTO — e só os que o leitor pode acessar.
 *
 * A expansão nunca atravessa escopo: um documento do prédio pode citar um do setor, e se
 * o agente não lê aquele setor, o vizinho não entra. Relação no grafo não é permissão, e
 * também não é relevância — por isso o vizinho volta para a mesma seleção, com o mesmo
 * corte, em vez de entrar por fora do orçamento.
 */
export async function neighborsOf(
  documentIds: ObjectId[],
  ownersPermitidos: KnowledgeOwner[],
  limite = 10,
): Promise<KnowledgeDocument[]> {
  if (documentIds.length === 0 || ownersPermitidos.length === 0) return []
  const documents = db.collection<KnowledgeDocument>('knowledge_documents')

  const seeds = await documents.find({ _id: { $in: documentIds } }, { projection: { links: 1 } }).toArray()
  const alvos = [
    ...new Set(
      seeds
        .flatMap((d) => d.links ?? [])
        .map((l) => l.resolvedDocumentId)
        .filter(Boolean)
        .map((id) => (id as ObjectId).toString()),
    ),
  ]
    .filter((id) => !documentIds.some((d) => d.toString() === id))
    .slice(0, limite)
  if (alvos.length === 0) return []

  const { curationFilter } = await import('./knowledge.js')
  return documents
    .find({
      $and: [
        { _id: { $in: alvos.map((id) => new ObjectId(id)) } },
        // Permissão E validade, de novo: o vizinho passa pelos mesmos filtros do seed.
        { $or: ownersPermitidos.map((o) => ownerFilter(o)) },
        curationFilter(),
      ],
    })
    .limit(limite)
    .toArray()
}

/** Quem aponta PARA este documento. É o que a análise de impacto precisa saber. */
export const documentsLinkingTo = (ownerId: string, documentId: ObjectId) =>
  db
    .collection<KnowledgeDocument>('knowledge_documents')
    .find({ 'links.resolvedDocumentId': documentId }, { projection: { title: 1, ownerType: 1, ownerId: 1 } })
    .limit(100)
    .toArray()
