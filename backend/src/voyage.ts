import type { EmbeddingCapabilities, EmbeddingProvider } from './embeddings/provider.js'
import type { BudgetDenial } from './embeddings/budget.js'
import { embeddingBudgetConfig, estimateTokens, releaseReservation, reserveTokens, settleReservation } from './embeddings/budget.js'

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings'

/**
 * Os modelos que esta instalação aceita — a lista é uma POLÍTICA, não um catálogo.
 *
 * Um modelo fora daqui é recusado em vez de repassado ao provedor. A razão é dinheiro:
 * modelos têm preços diferentes, e um nome digitado errado numa variável de ambiente não
 * pode virar uma chamada a um modelo mais caro que ninguém escolheu.
 */
export const VOYAGE_MODELS = ['voyage-4', 'voyage-4-lite', 'voyage-4-large', 'voyage-context-4', 'voyage-code-4'] as const
export type VoyageModel = (typeof VOYAGE_MODELS)[number]

export const isVoyageModel = (m: string): m is VoyageModel => (VOYAGE_MODELS as readonly string[]).includes(m)

/**
 * O modelo em uso. Configurável, e validado contra a política.
 *
 * Um valor inválido NÃO cai em silêncio para outro modelo: ele avisa no log e usa o
 * padrão. Trocar de modelo sem que ninguém tenha pedido é como uma configuração errada
 * vira uma conta diferente da esperada.
 */
export const DEFAULT_VOYAGE_MODEL: VoyageModel = 'voyage-4'

export function voyageModel(): VoyageModel {
  const bruto = process.env.VOYAGE_MODEL?.trim()
  if (!bruto) return DEFAULT_VOYAGE_MODEL
  if (isVoyageModel(bruto)) return bruto
  console.warn(`[embedding] VOYAGE_MODEL="${bruto}" não está na lista permitida; usando ${DEFAULT_VOYAGE_MODEL}`)
  return DEFAULT_VOYAGE_MODEL
}

/**
 * O modelo de recuo, quando o principal falha por um motivo que o recuo resolve.
 *
 * Recuar NÃO é uma forma de contornar o limite de tokens: o orçamento é da conta, e o
 * modelo trocado gasta da mesma franquia. Serve para um modelo indisponível ou não
 * reconhecido pelo provedor — situação em que insistir no mesmo nome só repete o erro.
 */
export function voyageFallbackModel(): VoyageModel | null {
  const ligado = (process.env.VOYAGE_MODEL_FALLBACK_ENABLED ?? 'true').toLowerCase()
  if (ligado === '0' || ligado === 'false') return null
  const bruto = process.env.VOYAGE_FALLBACK_MODEL?.trim() || 'voyage-4-lite'
  if (!isVoyageModel(bruto)) {
    console.warn(`[embedding] VOYAGE_FALLBACK_MODEL="${bruto}" não está na lista permitida; sem recuo`)
    return null
  }
  const principal = voyageModel()
  return bruto === principal ? null : bruto
}

interface VoyageEmbeddingResponse {
  data: { embedding: number[] }[]
  /** O provedor informa o que cobrou. Quando informa, é ele que vale — não a estimativa. */
  usage?: { total_tokens?: number }
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

/** Quantas vezes uma chamada pode ser repetida. Finito por definição: retry sem teto é loop. */
const MAX_TENTATIVAS = Number(process.env.VOYAGE_MAX_RETRIES ?? 2)
/** Teto da espera entre tentativas. O provedor pode pedir mais; nós não esperamos além disto. */
const MAX_ESPERA_S = Number(process.env.VOYAGE_MAX_BACKOFF_SECONDS ?? 30)

async function embedLote(
  textos: string[],
  inputType: 'document' | 'query',
  apiKey: string,
  modelo: string,
): Promise<{ embeddings: number[][]; totalTokens: number | null }> {
  // Repetição LIMITADA, e só quando o provedor pede ritmo ou tropeça. Insistir contra
  // 400 seria repetir o mesmo erro; contra 429 é o que ele mandou fazer. A espera cresce
  // a cada tentativa (1s, 2s, 4s…) e respeita o `Retry-After` quando ele vem — bater na
  // mesma porta no mesmo ritmo é como um limite temporário vira bloqueio.
  for (let tentativa = 0; ; tentativa++) {
    const res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: textos,
        model: modelo,
        input_type: inputType,
      }),
    })

    if (res.ok) {
      const data = (await res.json()) as VoyageEmbeddingResponse
      const informado = Number(data.usage?.total_tokens)
      return {
        embeddings: data.data.map((item) => item.embedding),
        totalTokens: Number.isFinite(informado) && informado > 0 ? informado : null,
      }
    }

    const podeEsperar = (res.status === 429 || res.status >= 500) && tentativa < MAX_TENTATIVAS
    if (!podeEsperar) {
      const body = await res.text()
      // O corpo pode trazer a chave numa mensagem de erro do provedor; nunca sai inteiro.
      throw new Error(`Voyage embeddings request failed (${res.status}): ${body.slice(0, 200)}`)
    }
    const pedido = Number(res.headers.get('retry-after'))
    const espera = Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, MAX_ESPERA_S) : Math.min(2 ** tentativa, MAX_ESPERA_S)
    await esperar(espera * 1000)
  }
}

/** De onde veio a chamada. Sem isto, "gastamos 4 milhões de tokens" não vira ação nenhuma. */
export interface EmbeddingContext {
  operation: string
  ownerId?: string | null
  agentId?: string | null
  sectorId?: string | null
}

