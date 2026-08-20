// Ler uma página pública, do jeito que ela precisa ser lida.
//
// A leitura era uma requisição HTTP e ponto. Isso resolve o site simples e falha calado
// em três casos comuns: a página cujo conteúdo é montado por JavaScript (vem uma casca
// vazia), a que mostra aviso de cookie antes do texto, e a que responde 200 com um
// desafio anti-robô. Nos três, o que era guardado como conhecimento era navegação — ou
// nada.
//
// Esta camada é o único caminho de leitura: HTTP primeiro, porque é barato e resolve a
// maioria; se o que voltou não serve E dá para melhorar com um navegador, tenta de novo
// renderizando. O veredito de "serve" é determinístico (`contentQuality`), e o erro,
// quando existe, tem NOME — quem configurou o endereço precisa saber se o problema é
// login, robô, JavaScript ou página vazia, porque a ação é diferente em cada caso.
//
// O navegador é uma PORTA: este módulo não conhece Playwright. Quem tiver um renderizador
// o injeta; quem não tiver recebe `JS_REQUIRED` com a explicação, em vez de um texto vazio
// que passaria por conhecimento.
//
// Nada aqui contorna login, paywall ou verificação anti-robô: quando a página pede isso,
// a leitura para e diz o que aconteceu.
import { safeFetch } from './net/safeHttp.js'
import { checkContentQuality, classifyPage } from './contentQuality.js'
import type { PageKind, QualityVerdict, ReadErrorCode } from './contentQuality.js'
import {
  canonicalizeUrl,
  canonicalFromHtml,
  domainOf,
  extractJsonLd,
  extractPairs,
  extractLinks,
  extractReadableText,
  extractTables,
  extractPageMeta,
} from './webContent.js'
import type { ExtractedTable } from './webContent.js'
import { contentHashOf } from './automations/sourceChange.js'

/** Como ler. `auto` tenta HTTP e cai para o navegador quando vale a pena. */
export type ReadMode = 'auto' | 'http' | 'browser'
export const READ_MODES: ReadMode[] = ['auto', 'http', 'browser']

export interface ReaderPage {
  html: string
  contentType: string
  finalUrl: string
  status: number
  /** O que o site respondeu no `Retry-After`, quando respondeu. */
  retryAfterSeconds?: number
}

/**
 * O renderizador de navegador, injetado.
 *
 * Recebe a URL e devolve o HTML JÁ RENDERIZADO. Quem implementa cuida de esperar o
 * conteúdo aparecer, do teto de tempo, da concorrência e de fechar o que abriu — e usa a
 * mesma proteção de endereço do resto do sistema.
 */
export type BrowserRenderer = (url: string, opts: { timeoutMs: number }) => Promise<ReaderPage>

export interface ReadOptions {
  mode?: ReadMode
  timeoutMs?: number
  browserTimeoutMs?: number
  maxBytes?: number
  /** Ausente = não há navegador disponível nesta instalação. */
  renderer?: BrowserRenderer | null
  /** Injetável para teste; o padrão é o `safeFetch` de sempre. */
  fetchPage?: (url: string, opts: { timeoutMs: number; maxBytes: number }) => Promise<ReaderPage>
}

/** Um link que a página oferece. Serve para descobrir, e para dizer de onde veio o dado. */
export interface ExtractedLink {
  url: string
  text: string
}

