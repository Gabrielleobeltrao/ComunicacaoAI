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

export interface ReadResult {
  ok: boolean
  url: string
  /** Como foi lida de fato. */
  readMethod: 'http' | 'browser'
  /** Por que trocou de método, quando trocou. */
  fallbackReason?: string | null
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

const TIMEOUT_HTTP_MS = 8_000
const TIMEOUT_BROWSER_MS = 20_000
const MAX_BYTES = 1_500_000

const buscarPadrao = async (url: string, opts: { timeoutMs: number; maxBytes: number }): Promise<ReaderPage> => {
  // `requireOk: false`: um 403 com corpo é informação — é ele que diz se o site recusou,
  // pediu login ou mandou um desafio. Lançar aqui apagaria o diagnóstico.
  const res = await safeFetch(url, { timeoutMs: opts.timeoutMs, maxBytes: opts.maxBytes })
  return { html: res.body, contentType: res.contentType ?? '', finalUrl: res.finalUrl || url, status: res.status }
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

  const renderizar = async (motivo: string | null): Promise<ReadResult> => {
    if (!renderer) {
      return falha(
        url,
        'browser',
        'JS_REQUIRED',
        'esta página precisa de um navegador para ser lida, e esta instalação não tem um configurado',
        comecou,
      )
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

  if (modo === 'browser') return renderizar('modo navegador escolhido pelo dono')

  let pagina: ReaderPage
  try {
    pagina = await buscar(url, { timeoutMs: opts.timeoutMs ?? TIMEOUT_HTTP_MS, maxBytes: opts.maxBytes ?? MAX_BYTES })
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : ''
    // Endereço recusado pela proteção de rede não é caso de tentar de novo com navegador:
    // a recusa é a mesma nos dois caminhos, e é proposital.
    return falha(url, 'http', 'HTTP_BLOCKED', /timeout|abort/i.test(mensagem) ? 'o site não respondeu a tempo' : 'não foi possível acessar o endereço', comecou)
  }

  const primeira = extrair(pagina, 'http', comecou, null)
  if (primeira.ok || modo === 'http') return primeira

  // O que veio não serve. Vale um navegador?
  const veredito = checkContentQuality(pagina.html, primeira.text, { status: pagina.status })
  if (!veredito.retryWithBrowser) return primeira

  const comNavegador = await renderizar(`${veredito.code}: ${veredito.reason}`)
  if (comNavegador.ok) return comNavegador

  /**
   * Nenhum dos dois serviu — mas o HTML do HTTP continua valendo.
   *
   * Ele é o que a descoberta usa para achar links, e jogá-lo fora porque a renderização
   * falhou faria uma página de índice curta deixar de descobrir qualquer coisa. Fica o
   * corpo do HTTP, com o diagnóstico mais acionável dos dois: login, robô e bloqueio
   * dizem o que fazer; "precisa de navegador" só diz onde parou.
   */
  const acionavel: ReadErrorCode[] = ['LOGIN_REQUIRED', 'CAPTCHA', 'HTTP_BLOCKED', 'CONSENT_REQUIRED']
  const codigo = primeira.code && acionavel.includes(primeira.code) ? primeira.code : (comNavegador.code ?? primeira.code)
  return {
    ...primeira,
    ...(codigo ? { code: codigo } : {}),
    reason: codigo === primeira.code ? primeira.reason : comNavegador.reason,
    fallbackReason: `${veredito.code}: ${veredito.reason}`,
  }
}
