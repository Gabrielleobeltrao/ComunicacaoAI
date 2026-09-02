import { safeFetch } from '../net/safeHttp.js'
import { applyMapping, redactSample } from './mapping.js'
import type { MappedResult } from './mapping.js'
import type { MonitoringSource } from './types.js'

// LER a fonte — uma vez, e sem inventar mecanismo.
//
// Quem faz a requisição é `safeFetch`, que já resolve o host, recusa endereço privado e
// de metadados, **revalida cada redirect** e limita tempo e tamanho. Escrever um cliente
// HTTP aqui seria um segundo lugar decidindo o que é seguro alcançar — e o dia em que
// divergissem, um estaria buscando o que o outro recusa.
//
// A ordem das estratégias de página é a que o plano pede e a que custa menos primeiro:
// JSON → JSON-LD → seletor DOM. Browser e visão são outra história, com outro custo e
// outro isolamento; eles não entram por aqui.

export type CollectErrorKind = 'blocked' | 'timeout' | 'http' | 'parse' | 'mapping' | 'not_supported' | 'empty'

export interface CollectResult {
  ok: boolean
  /** O que a fonte devolveu, já mapeado. Vazio quando falhou. */
  rows: Record<string, unknown>[]
  /** A amostra REDIGIDA do bruto — para a tela conferir o mapeamento sem ver segredo. */
  sample: unknown
  /** Qual estratégia respondeu. A tela mostra isso: "li o JSON" é diferente de "li o HTML". */
  strategy: 'json' | 'jsonld' | 'dom' | 'none'
  missing: string[]
  mappingVersion: number | null
  latencyMs: number
  status: number | null
  error?: { kind: CollectErrorKind; message: string }
}

const falha = (kind: CollectErrorKind, message: string, latencyMs: number, status: number | null = null): CollectResult => ({
  ok: false,
  rows: [],
  sample: null,
  strategy: 'none',
  missing: [],
  mappingVersion: null,
  latencyMs,
  status,
  error: { kind, message },
})

/**
 * O JSON-LD embutido na página.
 *
 * Vem antes do seletor de DOM porque é dado ESTRUTURADO que o próprio site publicou —
 * ler `<script type="application/ld+json">` é usar o que o autor da página disse, e não
 * adivinhar pelo desenho dele, que muda quando o designer mexe no layout.
 */
export function extractJsonLd(html: string): unknown[] {
  const achados: unknown[] = []
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim())
      if (Array.isArray(parsed)) achados.push(...parsed)
      else achados.push(parsed)
    } catch {
      // Um bloco quebrado não invalida os outros: sites erram isso o tempo todo.
    }
    if (achados.length >= 10) break
  }
  return achados
}

/**
 * O texto de um seletor CSS simples — sem montar um DOM inteiro.
 *
 * Suporta `#id`, `.classe`, `tag` e `[atributo=valor]`, que é o que cobre a maioria dos
 * casos de "o preço está neste elemento". Quando não bastar, a resposta é o browser
 * renderizado, e não um parser de HTML caseiro cada vez maior aqui dentro.
 */
export function extractBySelector(html: string, selector: string): string | null {
  const alvo = String(selector).trim().slice(0, 120)
  if (!alvo) return null

  const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let padrao: RegExp | null = null
  if (alvo.startsWith('#')) padrao = new RegExp(`<([a-z0-9]+)[^>]*\\bid=["']${escapar(alvo.slice(1))}["'][^>]*>([\\s\\S]*?)</\\1>`, 'i')
  else if (alvo.startsWith('.')) padrao = new RegExp(`<([a-z0-9]+)[^>]*\\bclass=["'][^"']*\\b${escapar(alvo.slice(1))}\\b[^"']*["'][^>]*>([\\s\\S]*?)</\\1>`, 'i')
  else if (/^\[[\w-]+=.+\]$/.test(alvo)) {
    const [, atributo, valor] = /^\[([\w-]+)=["']?([^\]"']+)["']?\]$/.exec(alvo) ?? []
    if (atributo) padrao = new RegExp(`<([a-z0-9]+)[^>]*\\b${escapar(atributo)}=["']${escapar(valor ?? '')}["'][^>]*>([\\s\\S]*?)</\\1>`, 'i')
  } else if (/^[a-z][a-z0-9]*$/i.test(alvo)) padrao = new RegExp(`<(${escapar(alvo)})[^>]*>([\\s\\S]*?)</\\1>`, 'i')

  if (!padrao) return null
  const m = padrao.exec(html)
  if (!m) return null
  // Tira as etiquetas de dentro e normaliza o espaço: o que interessa é o texto.
  return m[2]
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000)
}

const ehJson = (contentType: string, corpo: string) =>
  /json/i.test(contentType) || (corpo.trim().startsWith('{') && corpo.trim().endsWith('}')) || (corpo.trim().startsWith('[') && corpo.trim().endsWith(']'))