export interface ReadResult {
  ok: boolean
  url: string
  /** Como foi lida de fato. */
  readMethod: 'http' | 'browser'
  /** Por que trocou de método, quando trocou. */
  fallbackReason?: string | null
  /**
   * O que foi TENTADO, em ordem, e no que deu.
   *
   * Sem isto, uma leitura que falhou é um código de erro sem história: não dá para saber
   * se o navegador chegou a ser tentado, nem por que ele não foi. O painel mostra esta
   * lista, e é ela que transforma "não deu" em "tentei isto, deu isso, então parei".
   */
  strategies: StrategyAttempt[]
  /** O que o servidor disse que estava mandando. */
  contentType: string
  /** Quando esta leitura aconteceu. Vale para TODO resultado, não só para o estruturado. */
  capturedAt: string
  /** Os links da página. É deles que sai a descoberta de outras páginas. */
  links: ExtractedLink[]
  /** Quantos segundos o site pediu para esperar, quando pediu (429/503). */
  retryAfterSeconds?: number
  code?: ReadErrorCode
  reason: string
  kind: PageKind
  text: string
  html: string
  contentHash: string
  /** O que a página entregou já estruturado. Ausente quando não há nada. */
  structuredData?: {
    tables?: ExtractedTable[]
    jsonLd?: Record<string, unknown>[]
    pairs?: Record<string, string>
    /** QUANDO isto valia. Para um número que muda, é metade da informação. */
    capturedAt: string
  }
  metadata: {
    title: string | null
    canonicalUrl: string
    domain: string
    author: string | null
    publishedAt: Date | null
    modifiedAt: Date | null
    usefulChars: number
    status: number
  }
  durationMs: number
}

/** Uma tentativa de ler, e no que deu. */
export interface StrategyAttempt {
  strategy: 'http' | 'browser' | 'cooldown'
  ok: boolean
  code?: ReadErrorCode
  reason: string
  durationMs: number
}

const TIMEOUT_HTTP_MS = 8_000
const TIMEOUT_BROWSER_MS = 20_000
const MAX_BYTES = 1_500_000

/**
 * O freio: um domínio que pediu calma não é procurado de novo até a hora passar.
 *
 * Sem isto, um 429 na primeira página de uma rodada era seguido por mais dezenove
 * requisições ao mesmo site — cada uma levando outro 429, e cada uma aproximando o
 * bloqueio permanente que o limite temporário existia para evitar. O site já disse
 * quanto esperar; obedecer é mais barato que descobrir a alternativa.
 *
 * Em memória de propósito: é uma proteção de rodada, não um estado a persistir. Reiniciar
 * o processo é justamente quando faz sentido tentar de novo.
 */
const emEspera = new Map<string, { ate: number; motivo: string }>()
/** Quando o site não diz quanto esperar. Curto: a intenção é frear a rodada, não punir. */
const ESPERA_PADRAO_S = 60
const ESPERA_MAXIMA_S = 3_600

/** Só para o teste — nenhuma rodada de produção precisa esquecer o que acabou de aprender. */
export const resetRateLimits = (): void => emEspera.clear()

function aindaEsperando(url: string, agora: number): { ate: number; motivo: string } | null {
  const dominio = domainOf(url)
  const espera = emEspera.get(dominio)
  if (!espera) return null
  if (espera.ate <= agora) {
    emEspera.delete(dominio)
    return null
  }
  return espera
}

function anotarEspera(url: string, segundos: number | undefined, motivo: string, agora: number): number {
  const espera = Math.min(Math.max(segundos ?? ESPERA_PADRAO_S, 1), ESPERA_MAXIMA_S)
  emEspera.set(domainOf(url), { ate: agora + espera * 1000, motivo })
  return espera
}

const buscarPadrao = async (url: string, opts: { timeoutMs: number; maxBytes: number }): Promise<ReaderPage> => {
  // `requireOk: false`: um 403 com corpo é informação — é ele que diz se o site recusou,
  // pediu login ou mandou um desafio. Lançar aqui apagaria o diagnóstico.
  const res = await safeFetch(url, { timeoutMs: opts.timeoutMs, maxBytes: opts.maxBytes })
  return {
    html: res.body,
    contentType: res.contentType ?? '',
    finalUrl: res.finalUrl || url,
    status: res.status,
    ...(res.retryAfterSeconds !== undefined ? { retryAfterSeconds: res.retryAfterSeconds } : {}),
  }
}

