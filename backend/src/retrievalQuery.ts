// What a retrieval is a question ABOUT. Pure and DB-free on purpose: the routine
// step imports it, and that module must stay unit-testable without a database.
//
// The input is part of the question. It used to be included only when it was a
// string, so a step whose input was an object or an array retrieved nothing —
// exactly the shape a webhook or a previous step hands over.
export function buildRetrievalQuery(
  parts: { objective?: string | null; instructions?: string | null; input?: unknown },
  maxChars = 2000,
): string {
  const input =
    parts.input === undefined || parts.input === null
      ? ''
      : typeof parts.input === 'string'
        ? parts.input
        : (() => {
            try {
              return JSON.stringify(parts.input)
            } catch {
              return ''
            }
          })()
  return [parts.objective ?? '', parts.instructions ?? '', input]
    .map((piece) => String(piece).trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, maxChars)
}

// A passage the model can CITE. The reference carries the document's title and its
// id and nothing else: the owner is never named to the model, and the passage itself
// stays marked as untrusted data by the objective (agentRuntime).
export interface CitableSource {
  documentId: string | null
  title: string | null
}

/**
 * O aviso de que existe MUITO mais do que isto.
 *
 * Uma linha antes das passagens, quando a busca foi cortada. Sem ela o modelo lê seis
 * trechos e conclui como se fossem tudo; com ela, ele tem o que precisa para preferir
 * perguntar "qual recorte?" a responder por cima — que é a diferença entre uma resposta
 * útil e um chute caro.
 */
export function breadthNotice(total: number | undefined, mostrados: number): string | null {
  if (!total || total <= mostrados) return null
  return (
    `ATENÇÃO: ${total} trechos correspondem ao pedido; abaixo estão apenas os ${mostrados} mais relevantes. ` +
    'Se responder exigiria o conjunto todo, NÃO responda por cima: peça um recorte (período, assunto, identificador) ' +
    'usando a ferramenta de esclarecimento.'
  )
}

export function formatContextWithSources(context: string[], sources: CitableSource[] = []): string[] {
  return context.map((passage, index) => {
    const source = sources[index]
    const title = source?.title ? String(source.title).replace(/\s+/g, ' ').slice(0, 120) : null
    const documentId = source?.documentId ? String(source.documentId) : null
    // Without provenance the passage is still numbered, so a citation can refer to
    // it — it just has nothing to name.
    const label = [title, documentId ? `doc ${documentId}` : null].filter(Boolean).join(' · ')
    return `[${index + 1}]${label ? ` ${label}` : ''}\n${passage}`
  })
}
