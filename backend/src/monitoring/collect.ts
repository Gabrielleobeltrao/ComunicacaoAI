import { safeFetch } from '../net/safeHttp.js'
import { parseFeed, pareceFeed } from './feed.js'
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
  strategy: 'json' | 'jsonld' | 'dom' | 'feed' | 'none'
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

/**
 * Uma ação de App como fonte — pelo MESMO caminho de permissão que o modelo usaria.
 *
 * `resolveGrant` resolve o App, confere que a instalação é desta conta, checa status e
 * compatibilidade e decifra a credencial. Um segundo caminho aqui seria um segundo lugar
 * decidindo permissão.
 */
async function coletarDeApp(source: FonteColetavel, comecou: number, opts: CollectOptions): Promise<CollectResult> {
  const cfg = source.config
  if (!cfg.appKey || !cfg.actionKey || !cfg.installationId) {
    return falha('not_supported', 'esta fonte não diz qual App e qual ação ela consulta', Date.now() - comecou)
  }
  if (!opts.ownerId) return falha('not_supported', 'leitura de App exige a conta', Date.now() - comecou)

  try {
    const { resolveGrant } = await import('../apps/grants.js')
    const ferramentas = await resolveGrant(opts.ownerId, {
      appKey: cfg.appKey,
      installationId: cfg.installationId,
      actionKeys: [cfg.actionKey],
      // Consulta é LEITURA: nenhuma ação de escrita é autorizada por este caminho.
      autonomousWriteActionKeys: [],
      resourceConfig: {},
    })
    const normal = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const alvo = ferramentas.find((f) => normal(f.name) === normal(cfg.actionKey!) || normal(f.name).endsWith(`__${normal(cfg.actionKey!)}`))
    if (!alvo) return falha('blocked', 'a conexão deste App precisa ser revista em Apps', Date.now() - comecou)

    const saida = await alvo.run({})
    const latencyMs = Date.now() - comecou
    if (!saida.ok) return falha('http', 'o App recusou a consulta', latencyMs)

    let corpo: unknown
    try {
      corpo = JSON.parse(saida.result)
    } catch {
      corpo = { texto: saida.result }
    }
    const mapeado = applyMapping(corpo, source.mapping)
    return { ok: true, rows: mapeado.rows, sample: redactSample(corpo), strategy: 'json', missing: mapeado.missing, mappingVersion: mapeado.mappingVersion, latencyMs, status: null }
  } catch (erro) {
    return falha('http', String((erro as Error).message).slice(0, 200), Date.now() - comecou)
  }
}

/**
 * Um dataset como fonte — o que já está guardado, lido pelo adapter de sempre.
 *
 * Serve para observar um conjunto que outro caminho alimenta: o monitor de dataset já faz
 * isso na gravação, e esta fonte cobre o outro caso — olhar periodicamente o estado atual.
 */
async function coletarDeDataset(source: FonteColetavel, comecou: number, opts: CollectOptions): Promise<CollectResult> {
  const cfg = source.config
  if (!cfg.dataStoreId || !cfg.datasetKey) return falha('not_supported', 'esta fonte não diz qual conjunto ela lê', Date.now() - comecou)
  if (!opts.ownerId) return falha('not_supported', 'leitura de dataset exige a conta', Date.now() - comecou)

  try {
    const { ObjectId } = await import('mongodb')
    const { runQuery } = await import('../databases/adapters.js')
    const r = await runQuery({ accountId: opts.ownerId, dataStoreId: new ObjectId(cfg.dataStoreId), datasetKey: cfg.datasetKey, query: { limit: 50 } })
    const latencyMs = Date.now() - comecou
    const mapeado = applyMapping({ rows: r.rows }, source.mapping)
    return { ok: true, rows: mapeado.rows, sample: redactSample({ rows: r.rows.slice(0, 3) }), strategy: 'json', missing: mapeado.missing, mappingVersion: mapeado.mappingVersion, latencyMs, status: null }
  } catch (erro) {
    return falha('http', String((erro as Error).message).slice(0, 200), Date.now() - comecou)
  }
}

