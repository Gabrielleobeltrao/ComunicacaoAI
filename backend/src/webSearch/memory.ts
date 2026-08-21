// O que a busca encontrou vira memória do agente.
//
// A reutilização não precisa de mecanismo novo: a consulta à base roda ANTES da busca na
// web, então uma página guardada hoje é encontrada amanhã pela pergunta seguinte — e a
// requisição ao buscador nem sai. O que falta é guardar.
//
// Três cuidados, e cada um evita um desperdício diferente:
//
//   * O mesmo endereço é o MESMO documento. Uma página achada por duas buscas não vira
//     duas cópias, e o hash do texto decide se vale reindexar — página que não mudou não
//     custa embedding nenhum.
//   * Tudo tem VALIDADE. Um site cadastrado tem política de releitura; uma página achada
//     uma vez não tem. Sem prazo, um dado de três meses atrás seria respondido como se
//     fosse de hoje.
//   * A procedência fica gravada. Quem olha a base precisa distinguir o que ele mesmo
//     curou do que um buscador trouxe — a confiança nas duas coisas é diferente.
import { ObjectId } from 'mongodb'
import { createDocumentFor, listDocumentsFor, updateDocumentFor } from '../knowledge.js'
import type { ReadResult } from '../adaptiveWebReader.js'
import { canonicalizeUrl, domainOf } from '../webContent.js'

/** A marca que liga um documento à busca que o trouxe. Estável por endereço canônico. */
export const searchDocRef = (canonicalUrl: string): string => `search:${canonicalUrl}`

export interface RememberOutcome {
  saved: number
  updated: number
  unchanged: number
}

/**
 * Guarda as páginas lidas por uma busca na base do agente.
 *
 * Nunca lança: falhar ao guardar não pode derrubar a tarefa — o agente já tem as
 * evidências em mãos, e a memória é um bônus para a próxima pergunta.
 */
export async function rememberSearchPages(
  agentId: ObjectId,
  ownerId: string,
  query: string,
  paginas: ReadResult[],
  rememberDays: number,
  agora: Date = new Date(),
): Promise<RememberOutcome> {
  const saida: RememberOutcome = { saved: 0, updated: 0, unchanged: 0 }
  if (rememberDays <= 0) return saida

  const expiresAt = new Date(agora.getTime() + rememberDays * 24 * 60 * 60 * 1000)
  // O que já existe, para não criar em cima. Sem o conteúdo: só o `sourceRef` importa
  // aqui, e o hash gravado é quem decide se mudou.
  const existentes = await listDocumentsFor({ ownerType: 'agent', ownerId: agentId }).catch(() => [])
  const porRef = new Map(existentes.filter((d) => d.sourceRef).map((d) => [d.sourceRef as string, d]))

  for (const pagina of paginas) {
    if (!pagina.ok || !pagina.text.trim()) continue
    const canonica = pagina.metadata.canonicalUrl || canonicalizeUrl(pagina.url)
    const ref = searchDocRef(canonica)
    const titulo = (pagina.metadata.title || domainOf(canonica) || canonica).slice(0, 200)
    // A procedência fica NO texto: quem lê a resposta precisa poder voltar à origem.
    const conteudo = `${titulo}\nFonte: ${canonica}\nEncontrado por busca: "${query.slice(0, 120)}"\n\n${pagina.text}`
    const web = {
      sourceType: 'web' as const,
      sourceId: 'web-search',
      url: pagina.url,
      canonicalUrl: canonica,
      domain: domainOf(canonica),
      title: pagina.metadata.title,
      author: pagina.metadata.author,
      publishedAt: pagina.metadata.publishedAt,
      modifiedAt: pagina.metadata.modifiedAt,
      fetchedAt: agora,
      contentHash: pagina.contentHash,
      readMethod: pagina.readMethod,
      discoveredBy: 'search' as const,
      query: query.slice(0, 200),
      expiresAt,
    }

    const anterior = porRef.get(ref)
    try {
      if (!anterior) {
        await createDocumentFor({ ownerType: 'agent', ownerId: agentId }, { title: titulo, content: conteudo, source: 'web', sourceRef: ref, authorId: ownerId, web })
        saida.saved += 1
      } else if (anterior.web?.contentHash !== pagina.contentHash) {
        await updateDocumentFor({ ownerType: 'agent', ownerId: agentId }, anterior._id, { title: titulo, content: conteudo, web })
        saida.updated += 1
      } else {
        // O texto é o mesmo: nada é reescrito e nenhum embedding é gerado. Só o prazo
        // é esticado — a página continua valendo, e reencontrá-la é a prova disso.
        await updateDocumentFor({ ownerType: 'agent', ownerId: agentId }, anterior._id, { web: { ...anterior.web!, expiresAt, fetchedAt: agora } })
        saida.unchanged += 1
      }
    } catch {
      // Guardar é bônus. A tarefa segue com as evidências que já estão em mãos.
    }
  }
  return saida
}
