import { createHash } from 'node:crypto'
import { validateAgainstSchema } from '../../jsonSchema.js'
import { readAt } from '../../apps/official/websocket/config.js'
import type { WsConnectionConfig, WsFilter } from '../../apps/official/websocket/config.js'
import type { WsMessageStatus, WsSubscription } from './types.js'

/**
 * O que acontece com uma mensagem que chega — em ordem, e sempre a mesma.
 *
 * Tudo aqui é PURO: entra o texto cru e a configuração, sai o veredito. Nenhuma
 * chamada, nenhuma escrita, nenhum relógio implícito. É o que permite provar cada regra
 * com um teste determinístico, e é o que garante que a mesma mensagem dá o mesmo
 * resultado no meio do pregão e às três da manhã.
 *
 * A ordem não é arbitrária: o tamanho vem antes do parse (não se interpreta um megabyte
 * para descobrir que ele é grande demais), e o filtro vem antes da dedupe (não se gasta
 * uma escrita para descartar o que nem era para esta assinatura).
 */

export interface ParsedMessage {
  status: WsMessageStatus
  /** Por que foi recusada. Uma frase nossa, sobre a configuração — nunca o conteúdo. */
  reason: string
  /** O conteúdo já recortado pelo caminho configurado. Ausente quando recusada. */
  payload?: unknown
  messageId: string | null
  channel: string
  occurredAt: Date | null
  /** Um pedaço, para a tela reconhecer o que chegou sem guardar tudo. */
  preview: string
}

const PREVIEW_MAX = 300

/**
 * Onde o schema não bateu — usando SÓ nomes que o próprio schema declara.
 *
 * O caminho de um erro pode ser o nome de um campo que veio na mensagem, e o nome de um
 * campo é texto de fora tanto quanto o valor dele. O log e a tela leem isto; um nome
 * escolhido por quem manda a mensagem não pode chegar lá.
 */
function camposDoErro(errors: readonly { path: string }[], schema: Record<string, unknown>): string {
  const declarados = new Set(Object.keys((schema.properties ?? {}) as Record<string, unknown>))
  const nomes = errors.slice(0, 3).map((e) => {
    const raiz = (e.path || '').split(/[.[]/)[0]
    if (!raiz) return '(raiz)'
    return declarados.has(raiz) ? e.path : '(campo não previsto)'
  })
  return [...new Set(nomes)].join(', ')
}

const asTexto = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v) ?? '')

/** Um pedaço curto, e nunca o conteúdo inteiro: ele vem de fora e ninguém o revisou. */
export const previewOf = (v: unknown): string => {
  const t = asTexto(v)
  return t.length > PREVIEW_MAX ? `${t.slice(0, PREVIEW_MAX)}…` : t
}

/**
 * Um filtro, aplicado por LEITURA de caminho e comparação de texto.
 *
 * Igualdade e "contém" cobrem o que uma tela de configuração consegue explicar. Um
 * comparador mais expressivo viraria uma linguagem — e uma linguagem escrita por quem
 * configura e executada pelo servidor é a definição do problema que este App evita.
 */
export function matchesFilters(valor: unknown, filtros: readonly WsFilter[]): boolean {
  return filtros.every((f) => {
    const lido = readAt(valor, f.path)
    if (lido === undefined || lido === null) return false
    const texto = typeof lido === 'string' ? lido : JSON.stringify(lido)
    return f.operator === 'contains' ? texto.includes(f.value) : texto === f.value
  })
}

/**
 * O limite por minuto, contado NA MEMÓRIA do processo que tem o socket.
 *
 * Contar no banco antes de gravar é uma leitura seguida de escrita — e uma rajada, que
 * é exatamente quando o limite importa, atravessa a janela entre as duas: quatro
 * mensagens simultâneas leem "duas" e todas passam.
 *
 * O socket de uma conexão vive em UM processo, então a contagem em memória é exata para
 * ele. O banco continua como piso depois de um restart, quando a memória zerou.
 */
const janelas = new Map<string, number[]>()

export function withinRateLimit(chave: string, limite: number, agora: number): boolean {
  const recentes = (janelas.get(chave) ?? []).filter((t) => agora - t < 60_000)
  if (recentes.length >= limite) {
    janelas.set(chave, recentes)
    return false
  }
  recentes.push(agora)
  janelas.set(chave, recentes)
  return true
}

/** Só para os testes: a janela é global por processo. */
export const resetRateLimits = (): void => janelas.clear()

/** A chave de dedupe, conforme a estratégia. `null` = esta mensagem não deduplica. */
export function dedupeKeyOf(config: WsConnectionConfig, messageId: string | null, payload: unknown): string | null {
  if (config.dedupe === 'message_id') return messageId
  if (config.dedupe === 'payload_hash') return createHash('sha256').update(asTexto(payload)).digest('hex').slice(0, 32)
  return null
}

const dataDe = (v: unknown): Date | null => {
  if (v === undefined || v === null) return null
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Do texto cru ao veredito.
 *
 * `tooLarge` é medido em BYTES, e não em caracteres: um emoji conta quatro, e um teto
 * em caracteres seria um teto que não protege a memória.
 */
export function parseMessage(bruto: string, config: WsConnectionConfig): ParsedMessage {
  const vazio = { messageId: null, channel: '', occurredAt: null, preview: '' }

  const bytes = Buffer.byteLength(bruto, 'utf8')
  if (bytes > config.maxMessageBytes) {
    return { ...vazio, status: 'too_large', reason: `mensagem de ${bytes} bytes acima do limite de ${config.maxMessageBytes}`, preview: previewOf(bruto) }
  }

  let bruta: unknown = bruto
  if (config.format === 'json') {
    try {
      bruta = JSON.parse(bruto)
    } catch {
      // Formato JSON declarado e texto que não é JSON: recusar é dizer a verdade. Tentar
      // adivinhar guardaria lixo com cara de dado.
      return { ...vazio, status: 'invalid', reason: 'a mensagem não é um JSON válido', preview: previewOf(bruto) }
    }
  }

  const payload = readAt(bruta, config.paths.payload)
  const preview = previewOf(payload ?? bruta)

  if (config.schema) {
    const r = validateAgainstSchema(config.schema, payload)
    if (!r.valid) {
      return { ...vazio, status: 'invalid', reason: `não bate com o schema em: ${camposDoErro(r.errors, config.schema)}`, preview }
    }
  }

  if (!matchesFilters(bruta, config.filters)) {
    return { ...vazio, status: 'filtered', reason: 'não passou pelos filtros da conexão', preview }
  }

  const idBruto = readAt(bruta, config.paths.messageId)
  const canal = readAt(bruta, config.paths.channel)
  return {
    status: 'accepted',
    reason: '',
    payload: payload ?? bruta,
    messageId: idBruto === undefined || idBruto === null ? null : String(idBruto).slice(0, 200),
    channel: canal === undefined || canal === null ? '' : String(canal).slice(0, 120),
    occurredAt: dataDe(readAt(bruta, config.paths.occurredAt)),
    preview,
  }
}

/** A assinatura a que esta mensagem pertence. `null` quando nenhuma ativa a reivindica. */
export function subscriptionFor(bruta: unknown, canal: string, assinaturas: readonly WsSubscription[]): WsSubscription | null {
  return (
    assinaturas.find((s) => {
      if (!s.active) return false
      if (s.channel && s.channel !== canal) return false
      return matchesFilters(bruta, s.filters)
    }) ?? null
  )
}