/**
 * Uma página buscada pelo WORKER isolado — nunca por este processo.
 *
 * O tipo `browser` existe para a página que precisa de mais do que um GET. Quem busca é o
 * worker, que roda fora daqui e revalida cada salto e cada subrequisição; o que este
 * arquivo faz é mapear o que voltou, com a mesma cadeia de estratégias das outras páginas.
 */
async function coletarDeBrowser(source: FonteColetavel, comecou: number): Promise<CollectResult> {
  const cfg = source.config
  if (!cfg.url) return falha('not_supported', 'esta fonte não tem endereço', Date.now() - comecou)

  const { browserWorker } = await import('./browserProvider.js')
  const worker = browserWorker()

  /**
   * Os degraus, do mais barato ao mais caro.
   *
   * A busca simples primeiro: se a página já entrega JSON, JSON-LD ou o texto do seletor,
   * subir um navegador seria pagar segundos por nada. Só quando ela NÃO entrega — e quando
   * o motor existe — é que se paga o caro.
   */
  const estrategias = (cfg.strategy as string[] | undefined) ?? ['json', 'jsonld', 'dom', 'browser']
  const podeRenderizar = estrategias.includes('browser')

  let r = await worker.fetchPage({ url: cfg.url, limits: { timeoutMs: source.retry.timeoutMs } })
  let precisouRenderizar = false

  /**
   * A escalada olha o RESULTADO, não o HTML.
   *
   * A primeira versão perguntava "o seletor achou alguma coisa?" — e achava: uma página que
   * mostra "carregando" até o JavaScript rodar tem o elemento lá, com o texto errado. O
   * degrau barato dizia sucesso e a fonte lia `null` para sempre.
   *
   * Perguntar "o que saiu daqui serve?" é a pergunta certa, e ela só pode ser feita depois
   * de mapear.
   */
  if (r.ok && podeRenderizar && !rendeuValor(r, source)) {
    const saude = await worker.health()
    if (saude.capabilities.render) {
      precisouRenderizar = true
      r = await worker.fetchPage({ url: cfg.url, render: true, limits: { timeoutMs: source.retry.timeoutMs } })
    }
  }

  const latencyMs = Date.now() - comecou

  if (!r.ok) {
    const kind: CollectErrorKind = r.error?.kind === 'blocked' ? 'blocked' : r.error?.kind === 'timeout' ? 'timeout' : r.error?.kind === 'unavailable' ? 'not_supported' : 'http'
    return falha(kind, r.error?.message ?? 'a busca falhou', latencyMs)
  }

  const corpo = r.body ?? ''
  let bruto: unknown = null
  let strategy: CollectResult['strategy'] = 'none'

  // A mesma ordem de sempre: o que custa menos, primeiro.
  if (ehJson(r.contentType ?? '', corpo)) {
    try {
      bruto = JSON.parse(corpo)
      strategy = 'json'
    } catch {
      return falha('parse', 'a resposta parecia JSON e não é', latencyMs, r.status ?? null)
    }
  } else {
    const ld = extractJsonLd(corpo)
    if (ld.length) {
      bruto = ld.length === 1 ? ld[0] : ld
      strategy = 'jsonld'
    } else if (cfg.selector) {
      const texto = extractBySelector(corpo, cfg.selector)
      if (texto === null) return falha('empty', `o seletor "${cfg.selector}" não encontrou nada na página`, latencyMs, r.status ?? null)
      bruto = { texto }
      strategy = 'dom'
    } else {
      /**
       * Sem seletor e sem dado estruturado, o próximo passo seria a página RENDERIZADA — e
       * o worker diz que não renderiza. Recusar com essa razão é diferente de recusar por
       * "não achei": quem lê precisa saber que falta um motor, e não um seletor.
       */
      return falha(
        'not_supported',
        r.rendered
          ? // Dizer que ela JÁ foi renderizada muda o que a pessoa faz em seguida: sem
            // isso, ela vai procurar um motor que já rodou em vez de olhar a página.
            `${precisouRenderizar ? 'mesmo renderizada, a ' : 'a '}página não trouxe dado estruturado, e nenhum seletor foi definido`
          : precisouRenderizar
            ? 'a página precisou de renderização e ainda assim não trouxe dado utilizável'
            : 'esta página precisa de renderização, e o worker configurado não renderiza',
        latencyMs,
        r.status ?? null,
      )
    }
  }

  let mapeado
  try {
    mapeado = applyMapping(bruto, source.mapping)
  } catch (erro) {
    return falha('mapping', String((erro as Error).message).slice(0, 200), latencyMs, r.status ?? null)
  }

  return {
    ok: true,
    rows: mapeado.rows,
    sample: redactSample(bruto),
    strategy,
    missing: mapeado.missing,
    mappingVersion: mapeado.mappingVersion,
    latencyMs,
    status: r.status ?? null,
  }
}