/**
 * Isto é um documento XML — feed ou sitemap —, e não uma página?
 *
 * A distinção evita um erro de categoria: as regras de qualidade (menu, rodapé, aviso de
 * cookie, casca de app) são sobre PÁGINAS. Um feed sem parágrafos não está vazio nem
 * precisa de navegador: ele é uma lista de endereços, e está exatamente como deveria.
 */
const ehDocumentoXml = (pagina: ReaderPage): boolean =>
  /xml|rss|atom/i.test(pagina.contentType) || /^\s*<\?xml|^\s*<(rss|feed|urlset|sitemapindex)\b/i.test(pagina.html.slice(0, 200))

/** Num feed ou sitemap os endereços vêm em <link> ou <loc>, e não em <a>. */
function linksDeXml(xml: string, base: string): ExtractedLink[] {
  const saida: ExtractedLink[] = []
  const vistos = new Set<string>()
  const re = /<(?:link|loc)\b[^>]*>([\s\S]*?)<\/(?:link|loc)>|<link\b[^>]*href\s*=\s*["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) && saida.length < 200) {
    const bruto = (m[1] ?? m[2] ?? '').trim()
    if (!bruto) continue
    let absoluto: string
    try {
      absoluto = new URL(bruto, base).toString()
    } catch {
      continue
    }
    if (!/^https?:/i.test(absoluto) || vistos.has(absoluto)) continue
    vistos.add(absoluto)
    saida.push({ url: absoluto, text: '' })
  }
  return saida
}

/** Monta o resultado a partir de uma página já obtida — o mesmo para HTTP e navegador. */
function extrair(pagina: ReaderPage, metodo: 'http' | 'browser', comecou: number, fallbackReason: string | null): ReadResult {
  if (ehDocumentoXml(pagina)) {
    const texto = extractReadableText(pagina.html)
    return {
      ok: pagina.status < 400 && pagina.html.trim().length > 0,
      url: pagina.finalUrl,
      readMethod: metodo,
      fallbackReason,
      reason: 'documento XML (feed ou sitemap)',
      kind: 'structured_data',
      strategies: [],
      contentType: pagina.contentType,
      capturedAt: new Date().toISOString(),
      // Num feed, os "links" estão em <link>, não em <a>. Os endereços saem daqui do
      // mesmo jeito: quem descobre não precisa saber em que tag eles vieram.
      links: linksDeXml(pagina.html, pagina.finalUrl),
      text: texto,
      html: pagina.html,
      contentHash: contentHashOf(texto),
      metadata: {
        title: null,
        canonicalUrl: canonicalizeUrl(pagina.finalUrl),
        domain: domainOf(pagina.finalUrl),
        author: null,
        publishedAt: null,
        modifiedAt: null,
        usefulChars: texto.length,
        status: pagina.status,
      },
      durationMs: Date.now() - comecou,
    }
  }
  const texto = extractReadableText(pagina.html)
  const veredito: QualityVerdict = checkContentQuality(pagina.html, texto, { status: pagina.status })
  const tabelas = extractTables(pagina.html)
  const jsonLd = extractJsonLd(pagina.html)
  const pares = extractPairs(pagina.html)
  const meta = extractPageMeta(pagina.html, pagina.finalUrl)
  const temEstruturado = tabelas.length > 0 || jsonLd.length > 0 || Object.keys(pares).length > 0

  return {
    ok: veredito.ok,
    url: pagina.finalUrl,
    readMethod: metodo,
    fallbackReason,
    ...(veredito.code ? { code: veredito.code } : {}),
    reason: veredito.reason,
    kind: classifyPage(pagina.html, texto, { tables: tabelas.length, jsonLd: jsonLd.length }),
    strategies: [],
    contentType: pagina.contentType,
    capturedAt: new Date().toISOString(),
    links: extractLinks(pagina.html, pagina.finalUrl),
    text: texto,
    html: pagina.html,
    contentHash: contentHashOf(texto),
    ...(temEstruturado
      ? {
          structuredData: {
            ...(tabelas.length ? { tables: tabelas } : {}),
            ...(jsonLd.length ? { jsonLd } : {}),
            ...(Object.keys(pares).length ? { pairs: pares } : {}),
            capturedAt: new Date().toISOString(),
          },
        }
      : {}),
    metadata: {
      title: meta.title,
      canonicalUrl: canonicalizeUrl(pagina.finalUrl, canonicalFromHtml(pagina.html)),
      domain: domainOf(pagina.finalUrl),
      author: meta.author,
      publishedAt: meta.publishedAt,
      modifiedAt: meta.modifiedAt,
      usefulChars: veredito.usefulChars,
      status: pagina.status,
    },
    durationMs: Date.now() - comecou,
  }
}