/**
 * O erro de quem foi barrado ANTES de gastar.
 *
 * Tem tipo próprio porque a ação é diferente de qualquer outra falha: não adianta tentar
 * de novo, não é o provedor que está fora, e ninguém foi cobrado. É uma decisão de
 * configuração esperando alguém.
 */
export class EmbeddingBudgetError extends Error {
  code: BudgetDenial
  constructor(code: BudgetDenial, reason: string) {
    super(reason)
    this.name = 'EmbeddingBudgetError'
    this.code = code
  }
}

/**
 * Um lote, com o orçamento respeitado do começo ao fim.
 *
 * A ordem importa e é a razão de tudo isto existir: RESERVA primeiro, chama depois. Se a
 * reserva não couber, a API não é chamada — e nada é cobrado. Se a chamada falhar, a
 * reserva volta inteira, porque uma tentativa que não aconteceu não pode consumir
 * franquia de quem vem depois.
 */
async function embedLoteComOrcamento(
  lote: string[],
  inputType: 'document' | 'query',
  apiKey: string,
  ctx: EmbeddingContext,
): Promise<number[][]> {
  const cfg = embeddingBudgetConfig()
  const estimado = estimateTokens(lote)
  const reserva = await reserveTokens(estimado, cfg)
  if (!reserva.ok) {
    await settleReservation({
      provider: cfg.provider,
      model: voyageModel(),
      operation: ctx.operation,
      estimatedTokens: estimado,
      actualTokens: null,
      texts: lote.length,
      ok: false,
      error: `${reserva.code}: ${reserva.reason}`,
      ownerId: ctx.ownerId ?? null,
      agentId: ctx.agentId ?? null,
      sectorId: ctx.sectorId ?? null,
    })
    throw new EmbeddingBudgetError(reserva.code!, reserva.reason!)
  }

  const principal = voyageModel()
  const recuo = voyageFallbackModel()
  let usado = principal
  try {
    let r: { embeddings: number[][]; totalTokens: number | null }
    try {
      r = await embedLote(lote, inputType, apiKey, principal)
    } catch (erro) {
      /**
       * O recuo é para o modelo que o provedor não reconhece — e para mais nada.
       *
       * Um 4xx sobre o NOME do modelo é o único caso em que repetir com outro nome tem
       * chance de funcionar. Recuar diante de 429 ou de falta de crédito seria usar o
       * recuo para contornar um limite da conta, que é exatamente o que ele não pode
       * fazer: a franquia é a mesma nos dois modelos.
       */
      const msg = erro instanceof Error ? erro.message : ''
      const sobreOModelo = /\(40[04]\)/.test(msg) && /model/i.test(msg)
      if (!recuo || !sobreOModelo) throw erro
      console.warn(`[embedding] modelo ${principal} recusado pelo provedor; tentando ${recuo}`)
      usado = recuo
      r = await embedLote(lote, inputType, apiKey, recuo)
    }
    await settleReservation({
      provider: cfg.provider,
      model: usado,
      operation: ctx.operation,
      estimatedTokens: estimado,
      // O que o provedor informou vale mais que a estimativa: é o que ele cobra.
      actualTokens: r.totalTokens,
      texts: lote.length,
      ok: true,
      ownerId: ctx.ownerId ?? null,
      agentId: ctx.agentId ?? null,
      sectorId: ctx.sectorId ?? null,
    })
    return r.embeddings
  } catch (erro) {
    await releaseReservation(cfg.provider, estimado)
    await settleReservation({
      provider: cfg.provider,
      model: usado,
      operation: ctx.operation,
      estimatedTokens: estimado,
      actualTokens: null,
      texts: lote.length,
      ok: false,
      error: (erro instanceof Error ? erro.message : 'falha').slice(0, 200),
      ownerId: ctx.ownerId ?? null,
      agentId: ctx.agentId ?? null,
      sectorId: ctx.sectorId ?? null,
    })
    throw erro
  }
}

export async function embedTexts(
  texts: string[],
  inputType: 'document' | 'query',
  ctx: EmbeddingContext = { operation: 'unknown' },
): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY is not set')
  }
  if (texts.length === 0) return []

  // Em série: o provedor cobra por ritmo, e paralelizar aqui compraria 429 — que é
  // justamente o erro que deixaria o documento sem trechos.
  const saida: number[][] = []
  for (const lote of loteDeTextos(texts)) {
    saida.push(...(await embedLoteComOrcamento(lote, inputType, apiKey, ctx)))
  }
  return saida
}

export async function embedText(text: string, inputType: 'document' | 'query', ctx?: EmbeddingContext): Promise<number[]> {
  const [embedding] = await embedTexts([text], inputType, ctx)
  return embedding
}

/**
 * O Voyage como implementação do contrato de provedor.
 *
 * Fica aqui, junto do cliente, para não haver duas verdades sobre o que ele aceita. Quem
 * for adicionar OpenAI ou Cohere implementa a mesma interface e não toca em orçamento,
 * painel nem registro de uso.
 */
export const voyageProvider: EmbeddingProvider = {
  name: 'voyage',
  embed: async (text, inputType, model) => ({
    embeddings: [await embedText(text, inputType, { operation: `provider:${model}` })],
    totalTokens: null,
    model,
  }),
  embedBatch: async (texts, inputType, model) => ({
    embeddings: await embedTexts(texts, inputType, { operation: `provider:${model}` }),
    totalTokens: null,
    model,
  }),
  estimateTokens,
  supportsModel: (model) => isVoyageModel(model),
  getCapabilities: (): EmbeddingCapabilities => ({
    models: [...VOYAGE_MODELS],
    maxBatchSize: MAX_ITENS_POR_LOTE,
    maxBatchChars: MAX_CARACTERES_POR_LOTE,
  }),
}
