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
  // O que vai para o agente. Na primeira leitura, só o que está dentro da janela.
  novos: RssItem[]
  // O que vai para o checkpoint: TODAS as chaves do feed que ainda não estavam
  // registradas — inclusive as dos itens velhos, que não serão entregues.
  novasChaves: string[]
  primeiraLeitura: boolean
}

export interface HttpChange {
  kind: 'http'
  changed: boolean
  conteudo: string
  contentHash: string
  primeiraLeitura: boolean
}

// A chave de um item, na ordem em que ela é confiável: o GUID é o que o autor do
// feed declara estável; o link vem depois; e o último recurso é um hash do que dá
// para ler. Nunca o índice na lista — a posição de um item muda a cada publicação.
export const chaveDoItem = (item: RssItem): string =>
  item.guid || item.url || contentHashOf(`${item.title}|${item.publishedAt ?? ''}`)

/**
 * Isto é mesmo um feed?
 *
 * Um servidor que devolve página de login, erro em HTML ou manutenção responde 200
 * com um documento que não tem item nenhum. Sem esta checagem, isso seria lido como
 * "o feed está vazio, nada novo" — e a rotina ficaria eternamente calada dizendo
 * que está tudo bem. Um feed legítimo e realmente vazio TEM raiz de feed, e por
 * isso passa aqui.
 */
export const pareceFeed = (xml: string): boolean => /<(?:rss|feed|channel|rdf:RDF)\b/i.test(xml)

/**
 * O que há de novo num feed.
 *
 * A primeira leitura é o caso delicado. A janela do usuário (24h/3d/7d) decide o
 * que vale a pena ENTREGAR — sem ela, assinar um feed antigo despejaria o arquivo
 * inteiro de uma vez. Mas o checkpoint recebe o feed INTEIRO, item velho incluído:
 * se ele guardasse só o que foi entregue, um item de duas semanas atrás voltaria
 * como "novo" na volta seguinte, quando a janela deixa de ser aplicada.
 *
 * Depois de inicializada, a janela não é mais aplicada: o que manda é o que já foi
 * visto, senão um item publicado com data velha (ou sem data nenhuma) seria
 * descartado para sempre.
 */
export function detectRssChange(
  xml: string,
  vistas: string[],
  windowMs: number,
  agora: number,
  inicializado: boolean,
): RssChange {
  const todos = dedupeItems(parseRssItems(xml))
  const jaVistas = new Set(vistas)

  // A linha de base: tudo que está no feed agora e ainda não foi registrado. Numa
  // fonte recém-criada isto é o feed inteiro.
  const novasChaves = todos.map(chaveDoItem).filter((k) => !jaVistas.has(k))

  const candidatos = inicializado ? todos : filterByWindow(todos, windowMs, agora)
  const novos = candidatos.filter((item) => !jaVistas.has(chaveDoItem(item)))

  return {
    kind: 'rss',
    changed: novos.length > 0,
    novos,
    novasChaves,
    primeiraLeitura: !inicializado,
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

export function detectHttpChange(corpo: string, contentType: string, hashAnterior: string | null, inicializado: boolean): HttpChange {
  const conteudo = normalizeHttpContent(corpo, contentType)
  const contentHash = contentHashOf(conteudo)
  return {
    kind: 'http',
    // Primeira leitura conta como mudança: é a linha de base, e o dono acabou de
    // pedir para monitorar — devolver "nada mudou" na estreia seria confuso.
    changed: !inicializado || contentHash !== hashAnterior,
    conteudo,
    contentHash,
    primeiraLeitura: !inicializado,
  }
}

/**
 * A identidade da fonte, para saber quando ela deixou de ser a mesma.
 *
 * Trocar a URL ou o tipo é começar a monitorar OUTRA coisa: o que já foi visto não
 * vale mais, a janela inicial tem que valer de novo. Trocar foco, horário, formato
 * ou destino não muda nada disto — nenhum deles entra aqui.
 *
 * É um hash, e não a URL: a URL pode carregar token em query string, e o checkpoint
 * não é lugar para guardar credencial.
 */
export function normalizeSourceUrl(bruta: string): string {
  try {
    const u = new URL(bruta.trim())
    // O fragmento nunca chega ao servidor, então não faz parte da identidade.
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`
  } catch {
    return bruta.trim()
  }
}

/**
 * A geração entra na identidade quando existe.
 *
 * Sem ela — rotinas criadas antes do campo — a identidade é exatamente a de antes,
 * e é assim que o checkpoint delas continua valendo sem migração de dados.
 */
export const sourceFingerprint = (kind: 'rss' | 'http', url: string, instanceId?: string | null): string =>
  contentHashOf(instanceId ? `${kind}|${normalizeSourceUrl(url)}|${instanceId}` : `${kind}|${normalizeSourceUrl(url)}`)

// A janela inicial oferecida na interface, em milissegundos.
export const INITIAL_WINDOWS = { '24h': 86_400_000, '3d': 259_200_000, '7d': 604_800_000 } as const
export type InitialWindow = keyof typeof INITIAL_WINDOWS
export const isInitialWindow = (v: unknown): v is InitialWindow => typeof v === 'string' && v in INITIAL_WINDOWS