const falha = (url: string, metodo: 'http' | 'browser', code: ReadErrorCode, reason: string, comecou: number): ReadResult => ({
  ok: false,
  url,
  readMethod: metodo,
  code,
  reason,
  kind: 'unknown',
  strategies: [],
  contentType: '',
  capturedAt: new Date().toISOString(),
  links: [],
  text: '',
  html: '',
  contentHash: '',
  metadata: {
    title: null,
    canonicalUrl: canonicalizeUrl(url),
    domain: domainOf(url),
    author: null,
    publishedAt: null,
    modifiedAt: null,
    usefulChars: 0,
    status: 0,
  },
  durationMs: Date.now() - comecou,
})

/**
 * Lê uma página, escolhendo o método pelo que a página é.
 *
 * Nunca lança: uma leitura que falha é um resultado com nome, não uma exceção que sobe
 * até derrubar a execução de um agente.
 */
export async function readWebPage(url: string, opts: ReadOptions = {}): Promise<ReadResult> {
  const comecou = Date.now()
  const modo = opts.mode ?? 'auto'
  const buscar = opts.fetchPage ?? buscarPadrao
  const renderer = opts.renderer ?? null
  // O histórico do que foi tentado. É o que transforma "não deu" em "tentei isto, deu
  // isso, então parei" — no painel e no log.
  const tentativas: StrategyAttempt[] = []
  const anotar = <T extends ReadResult>(r: T): T => ({ ...r, strategies: [...tentativas, ...r.strategies] })
  const registrar = (strategy: StrategyAttempt['strategy'], r: ReadResult, desde: number) => {
    tentativas.push({
      strategy,
      ok: r.ok,
      ...(r.code ? { code: r.code } : {}),
      reason: r.reason,
      durationMs: Date.now() - desde,
    })
  }

  /**
   * O site pediu calma há pouco: nem chega a perguntar de novo.
   *
   * Esta é a diferença entre respeitar um limite e transformá-lo num bloqueio. E o
   * conhecimento anterior fica intacto — uma leitura que não aconteceu não apaga nada.
   */
  const espera = aindaEsperando(url, comecou)
  if (espera) {
    const faltam = Math.ceil((espera.ate - comecou) / 1000)
    const r = falha(url, 'http', 'RATE_LIMITED', `${espera.motivo} — nova tentativa em ${faltam}s`, comecou)
    return { ...r, retryAfterSeconds: faltam, strategies: [{ strategy: 'cooldown', ok: false, code: 'RATE_LIMITED', reason: r.reason, durationMs: 0 }] }
  }

  const renderizar = async (motivo: string | null): Promise<ReadResult> => {
    if (!renderer) {
      // Este motivo é o MAIS acionável que existe aqui: não é o site que está errado nem
      // o endereço, é que ler esta página exige um navegador e este servidor não tem um.
      // Quem configurou não tem o que corrigir na tela — a decisão é de quem opera.
      return {
        ...falha(url, 'browser', 'BROWSER_UNAVAILABLE', 'esta página só carrega com JavaScript, e este servidor não tem navegador configurado para renderizá-la', comecou),
        fallbackReason: motivo,
      }
    }
    try {
      const pagina = await renderer(url, { timeoutMs: opts.browserTimeoutMs ?? TIMEOUT_BROWSER_MS })
      return extrair(pagina, 'browser', comecou, motivo)
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : ''
      return falha(
        url,
        'browser',
        /timeout|timed out/i.test(mensagem) ? 'BROWSER_TIMEOUT' : 'EXTRACTION_FAILED',
        /timeout|timed out/i.test(mensagem) ? 'o navegador não terminou de carregar a tempo' : 'não foi possível renderizar a página',
        comecou,
      )
    }
  }

  if (modo === 'browser') {
    const desde = Date.now()
    const r = await renderizar('modo navegador escolhido pelo dono')
    registrar('browser', r, desde)
    return anotar(r)
  }

  let pagina: ReaderPage
  const desdeHttp = Date.now()
  try {
    pagina = await buscar(url, { timeoutMs: opts.timeoutMs ?? TIMEOUT_HTTP_MS, maxBytes: opts.maxBytes ?? MAX_BYTES })
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : ''
    // Endereço recusado pela proteção de rede não é caso de tentar de novo com navegador:
    // a recusa é a mesma nos dois caminhos, e é proposital. Já o tempo esgotado é outra
    // coisa — ninguém recusou nada, o site só não respondeu.
    const expirou = /timeout|abort/i.test(mensagem)
    const r = falha(
      url,
      'http',
      expirou ? 'TIMEOUT' : 'HTTP_BLOCKED',
      expirou ? 'o site não respondeu a tempo' : 'não foi possível acessar o endereço',
      comecou,
    )
    registrar('http', r, desdeHttp)
    return anotar(r)
  }

  const primeira = extrair(pagina, 'http', comecou, null)
  registrar('http', primeira, desdeHttp)

  // Pediu calma: anota até quando, para as outras páginas desta rodada não insistirem.
  if (primeira.code === 'RATE_LIMITED') {
    const segundos = anotarEspera(url, pagina.retryAfterSeconds, primeira.reason, comecou)
    return anotar({ ...primeira, retryAfterSeconds: segundos })
  }

  if (primeira.ok || modo === 'http') return anotar(primeira)

  // O que veio não serve. Vale um navegador?
  const veredito = checkContentQuality(pagina.html, primeira.text, { status: pagina.status })
  if (!veredito.retryWithBrowser) return anotar(primeira)

  const desdeNavegador = Date.now()
  const comNavegador = await renderizar(`${veredito.code}: ${veredito.reason}`)
  registrar('browser', comNavegador, desdeNavegador)
  if (comNavegador.ok) return anotar(comNavegador)

  /**
   * Nenhum dos dois serviu — mas o HTML do HTTP continua valendo.
   *
   * Ele é o que a descoberta usa para achar links, e jogá-lo fora porque a renderização
   * falhou faria uma página de índice curta deixar de descobrir qualquer coisa. Fica o
   * corpo do HTTP, com o diagnóstico mais acionável dos dois: login, robô e bloqueio
   * dizem o que fazer; "precisa de navegador" só diz onde parou.
   */
  const acionavel: ReadErrorCode[] = ['LOGIN_REQUIRED', 'CAPTCHA', 'HTTP_BLOCKED', 'CONSENT_REQUIRED', 'RATE_LIMITED']
  // O diagnóstico do HTTP ganha quando ele já diz o que fazer: login, robô, bloqueio,
  // ritmo. Fora esses, quem manda é o navegador — inclusive, e principalmente, quando o
  // que ele tem a dizer é que não existe navegador aqui. Antes essa frase se perdia: o
  // dono lia "o conteúdo é montado por JavaScript" e não ficava sabendo que, deste
  // servidor, aquilo nunca ia ser lido.
  const usarHttp = Boolean(primeira.code && acionavel.includes(primeira.code))
  const codigo = usarHttp ? primeira.code : (comNavegador.code ?? primeira.code)
  return anotar({
    ...primeira,
    ...(codigo ? { code: codigo } : {}),
    reason: usarHttp ? primeira.reason : comNavegador.reason,
    fallbackReason: `${veredito.code}: ${veredito.reason}`,
  })
}
