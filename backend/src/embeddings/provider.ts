// O contrato de um provedor de embedding.
//
// Existe para que a proteção de custo NÃO seja específica do Voyage. Reserva, corte,
// registro de uso e painel falam com esta interface; trocar de provedor (ou ter dois)
// não reescreve nada disso.
//
// Deliberadamente pequeno: só o que o sistema realmente usa hoje. Uma interface com
// métodos que ninguém chama é uma promessa que o primeiro provedor novo quebra.
export type EmbeddingInputType = 'document' | 'query'

export interface EmbeddingCapabilities {
  /** Os modelos que este provedor aceita. Um modelo fora daqui é recusado, não adivinhado. */
  models: string[]
  /** Quantos textos cabem numa requisição. */
  maxBatchSize: number
  /** Quantos caracteres cabem numa requisição, somando todos os textos. */
  maxBatchChars: number
}

export interface EmbeddingResult {
  embeddings: number[][]
  /** Tokens que o PROVEDOR informou ter cobrado. Ausente quando ele não informa. */
  totalTokens: number | null
  /** O modelo que de fato respondeu — pode não ser o pedido, se houve fallback. */
  model: string
}

export interface EmbeddingProvider {
  readonly name: string
  /** Um texto. Atalho sobre `embedBatch`, nunca um caminho paralelo. */
  embed(text: string, inputType: EmbeddingInputType, model: string): Promise<EmbeddingResult>
  embedBatch(texts: string[], inputType: EmbeddingInputType, model: string): Promise<EmbeddingResult>
  /** Quantos tokens esta chamada deve custar — antes de fazê-la. */
  estimateTokens(texts: string[]): number
  supportsModel(model: string): boolean
  getCapabilities(): EmbeddingCapabilities
}