export interface CollectOptions {
  /** Cabeçalhos já resolvidos pela CONEXÃO. Nunca vêm do documento da fonte. */
  headers?: Record<string, string>
  /** Injetável no teste: o mesmo contrato de `safeFetch`. */
  fetcher?: typeof safeFetch
}

/**
 * Uma leitura da fonte, do jeito que ela declarou ser.
 *
 * Nunca lança: erro vira dado, porque quem chama precisa gravar telemetria mesmo quando
 * deu errado — e uma exceção subindo daqui apagaria justamente a informação de que a
 * fonte está falhando.
 */
export async function collectOnce(source: Pick<MonitoringSource, 'kind' | 'config' | 'mapping' | 'retry'>, opts: CollectOptions = {}): Promise<CollectResult> {
  const comecou = Date.now()
  const buscar = opts.fetcher ?? safeFetch
  const cfg = source.config

  if (source.kind !== 'api_polling' && source.kind !== 'rss' && source.kind !== 'http_page') {
    // Os outros tipos são EMPURRADOS ou pertencem a outro subsistema. Fingir uma leitura
    // aqui seria a Central duplicando o que o App e o barramento já fazem.
    return falha('not_supported', 'este tipo de fonte não é lido por polling', Date.now() - comecou)
  }
  if (!cfg.url) return falha('not_supported', 'esta fonte não tem endereço', Date.now() - comecou)

  let resposta
  try {
    const url = new URL(cfg.url)
    for (const q of cfg.query ?? []) url.searchParams.set(String(q.key), String(q.value))
    resposta = await buscar(url.toString(), {
      method: cfg.method === 'POST' ? 'POST' : 'GET',
      ...(opts.headers ? { headers: opts.headers } : {}),
      ...(cfg.body ? { body: cfg.body } : {}),
      timeoutMs: source.retry.timeoutMs,
      // Página de erro tem conteúdo próprio, que muda sozinho: sem isto, uma
      // instabilidade do servidor viraria "o site mudou".
      requireOk: true,
    })
  } catch (erro) {
    const mensagem = String((erro as Error).message ?? erro)
    // Bloqueio de SSRF e tempo esgotado são coisas diferentes para quem lê o painel: uma
    // é configuração errada, a outra é o outro lado devagar.
    /**
     * Bloqueio e lentidão são coisas diferentes para quem lê o painel: uma é configuração
     * errada, a outra é o outro lado devagar. A peneira cita as mensagens que o guarda
     * de rede realmente produz — adivinhar por palavra genérica classificaria errado.
     */
    const kind: CollectErrorKind = /timeout|abort|abortada/i.test(mensagem)
      ? 'timeout'
      : /rede interna|privad|bloque|metadata|não é permitid|nao e permitid|allowlist|not allowed|resolv/i.test(mensagem)
        ? 'blocked'
        : 'http'
    return falha(kind, mensagem.slice(0, 200), Date.now() - comecou)
  }

  const latencyMs = Date.now() - comecou
  const corpo = resposta.body ?? ''

  // --- a ordem das estratégias: o que custa menos, primeiro --------------------------------
  let bruto: unknown = null
  let strategy: CollectResult['strategy'] = 'none'

  if (ehJson(resposta.contentType ?? '', corpo)) {
    try {
      bruto = JSON.parse(corpo)
      strategy = 'json'
    } catch {
      return falha('parse', 'a resposta parecia JSON e não é', latencyMs, resposta.status)
    }
  } else {
    const ld = extractJsonLd(corpo)
    if (ld.length) {
      bruto = ld.length === 1 ? ld[0] : ld
      strategy = 'jsonld'
    } else if (cfg.selector) {
      const texto = extractBySelector(corpo, cfg.selector)
      if (texto === null) return falha('empty', `o seletor "${cfg.selector}" não encontrou nada na página`, latencyMs, resposta.status)
      bruto = { texto }
      strategy = 'dom'
    } else {
      return falha('not_supported', 'a página não devolveu JSON nem JSON-LD, e nenhum seletor foi definido', latencyMs, resposta.status)
    }
  }

  let mapeado: MappedResult
  try {
    mapeado = applyMapping(bruto, source.mapping)
  } catch (erro) {
    return falha('mapping', String((erro as Error).message).slice(0, 200), latencyMs, resposta.status)
  }

  return {
    ok: true,
    rows: mapeado.rows,
    // A amostra vai REDIGIDA: ela existe para conferir o mapeamento, não para expor o
    // corpo inteiro numa tela que alguém fotografa e cola num chamado.
    sample: redactSample(bruto),
    strategy,
    missing: mapeado.missing,
    mappingVersion: mapeado.mappingVersion,
    latencyMs,
    status: resposta.status,
  }
}
