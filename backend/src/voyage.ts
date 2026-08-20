const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings'
const VOYAGE_MODEL = process.env.VOYAGE_MODEL ?? 'voyage-4'

interface VoyageEmbeddingResponse {
  data: { embedding: number[] }[]
}

/**
 * Quantos trechos vão por requisição, e quanto texto cabe nela.
 *
 * O provedor tem teto de itens E de tokens por chamada. Mandar o documento inteiro de
 * uma vez funciona enquanto o documento é pequeno e falha inteiro quando não é — e
 * "falha inteiro" quer dizer documento com ZERO trechos, invisível para a busca, com o
 * texto guardado e ninguém achando. Era o que acontecia com uma página de tabela: ela
 * cabe nos 20 mil caracteres que a leitura guarda, e não cabe numa chamada só.
 *
 * Os limites são conservadores de propósito: o custo de um lote a mais é uma requisição;
 * o custo de estourar é o documento inteiro fora da busca.
 */
const MAX_ITENS_POR_LOTE = 64
const MAX_CARACTERES_POR_LOTE = 80_000

/** Divide em lotes que respeitam os dois tetos — o de itens e o de tamanho. */
export function loteDeTextos(texts: string[], maxItens = MAX_ITENS_POR_LOTE, maxCaracteres = MAX_CARACTERES_POR_LOTE): string[][] {
  const lotes: string[][] = []
  let atual: string[] = []
  let tamanho = 0
  for (const texto of texts) {
    // Um item sozinho maior que o teto vai sozinho: cortar aqui mudaria o conteúdo
    // indexado sem que ninguém soubesse.
    if (atual.length > 0 && (atual.length >= maxItens || tamanho + texto.length > maxCaracteres)) {
      lotes.push(atual)
      atual = []
      tamanho = 0
    }
    atual.push(texto)
    tamanho += texto.length
  }
  if (atual.length > 0) lotes.push(atual)
  return lotes
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function embedLote(textos: string[], inputType: 'document' | 'query', apiKey: string): Promise<number[][]> {
  // Uma repetição, e só quando o provedor pede ritmo. Insistir contra 400 seria repetir
  // o mesmo erro; insistir contra 429 é o que ele mandou fazer.
  for (let tentativa = 0; ; tentativa++) {
    const res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: textos,
        model: VOYAGE_MODEL,
        input_type: inputType,
      }),
    })

    if (res.ok) {
      const data = (await res.json()) as VoyageEmbeddingResponse
      return data.data.map((item) => item.embedding)
    }

    const podeEsperar = (res.status === 429 || res.status >= 500) && tentativa < 2
    if (!podeEsperar) {
      const body = await res.text()
      // O corpo pode trazer a chave numa mensagem de erro do provedor; nunca sai inteiro.
      throw new Error(`Voyage embeddings request failed (${res.status}): ${body.slice(0, 200)}`)
    }
    const pedido = Number(res.headers.get('retry-after'))
    await esperar(Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, 30) * 1000 : 1000 * (tentativa + 1))
  }
}

export async function embedTexts(texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY is not set')
  }
  if (texts.length === 0) return []

  // Em série: o provedor cobra por ritmo, e paralelizar aqui compraria 429 — que é
  // justamente o erro que deixaria o documento sem trechos.
  const saida: number[][] = []
  for (const lote of loteDeTextos(texts)) {
    saida.push(...(await embedLote(lote, inputType, apiKey)))
  }
  return saida
}

export async function embedText(text: string, inputType: 'document' | 'query'): Promise<number[]> {
  const [embedding] = await embedTexts([text], inputType)
  return embedding
}