/**
 * O que veio do degrau barato já produz VALOR?
 *
 * Não "o seletor achou algo", e sim "o mapeamento produziu alguma coisa que não é nula".
 * A diferença é exatamente a página que mostra "carregando" até o JavaScript rodar: o
 * elemento existe, o texto está errado, e a pergunta ingênua responde sim.
 */
function rendeuValor(r: { body?: string; contentType?: string }, source: FonteColetavel): boolean {
  const corpo = r.body ?? ''
  let bruto: unknown = null
  if (ehJson(r.contentType ?? '', corpo)) {
    try {
      bruto = JSON.parse(corpo)
    } catch {
      return false
    }
  } else {
    const ld = extractJsonLd(corpo)
    if (ld.length) bruto = ld.length === 1 ? ld[0] : ld
    else if (source.config.selector) {
      const texto = extractBySelector(corpo, source.config.selector)
      if (texto === null) return false
      bruto = { texto }
    } else return false
  }

  try {
    const { rows } = applyMapping(bruto, source.mapping)
    return rows.some((linha) => Object.values(linha).some((v) => v !== null && v !== undefined && v !== ''))
  } catch {
    return false
  }
}

export interface CollectOptions {
  /** Cabeçalhos já resolvidos pela CONEXÃO. Nunca vêm do documento da fonte. */
  headers?: Record<string, string>
  /** Injetável no teste: o mesmo contrato de `safeFetch`. */
  fetcher?: typeof safeFetch
  /** A conta — exigida pelos tipos que passam por outro subsistema com permissão. */
  ownerId?: string
}

type FonteColetavel = Pick<MonitoringSource, 'kind' | 'config' | 'mapping' | 'retry'>

/**
 * Uma leitura da fonte, do jeito que ela declarou ser.
 *
 * Nunca lança: erro vira dado, porque quem chama precisa gravar telemetria mesmo quando
 * deu errado — e uma exceção subindo daqui apagaria justamente a informação de que a
 * fonte está falhando.
 */
export async function collectOnce(source: FonteColetavel, opts: CollectOptions = {}): Promise<CollectResult> {
  const comecou = Date.now()
  const buscar = opts.fetcher ?? safeFetch
  const cfg = source.config

  /**
   * Os tipos que a Central PUXA por outro subsistema — e não por HTTP.
   *
   * `app_action` passa pelo executor oficial de Apps (grant, instalação, credencial
   * cifrada); `dataset` lê o que já está guardado. Nos dois casos, quem sabe fazer é quem
   * já fazia: a Central só pede e mapeia o que voltou.
   */
  if (source.kind === 'app_action') return coletarDeApp(source, comecou, opts)
  if (source.kind === 'dataset') return coletarDeDataset(source, comecou, opts)
  if (source.kind === 'browser') return coletarDeBrowser(source, comecou)

  if (source.kind !== 'api_polling' && source.kind !== 'rss' && source.kind !== 'http_page') {
    // Os outros tipos são EMPURRADOS. Fingir uma leitura aqui seria a Central duplicando o
    // que o barramento e o App já fazem.
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

  /**
   * FEED antes de tudo, quando a fonte é de feed.
   *
   * Um RSS caía no caminho de página e exigia seletor — a pessoa configurava um feed e a
   * Central pedia CSS. O parser é fechado (sem DTD, sem entidade externa: não há XXE para
   * explorar) e devolve os mesmos campos nos dois formatos.
   */
  if (source.kind === 'rss' || pareceFeed(resposta.contentType ?? '', corpo)) {
    const itens = parseFeed(corpo)
    if (itens.length === 0) return falha('empty', 'não encontrei itens neste feed', latencyMs, resposta.status)
    bruto = { items: itens }
    strategy = 'feed'
  } else if (ehJson(resposta.contentType ?? '', corpo)) {
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
