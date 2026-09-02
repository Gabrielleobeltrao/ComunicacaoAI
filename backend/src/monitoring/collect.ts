import { safeFetch } from '../net/safeHttp.js'
import { parseFeed, pareceFeed } from './feed.js'
import { applyMapping, readPath, redactSample } from './mapping.js'
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
  strategy: 'json' | 'jsonld' | 'dom' | 'feed' | 'vision' | 'none'
  missing: string[]
  mappingVersion: number | null
  latencyMs: number
  status: number | null
  error?: { kind: CollectErrorKind; message: string }
  /** Quantas páginas foram buscadas, e por que parou. A tela mostra isso. */
  pages?: { fetched: number; stoppedBecause: 'sem-proxima' | 'max-paginas' | 'bytes' | 'linhas' | 'tempo'; cursor: string | null }
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
  const podeVer = estrategias.includes('vision')
  let leituraDeVisao: { rows: Record<string, unknown>[]; recusas: string[] } | null = null

  if (r.ok && podeRenderizar && !rendeuValor(r, source)) {
    const saude = await worker.health()
    if (saude.capabilities.render) {
      precisouRenderizar = true
      r = await worker.fetchPage({
        url: cfg.url,
        render: true,
        // O retrato só é pedido quando a visão é o próximo degrau: tirar sempre custaria
        // bytes e tokens em toda coleta que nunca vai olhar a imagem.
        screenshot: podeVer && saude.capabilities.screenshot,
        ...(cfg.selector ? { selector: cfg.selector } : {}),
        limits: { timeoutMs: source.retry.timeoutMs },
      })

      /**
       * A VISÃO é o último degrau, e ela é adivinhação com boa aparência.
       *
       * Só acontece quando tudo antes falhou, quando alguém a escolheu explicitamente na
       * estratégia, e quando existe provedor. E o que sai dela não vira dado sozinho: cada
       * leitura passa pelo portão de confiança e evidência.
       */
      if (podeVer && !rendeuValor(r, source) && r.screenshot?.base64) {
        leituraDeVisao = await lerComVisao(r.screenshot.base64, source)
      }
    }
  }

  if (leituraDeVisao) {
    const latencyMs = Date.now() - comecou
    if (leituraDeVisao.rows.length === 0) {
      // Recusar dizendo o motivo é o ponto: "a visão leu, mas não com confiança suficiente"
      // manda a pessoa olhar a página; "não achei" a manda procurar um seletor.
      return falha('empty', leituraDeVisao.recusas[0] ?? 'a leitura por imagem não passou na conferência', latencyMs, r.status ?? null)
    }
    return {
      ok: true,
      rows: leituraDeVisao.rows,
      // A amostra da visão é o TEXTO lido, não a imagem: uma imagem na amostra viraria um
      // print do site inteiro na tela de quem configurou.
      sample: redactSample({ leituraPorImagem: leituraDeVisao.rows }),
      strategy: 'vision',
      missing: [],
      mappingVersion: source.mapping.version,
      latencyMs,
      status: r.status ?? null,
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

/**
 * A leitura por imagem, com cada campo passando pelo portão.
 *
 * O que volta são só as leituras ACEITAS. Uma recusa não vira campo nulo na linha: ela
 * fica de fora, e o motivo sobe — porque uma linha com metade dos campos lidos por
 * adivinhação é pior do que nenhuma.
 */
async function lerComVisao(imagem: string, source: FonteColetavel): Promise<{ rows: Record<string, unknown>[]; recusas: string[] }> {
  const { visionProvider, gateVisionReading } = await import('./vision.js')
  const provedor = visionProvider()
  const saude = await provedor.health()
  if (!saude.ok) return { rows: [], recusas: ['não há provedor de visão configurado'] }

  const campos = source.mapping.fields.map((f) => ({ name: f.to }))
  const leituras = await provedor.read({ imageRef: imagem, fields: campos })
  if (leituras.length === 0) return { rows: [], recusas: ['a leitura por imagem não devolveu nada'] }

  const linha: Record<string, unknown> = {}
  const recusas: string[] = []

  for (const regra of source.mapping.fields) {
    const leitura = leituras.find((l) => l.field === regra.to)
    if (!leitura) {
      recusas.push(`"${regra.to}" não foi lido na imagem`)
      continue
    }
    const decisao = gateVisionReading(leitura, {
      // Um campo que o mapeamento marcou obrigatório é o que decide: ele é crítico, e o
      // portão exige confiança alta e confirmação para ele.
      critical: regra.required === true,
      ...(regra.transforms ? { transforms: regra.transforms } : {}),
    })
    if (decisao.accepted) linha[regra.to] = decisao.value
    else recusas.push(`"${regra.to}": ${decisao.explanation}`)
  }

  return { rows: Object.keys(linha).length ? [linha] : [], recusas }
}

export interface CollectOptions {
  /** Cabeçalhos já resolvidos pela CONEXÃO. Nunca vêm do documento da fonte. */
  headers?: Record<string, string>
  /** Injetável no teste: o mesmo contrato de `safeFetch`. */
  fetcher?: typeof safeFetch
  /** A conta — exigida pelos tipos que passam por outro subsistema com permissão. */
  ownerId?: string
  /**
   * O cursor guardado da última coleta — usado só quando a fonte pediu retomada.
   *
   * Ele vem de fora porque quem guarda estado é o serviço, não o coletor: uma função que
   * lê e escreve o documento da fonte no meio da coleta seria dois donos do mesmo campo.
   */
  cursor?: string | null
}

type FonteColetavel = Pick<MonitoringSource, 'kind' | 'config' | 'mapping' | 'retry'>

/**
 * Uma leitura da fonte, do jeito que ela declarou ser.
 *
 * Nunca lança: erro vira dado, porque quem chama precisa gravar telemetria mesmo quando
 * deu errado — e uma exceção subindo daqui apagaria justamente a informação de que a
 * fonte está falhando.
 */
/**
 * Os TETOS da paginação — o que impede "buscar o resto" de virar "buscar para sempre".
 *
 * Uma API que devolve cursor não-nulo por engano transforma uma coleta em um laço infinito
 * contra o servidor de outra pessoa. `maxPages` sozinho não basta: vinte páginas de dez
 * megabytes ainda são duzentos megabytes na memória do worker.
 */
export const TETOS_DE_PAGINA = {
  maxBytes: 4 * 1024 * 1024,
  maxRows: 1_000,
  /** O relógio de parede da coleta inteira, independente do tempo de cada requisição. */
  maxMs: 60_000,
}

/** O cursor da resposta, lido pelo mesmo caminho seguro do mapeamento. */
function cursorDa(bruto: unknown, caminho: string): string | null {
  const v = readPath(bruto, caminho)
  if (v === null || v === undefined || v === '' || v === false) return null
  const s = String(v)
  return s && s !== 'null' && s !== 'undefined' ? s.slice(0, 500) : null
}

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

  /**
   * A PAGINAÇÃO — buscar o resto, com teto em tudo.
   *
   * Sem ela, uma API paginada entregava a primeira página e a série ficava pela metade,
   * sem erro nenhum: o número existia, estava certo, e era de vinte por cento dos dados.
   *
   * Só vale para `api_polling` com JSON: um feed já traz os itens que o feed tem, e uma
   * página HTML paginada é navegação, não API. E a primeira requisição é sempre a mesma —
   * quem não pagina passa por aqui sem custo.
   */
  const endereco = cfg.url
  const paginacao = source.kind === 'api_polling' ? (cfg.pagination ?? { kind: 'none' }) : { kind: 'none' as const }
  const paginado = paginacao.kind !== 'none'
  const maxPaginas = Math.min(20, Math.max(1, Number(paginacao.maxPages ?? 5)))
  const urlDaPagina = (cursor: string | null, numero: number): string => {
    const url = new URL(endereco)
    for (const q of cfg.query ?? []) url.searchParams.set(String(q.key), String(q.value))
    if (paginacao.kind === 'page' && numero > 1) url.searchParams.set(paginacao.pageParam ?? 'page', String(numero))
    if (paginacao.kind === 'cursor' && cursor) url.searchParams.set('cursor', cursor)
    return url.toString()
  }

  let resposta
  try {
    resposta = await buscar(urlDaPagina(paginacao.kind === 'cursor' && paginacao.resume === true ? (opts.cursor ?? null) : null, 1), {
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

  /**
   * O SCRIPT, quando existe — e só depois de o dado estar sanitizado.
   *
   * `bruto` aqui já é JSON analisado, JSON-LD ou o TEXTO de um seletor. HTML cru nunca
   * chega: um script recebendo a página inteira teria dentro dela o script do site, e o
   * ponto de rodar isolado é que o código de terceiro não escolhe o que roda.
   */
  const comScript = await aplicarScript(bruto, source)
  if (!comScript.ok) return falha('mapping', comScript.message, latencyMs, resposta.status)

  let mapeado: MappedResult
  try {
    mapeado = applyMapping(comScript.data, source.mapping)
  } catch (erro) {
    return falha('mapping', String((erro as Error).message).slice(0, 200), latencyMs, resposta.status)
  }

  /**
   * As PÁGINAS SEGUINTES — e a razão da parada, que é o que a tela precisa dizer.
   *
   * "Buscou 5 de no máximo 5" é uma notícia diferente de "buscou 3 e acabou": a primeira
   * quase sempre quer dizer que o teto cortou o dado no meio.
   */
  let paginas: CollectResult['pages']
  if (paginado && (strategy === 'json' || strategy === 'jsonld')) {
    let bytes = corpo.length
    let buscadas = 1
    let cursor = paginacao.kind === 'cursor' ? cursorDa(bruto, paginacao.cursorPath ?? '') : null
    let motivo: NonNullable<CollectResult['pages']>['stoppedBecause'] = 'sem-proxima'

    while (true) {
      if (buscadas >= maxPaginas) {
        motivo = 'max-paginas'
        break
      }
      if (paginacao.kind === 'cursor' && !cursor) break
      if (bytes >= TETOS_DE_PAGINA.maxBytes) {
        motivo = 'bytes'
        break
      }
      if (mapeado.rows.length >= TETOS_DE_PAGINA.maxRows) {
        motivo = 'linhas'
        break
      }
      if (Date.now() - comecou >= TETOS_DE_PAGINA.maxMs) {
        motivo = 'tempo'
        break
      }

      let seguinte
      try {
        seguinte = await buscar(urlDaPagina(cursor, buscadas + 1), {
          method: cfg.method === 'POST' ? 'POST' : 'GET',
          ...(opts.headers ? { headers: opts.headers } : {}),
          ...(cfg.body ? { body: cfg.body } : {}),
          timeoutMs: source.retry.timeoutMs,
          requireOk: true,
        })
      } catch {
        // Uma página seguinte que falha NÃO derruba o que já veio: a leitura entrega o que
        // conseguiu e diz onde parou. Perder tudo por causa da página 4 seria pior.
        motivo = 'sem-proxima'
        break
      }

      const corpoSeguinte = seguinte.body ?? ''
      bytes += corpoSeguinte.length
      buscadas += 1

      let brutoSeguinte: unknown
      try {
        brutoSeguinte = JSON.parse(corpoSeguinte)
      } catch {
        motivo = 'sem-proxima'
        break
      }

      const comScriptSeguinte = await aplicarScript(brutoSeguinte, source)
      if (!comScriptSeguinte.ok) {
        motivo = 'sem-proxima'
        break
      }
      let linhasSeguintes: MappedResult
      try {
        linhasSeguintes = applyMapping(comScriptSeguinte.data, source.mapping)
      } catch {
        motivo = 'sem-proxima'
        break
      }
      // Página vazia é o fim, mesmo com cursor: uma API que devolve cursor não-nulo por
      // engano viraria laço infinito contra o servidor de outra pessoa.
      if (linhasSeguintes.rows.length === 0) break
      mapeado.rows.push(...linhasSeguintes.rows.slice(0, TETOS_DE_PAGINA.maxRows - mapeado.rows.length))

      if (paginacao.kind === 'cursor') {
        const proximo = cursorDa(brutoSeguinte, paginacao.cursorPath ?? '')
        // O mesmo cursor de novo é a API dizendo "não sei avançar". Seguir seria reler.
        if (proximo === cursor) break
        cursor = proximo
      }
    }
    paginas = { fetched: buscadas, stoppedBecause: motivo, cursor: paginacao.kind === 'cursor' && paginacao.resume === true ? cursor : null }
  }

  return {
    ok: true,
    rows: mapeado.rows,
    ...(paginas ? { pages: paginas } : {}),
    // A amostra vai REDIGIDA: ela existe para conferir o mapeamento, não para expor o
    // corpo inteiro numa tela que alguém fotografa e cola num chamado.
    // A amostra é do BRUTO, e não do que o script produziu: quem confere o mapeamento
    // precisa ver o que chegou, para entender o que o script fez com aquilo.
    sample: redactSample(bruto),
    strategy,
    missing: mapeado.missing,
    mappingVersion: mapeado.mappingVersion,
    latencyMs,
    status: resposta.status,
  }
}

/**
 * Roda o script de extração na SANDBOX — nunca aqui.
 *
 * O runner isolado é o mesmo das ferramentas de código: modelo de permissão do Node
 * negando disco, subprocesso, worker e addon nativo, sem rede, com teto de tempo e de
 * memória. Executar aqui, mesmo "só uma transformaçãozinha", seria rodar código de
 * terceiro no processo que tem o banco e as chaves.
 *
 * Sem sandbox saudável a fonte FALHA, e não segue sem o script: seguir aplicaria o
 * mapeamento a um dado que ainda não foi transformado, e produziria valores errados com
 * cara de certos.
 */
async function aplicarScript(bruto: unknown, source: FonteColetavel): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  const script = source.config.extractScript
  if (!script?.source) return { ok: true, data: bruto }

  const { sandboxProvider } = await import('../extensionRuntime/provider.js')
  const { createHash } = await import('node:crypto')

  // O programa que o runner executa: a função do autor, chamada com o dado sanitizado.
  const programa = `${script.source}

function run(entrada) { return extract(entrada.data) }`
  const saude = await sandboxProvider().health()
  if (!saude.ok) return { ok: false, message: 'esta fonte usa script de extração, e não há runtime isolado disponível' }

  const r = await sandboxProvider().execute({
    runtime: 'javascript',
    artifactRef: `monitoring-script@${script.version}`,
    source: programa,
    sha256: createHash('sha256').update(programa).digest('hex'),
    // Só o dado. Nenhuma credencial, nenhum id de conta, nenhuma URL.
    input: { data: bruto },
    limits: { cpuMs: 2_000, memoryMb: 128, pids: 32, wallMs: Math.min(10_000, source.retry.timeoutMs), outputBytes: 256 * 1024 },
    capabilityHandles: [],
    correlationId: `monitoring:script:${script.version}`,
  })

  if (!r.ok) return { ok: false, message: `o script de extração falhou: ${r.error?.message ?? 'erro'}` }
  if (r.output === null || r.output === undefined) return { ok: false, message: 'o script de extração não devolveu nada' }
  return { ok: true, data: r.output }
}
