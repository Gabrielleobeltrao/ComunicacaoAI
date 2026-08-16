// "Mudou?" — a decisão, sem I/O.
//
// Fica separada da busca e do banco porque é a parte que precisa estar certa: é ela
// que decide se a LLM roda. Um erro aqui ou gasta tokens à toa, ou perde uma
// notícia. Sendo pura, dá para testá-la com casos exatos em vez de subir um feed.
import { createHash } from 'node:crypto'
import { dedupeItems, filterByWindow, parseRssItems } from './sources.js'
import type { RssItem } from './sources.js'

// O hash mora AQUI, e não no módulo de persistência, porque ele é parte da
// decisão — não do armazenamento. Importá-lo de lá arrastava o banco inteiro para
// dentro de um módulo que existe justamente para ser testado sem banco nenhum.
export const contentHashOf = (texto: string): string => createHash('sha256').update(texto).digest('hex')

export interface RssChange {
  kind: 'rss'
  changed: boolean
  novos: RssItem[]
  novasChaves: string[]
  // Primeira volta: não há checkpoint, então vale a janela escolhida pelo usuário.
  primeiraVolta: boolean
}

export interface HttpChange {
  kind: 'http'
  changed: boolean
  conteudo: string
  contentHash: string
  primeiraVolta: boolean
}

// A chave de um item, na ordem em que ela é confiável: o GUID é o que o autor do
// feed declara estável; o link vem depois; e o último recurso é um hash do que dá
// para ler. Nunca o índice na lista — a posição de um item muda a cada publicação.
export const chaveDoItem = (item: RssItem): string =>
  item.guid || item.url || contentHashOf(`${item.title}|${item.publishedAt ?? ''}`)

/**
 * O que há de novo num feed.
 *
 * Na primeira volta, a janela do usuário decide o que é "recente o bastante para
 * valer a pena" — sem ela, assinar um feed antigo despejaria o arquivo inteiro na
 * primeira execução. Nas voltas seguintes a janela não é mais aplicada: o que manda
 * é o que já foi visto, senão um item publicado com data velha (ou sem data) seria
 * descartado para sempre.
 */
export function detectRssChange(xml: string, vistas: string[], windowMs: number, agora: number): RssChange {
  const todos = dedupeItems(parseRssItems(xml))
  const primeiraVolta = vistas.length === 0
  const candidatos = primeiraVolta ? filterByWindow(todos, windowMs, agora) : todos

  const jaVistas = new Set(vistas)
  const novos = candidatos.filter((item) => !jaVistas.has(chaveDoItem(item)))

  return {
    kind: 'rss',
    changed: novos.length > 0,
    novos,
    novasChaves: novos.map(chaveDoItem),
    primeiraVolta,
  }
}

/**
 * Normalização do conteúdo HTTP antes de comparar.
 *
 * Uma página muda de bytes o tempo todo sem mudar de conteúdo: espaço em branco
 * reflorado, um timestamp de renderização, um id de sessão no HTML. Comparar bytes
 * crus faria a rotina disparar a cada verificação — que é o oposto do que ela
 * existe para fazer.
 *
 * O que sobra é texto visível, com espaços colapsados. Não é perfeito, e não tenta
 * ser: o que ele resolve é o ruído comum.
 */
export function normalizeHttpContent(bruto: string, contentType = ''): string {
  let texto = bruto
  if (/html|xml/i.test(contentType)) {
    texto = texto
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' ')
  }
  return texto.replace(/\s+/g, ' ').trim()
}

export function detectHttpChange(corpo: string, contentType: string, hashAnterior: string | null): HttpChange {
  const conteudo = normalizeHttpContent(corpo, contentType)
  const contentHash = contentHashOf(conteudo)
  const primeiraVolta = hashAnterior === null
  return {
    kind: 'http',
    // Primeira volta conta como mudança: é a linha de base, e o usuário acabou de
    // pedir para monitorar — devolver "nada mudou" na estreia seria confuso.
    changed: primeiraVolta || contentHash !== hashAnterior,
    conteudo,
    contentHash,
    primeiraVolta,
  }
}

// A janela inicial oferecida na interface, em milissegundos.
export const INITIAL_WINDOWS = { '24h': 86_400_000, '3d': 259_200_000, '7d': 604_800_000 } as const
export type InitialWindow = keyof typeof INITIAL_WINDOWS
export const isInitialWindow = (v: unknown): v is InitialWindow => typeof v === 'string' && v in INITIAL_WINDOWS
