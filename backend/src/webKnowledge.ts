// Sites como conhecimento VIVO de um agente.
//
// Um endereço vinculado a um agente já podia entrar na conversa de duas formas: pela
// ferramenta `verificar_fonte`, quando o modelo decide olhar, e pela injeção de contexto
// (`always` / `on_change`), quando o dono quer o conteúdo em toda chamada. As duas são
// efêmeras: o texto entra naquele prompt e some.
//
// Este módulo faz a terceira, que é diferente em espécie: o conteúdo do site vira
// DOCUMENTO na base do agente. Ele passa a ser recuperado como qualquer outro
// conhecimento, com título, procedência e busca — e continua lá quando o site sair do ar.
//
// Nada aqui é novo por baixo: a busca é o `safeFetch` (que recusa endereço privado), o
// feed é o `parseRssItems`, o texto e o hash são o `normalizeHttpContent`/`contentHashOf`
// que a detecção de mudança já usava, e a gravação é o mesmo `createDocumentFor` do
// conhecimento curado. O que este arquivo acrescenta é QUANDO ler (a política, pura, em
// `webSourcePolicy`) e O QUE ler (a descoberta, pura, em `webDiscovery`).
//
// Nenhuma LLM é chamada em nenhum ponto deste arquivo.
import { ObjectId } from 'mongodb'
import type { Agent, WatchedSource } from './agents.js'
import { getAgentById } from './agents.js'
import { db } from './db.js'
import { contentHashOf } from './automations/sourceChange.js'
import { looksLikeContent, pageFacts } from './webContent.js'
import { readWebPage } from './adaptiveWebReader.js'
import type { ReadMode, ReadResult } from './adaptiveWebReader.js'
import { rendererAtivo } from './browserRenderer.js'
import { createDocumentFor, reindexDocumentFor, updateDocumentFor } from './knowledge.js'
import type { KnowledgeDocument } from './knowledge.js'
import { planDiscovery, urlsFromFeed, urlsFromListing, urlsFromSitemap } from './webDiscovery.js'
import { normalizeWebSource, nextScheduledAfter, resolveDiscovery, shouldRefresh } from './webSourcePolicy.js'
import type { RefreshReason, WebSourceState } from './webSourcePolicy.js'

const agents = db.collection<Agent>('agents')
const documentos = db.collection<KnowledgeDocument>('knowledge_documents')

/** A marca que liga um documento ao endereço que o produziu. Estável por URL. */
export const webSourceRef = (sourceId: string, url: string): string => `web:${sourceId}:${contentHashOf(url).slice(0, 16)}`

export interface RefreshOutcome {
  sourceId: string
  name: string
  refreshed: boolean
  reason: string
  discovered: number
  created: number
  updated: number
  unchanged: number
  /** Páginas de índice descartadas: elas descobrem endereços, não viram conhecimento. */
  skippedIndexPages?: number
  /** Endereços que o dono apagou e mandou ignorar. */
  ignored?: number
  /** Documentos que não tinham mudado, mas estavam sem trechos — e voltaram para a busca. */
  reindexed?: number
  /** Por onde os endereços foram descobertos nesta rodada. */
  via?: string
  error?: string
  durationMs: number
  /**
   * O caminho que cada página tomou até virar (ou não virar) conhecimento.
   *
   * Sem isto, "0 novos" é indistinguível de "0 lidos": o painel mostrava o resultado sem
   * mostrar a leitura, e um site que só monta com JavaScript ficava com a mesma cara de
   * um site sem novidade.
   */
  reads?: WebReadTrace[]
}

export interface WebReadTrace {
  url: string
  method: 'http' | 'browser'
  ok: boolean
  /** O que o servidor disse que estava mandando. */
  contentType?: string
  /** O que foi TENTADO, em ordem — e por que parou onde parou. */
  strategies?: { strategy: string; ok: boolean; code?: string; reason: string; durationMs: number }[]
  /** Quantos endereços a página oferece. É deles que sai a descoberta. */
  links?: number
  /** Quantos segundos o site pediu para esperar, quando pediu. */
  retryAfterSeconds?: number
  /** O motivo COM NOME quando falhou: login, robô, JavaScript, página vazia. */
  code?: string
  reason?: string
  /** Por que o HTTP não bastou, quando o navegador entrou. */
  fallbackReason?: string
  kind?: string
  usefulChars?: number
  durationMs?: number
}

/** Quanto texto de UMA página vira documento. Uma base não é um espelho da internet. */
const MAX_CARACTERES = 20_000

/** Tempo máximo por página. Um site lento não pode segurar a execução de um agente. */
const TIMEOUT_POR_PAGINA_MS = 8_000
/** Tamanho máximo de uma página. Acima disto não é documento, é despejo. */
const MAX_BYTES = 1_500_000
/**
 * Quanto a orquestração espera pela atualização antes de seguir sem ela.
 *
 * A leitura acontece na frente de quem perguntou. Esperar indefinidamente por um site
 * lento seria transformar um problema do site do outro em silêncio no nosso chat — o
 * agente responde com o que já tem, e o rastro diz que a atualização não terminou.
 */
export const WEB_REFRESH_TIMEOUT_MS = 20_000
/** Quantas páginas são lidas ao mesmo tempo. Educação com o servidor do outro. */
const CONCORRENCIA = 3

/**
 * A ÚNICA porta de leitura — a mesma para a descoberta, para a ingestão, para o botão
 * "Atualizar agora" e para a execução do agente.
 *
 * Ela decide o método pelo que a página é: HTTP quando basta, navegador quando o conteúdo
 * só existe depois do JavaScript. E quando não dá para ler, o motivo tem nome.
 */
async function lerPagina(url: string, mode: ReadMode = 'auto', trilha?: WebReadTrace[]): Promise<ReadResult | null> {
  const r = await readWebPage(url, { mode, renderer: rendererAtivo(), timeoutMs: TIMEOUT_POR_PAGINA_MS, maxBytes: MAX_BYTES })
  if (trilha && trilha.length < 30) {
    trilha.push({
      url,
      method: r.readMethod,
      ok: r.ok,
      ...(r.code ? { code: r.code, reason: r.reason } : {}),
      ...(r.fallbackReason ? { fallbackReason: r.fallbackReason } : {}),
      kind: r.kind,
      usefulChars: r.metadata.usefulChars,
      durationMs: r.durationMs,
      contentType: r.contentType,
      strategies: r.strategies,
      links: r.links.length,
      ...(r.retryAfterSeconds !== undefined ? { retryAfterSeconds: r.retryAfterSeconds } : {}),
    })
  }
  // Uma leitura que não serve não vira documento — mas o motivo sobe, para o log e para a
  // tela. `null` só quando não há nem diagnóstico.
  return r
}

/** Executa em lotes: paralelo o bastante para não demorar, comedido o bastante para não pesar. */
async function emLotes<T, R>(itens: T[], tamanho: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = []
  for (let i = 0; i < itens.length; i += tamanho) {
    saida.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))))
  }
  return saida
}

/**
 * Os endereços a ler nesta rodada — por regra, sem modelo.
 *
 * Sempre inclui o próprio endereço cadastrado: mesmo num feed ou num sitemap, a página de
 * origem costuma ter o resumo que dá sentido ao resto.
 */
interface Descoberta {
  /** Os endereços a LER — as páginas de conteúdo. */
  urls: string[]
  /** Como foram descobertos. Vai para o log e para o registro da fonte. */
  via: string
}

/**
 * O QUE ler — e a distinção que evita encher a base de navegação.
 *
 * Uma página de índice serve para DESCOBRIR endereços; ela não é conhecimento. Guardar
 * "Home · Sobre · Contato · Assine" como documento é pagar embedding por menu, e depois
 * recuperar menu quando alguém perguntar algo. Por isso, quando a descoberta encontra
 * páginas de conteúdo, a página de índice fica de fora — e só entra quando não há mais
 * nada, que é o caso de um site de uma página só.
 */
async function descobrir(site: WatchedSource, cfg: ReturnType<typeof normalizeWebSource>, trilha?: WebReadTrace[]): Promise<Descoberta> {
  const teto = cfg.maxArticlesPerRun
  const escolhido = cfg.discoveryMode === 'auto'
    ? await planDiscovery(
        site.url,
        site.kind,
        {
          fetch: async (u: string) => {
            const r = await lerPagina(u, site.readMode ?? 'auto', trilha)
            return r && r.html ? { body: r.html, contentType: 'text/html' } : null
          },
        },
        { crawlArticles: cfg.crawlArticles },
      )
    : { via: resolveDiscovery(cfg, site.kind, site.url), url: site.url }

  if (escolhido.via === 'single_page') return { urls: [site.url], via: 'single_page' }

  const pagina = await lerPagina(escolhido.url, site.readMode ?? 'auto', trilha)
  if (!pagina || !pagina.html) return { urls: [site.url], via: 'single_page' }

  const urls =
    escolhido.via === 'rss'
      ? urlsFromFeed(pagina.html, teto)
      : escolhido.via === 'sitemap'
        ? urlsFromSitemap(pagina.html, teto)
        : urlsFromListing(pagina.html, escolhido.url, { sameDomainOnly: cfg.sameDomainOnly, max: teto })

  // Índice sem conteúdo descoberto: aí a própria página é o que existe para ler.
  return urls.length > 0 ? { urls: urls.slice(0, teto), via: escolhido.via } : { urls: [site.url], via: 'single_page' }
}

/**
 * Lê um endereço e deixa a base do agente igual ao que ele diz AGORA.
 *
 * O hash decide o que é trabalho: uma página que não mudou não vira escrita, não vira
 * reindexação e não gasta embedding. É o mesmo critério que a detecção de mudança das
 * rotinas já usava — aqui ele evita reindexar a internet inteira toda hora.
 */
async function atualizarFonte(ownerId: string, agent: Agent, site: WatchedSource, motivo: RefreshReason, agora: number): Promise<RefreshOutcome> {
  const cfg = normalizeWebSource(site)
  const base: RefreshOutcome = {
    sourceId: site.id,
    name: site.name,
    refreshed: false,
    reason: '',
    discovered: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skippedIndexPages: 0,
    durationMs: 0,
  }

  // O bootstrap é para a fonte que ainda não deu nada. Uma que já produziu documento
  // volta a obedecer ao modo — senão "primeira leitura" viraria "leitura a toda hora".
  if (motivo === 'bootstrap') {
    const jaProduziu = await documentos.countDocuments({
      $and: [{ ownerType: 'agent', ownerId: agent._id }, { 'web.sourceId': site.id }],
    })
    if (jaProduziu > 0) return { ...base, reason: 'a fonte já tem conhecimento' }
  }

  const decisao = shouldRefresh(site, site, motivo, agora)
  if (!decisao.refresh) return { ...base, reason: decisao.reason }

  const comecou = Date.now()
  // COM o conteúdo: é ele que decide se houve mudança. `listDocumentsFor` o exclui da
  // projeção — usá-lo aqui faria toda leitura parecer mudança, reescrevendo e
  // reindexando a base inteira a cada rodada.
  const existentes = await documentos
    .find({ ownerType: 'agent', ownerId: agent._id, sourceRef: { $regex: `^web:${site.id}:` } })
    .toArray()
    .catch(() => [])
  const porRef = new Map(existentes.map((d) => [d.sourceRef!, d]))

  try {
    const trilha: WebReadTrace[] = []
    base.reads = trilha
    const { urls, via } = await descobrir(site, cfg, trilha)
    base.discovered = urls.length
    base.via = via
    let lidas = 0

    // A leitura é em lotes: rápida sem ser atropelo no servidor do outro.
    const problemas: string[] = []
    const paginas = await emLotes(urls.slice(0, cfg.maxArticlesPerRun), CONCORRENCIA, async (url) => {
      const lida = await lerPagina(url, site.readMode ?? 'auto', trilha)
      if (!lida) {
        problemas.push('EXTRACTION_FAILED: não foi possível ler este endereço')
        return null
      }
      if (!lida.ok) {
        // O motivo com NOME: login, robô, JavaScript, página vazia. "Não deu para ler"
        // não diz o que fazer a respeito.
        problemas.push(`${lida.code ?? 'EXTRACTION_FAILED'}: ${lida.reason}`)
        return null
      }
      // O endereço FINAL do redirect é a identidade; o canônico declarado manda sobre ele.
      const fatos = pageFacts(lida.html, lida.url, new Date(agora))
      if (!fatos.text.trim()) {
        // Passou no veredito e ainda assim não sobrou texto. É raro, mas cair aqui em
        // silêncio era o que produzia "nenhuma página pôde ser lida" — uma frase que não
        // diz o que houve nem o que fazer.
        problemas.push('CONTENT_EMPTY: a página foi lida, mas não sobrou texto aproveitável')
        return null
      }
      return { fatos, html: lida.html, lida }
    })

    // Dedupe pelo endereço CANÔNICO: `?utm_source=…`, `#secao` e a barra final descrevem a
    // mesma página, e três documentos iguais custam três embeddings e sujam a resposta.
    const porCanonica = new Map<string, (typeof paginas)[number]>()
    for (const p of paginas) {
      if (!p) continue
      lidas += 1
      if (!porCanonica.has(p.fatos.canonicalUrl)) porCanonica.set(p.fatos.canonicalUrl, p)
    }

    // Quando há mais de uma página, as de ÍNDICE saem: elas serviram para descobrir, e
    // menu com banner não responde pergunta nenhuma.
    const candidatas = [...porCanonica.values()].filter((p): p is NonNullable<typeof p> => Boolean(p))
    const comConteudo = candidatas.length > 1 ? candidatas.filter((p) => looksLikeContent(p.html, p.fatos.text)) : candidatas
    // Se o filtro derrubaria TUDO, ele não se aplica: guardar algo que talvez seja índice
    // é melhor que deixar o agente sem base nenhuma por causa de uma heurística.
    const conteudos = comConteudo.length > 0 ? comConteudo : candidatas
    base.skippedIndexPages = candidatas.length - conteudos.length

    // O que o dono apagou e mandou ignorar não volta pelo scan seguinte.
    const ignorados = new Set(site.ignoredUrls ?? [])
    for (const { fatos, lida } of conteudos) {
      if (ignorados.has(fatos.canonicalUrl)) {
        base.ignored = (base.ignored ?? 0) + 1
        continue
      }
      const ref = webSourceRef(site.id, fatos.canonicalUrl)
      const titulo = (fatos.title ?? site.name).slice(0, 200)
      // A procedência fica NO texto: quem lê a resposta precisa poder voltar à origem.
      // Tabela vira LINHA DE TEXTO com o cabeçalho junto de cada valor. Uma tabela
      // guardada como grade não é recuperável por busca: quem pergunta "quanto deu no dia
      // 02" precisa que "02" e "121" estejam na mesma linha, com o nome da coluna.
      const estruturado = lida.structuredData
      const tabelas = (estruturado?.tables ?? [])
        .slice(0, 5)
        .map((t) => {
          const linhas = t.rows
            .slice(0, 60)
            .map((linha) => linha.map((celula, i) => `${t.headers[i] ?? `col${i + 1}`}: ${celula}`).join(' | '))
            .join('\n')
          return `${t.caption ? `${t.caption}\n` : ''}${linhas}`
        })
        .filter((t) => t.trim())
      const pares = Object.entries(estruturado?.pairs ?? {})
        .slice(0, 40)
        .map(([k, v]) => `${k}: ${v}`)
      const dados = [...tabelas, ...(pares.length ? [pares.join('\n')] : [])].join('\n\n')
      const conteudo = `${titulo}\nFonte: ${fatos.canonicalUrl}${fatos.publishedAt ? `\nPublicado em: ${fatos.publishedAt.toISOString().slice(0, 10)}` : ''}\n\n${fatos.text}${dados && estruturado ? `\n\nDados capturados em ${new Date(estruturado.capturedAt).toISOString().slice(0, 16).replace('T', ' ')}:\n${dados}` : ''}`
      const web = {
        sourceType: 'web' as const,
        sourceId: site.id,
        url: fatos.url,
        canonicalUrl: fatos.canonicalUrl,
        domain: fatos.domain,
        title: fatos.title,
        author: fatos.author,
        publishedAt: fatos.publishedAt,
        modifiedAt: fatos.modifiedAt,
        fetchedAt: fatos.fetchedAt,
        contentHash: fatos.contentHash,
        readMethod: lida.readMethod,
        ...(estruturado && (tabelas.length || (estruturado.jsonLd ?? []).length || pares.length)
          ? {
              structured: {
                capturedAt: new Date(estruturado.capturedAt),
                tables: estruturado.tables ?? [],
                jsonLd: estruturado.jsonLd ?? [],
                pairs: estruturado.pairs ?? {},
              },
            }
          : {}),
      }
      const anterior = porRef.get(ref)
      if (!anterior) {
        await createDocumentFor(
          { ownerType: 'agent', ownerId: agent._id },
          { title: titulo, content: conteudo, source: 'web', sourceRef: ref, authorId: ownerId, web },
        )
        base.created += 1
      } else if (anterior.web?.contentHash !== fatos.contentHash) {
        // Mudou: reescreve e reindexa SÓ este documento.
        await updateDocumentFor({ ownerType: 'agent', ownerId: agent._id }, anterior._id, { title: titulo, content: conteudo, web })
        base.updated += 1
      } else if (anterior.indexStatus === 'error') {
        /**
         * O texto é o mesmo, e mesmo assim há trabalho: ele nunca chegou a ser indexado.
         *
         * Sem isto o documento ficava preso. O hash bate a cada leitura, então nada é
         * reescrito — e como a indexação só acontece na escrita, um documento que falhou
         * uma vez continuava com zero trechos para sempre. Na prática: o texto guardado,
         * visível na tela de Conhecimento, e o agente respondendo "não tenho esse dado".
         *
         * Aqui ele se conserta sozinho, na leitura seguinte. Não conta como atualização:
         * o conteúdo não mudou, só voltou a ser alcançável.
         */
        const r = await reindexDocumentFor({ ownerType: 'agent', ownerId: agent._id }, anterior._id).catch(() => null)
        base.unchanged += 1
        if (r?.indexStatus === 'indexed') base.reindexed = (base.reindexed ?? 0) + 1
      } else {
        // O hash bate: nada é escrito, nada é reindexado, nenhum embedding é gerado.
        base.unchanged += 1
      }
    }
    if (lidas === 0) throw new Error(problemas[0] ?? 'nenhuma página pôde ser lida')
    await gravarEstado(ownerId, agent._id, site.id, {
      lastFetchedAt: new Date(agora),
      lastSuccessfulFetchAt: new Date(agora),
      nextScheduledAt: nextScheduledAfter(cfg, agora),
      lastError: null,
      status: 'ok',
      discoveredUrls: base.discovered,
      newDocuments: base.created,
      updatedDocuments: base.updated,
    })
    return { ...base, refreshed: true, reason: decisao.reason, durationMs: Date.now() - comecou }
  } catch (erro) {
    // A CATEGORIA, nunca o corpo da resposta de terceiro nem a URL com query string.
    const mensagem = erro instanceof Error ? erro.message.slice(0, 200) : 'falha ao ler a fonte'
    await gravarEstado(ownerId, agent._id, site.id, {
      lastFetchedAt: new Date(agora),
      nextScheduledAt: nextScheduledAfter(cfg, agora),
      lastError: mensagem,
      status: 'error',
    })
    return { ...base, reason: decisao.reason, error: mensagem, durationMs: Date.now() - comecou }
  }
}

/** O estado de UMA fonte, gravado no lugar onde ela já mora. */
async function gravarEstado(ownerId: string, agentId: ObjectId, sourceId: string, estado: WebSourceState): Promise<void> {
  const campos: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(estado)) campos[`watchedSources.$[fonte].${chave}`] = valor
  await agents
    .updateOne({ _id: agentId, ownerId }, { $set: campos }, { arrayFilters: [{ 'fonte.id': sourceId }] })
    .catch((erro) => console.error('não foi possível gravar o estado da fonte web:', erro))
}

/**
 * A base deste agente está atualizada o bastante para ele trabalhar?
 *
 * É o que a orquestração chama antes de executar uma tarefa. Ela não sabe nada de crawler,
 * hash ou HTTP: ela pergunta, e este módulo decide — e na maioria das vezes a resposta é
 * "já está", que não custa nada.
 *
 * Nunca lança: um site fora do ar não pode impedir o agente de trabalhar com o que já tem.
 */
/**
 * A mesma verificação, com teto de espera — para quem está atendendo alguém.
 *
 * A leitura acontece ANTES da resposta, então ela está na frente de quem perguntou.
 * Esperar indefinidamente por um site lento transformaria um problema do site do outro em
 * silêncio no nosso chat: passado o teto, o agente responde com o que já tem na base.
 */
export async function ensureFreshWithTimeout(
  ownerId: string,
  agentId: ObjectId | string,
  motivo: RefreshReason = 'on_demand',
): Promise<RefreshOutcome[]> {
  const limite = new Promise<'timeout'>((r) => {
    const t = setTimeout(() => r('timeout'), WEB_REFRESH_TIMEOUT_MS)
    t.unref?.()
  })
  const saida = await Promise.race([ensureAgentWebKnowledgeFresh(ownerId, agentId, motivo), limite])
  return saida === 'timeout'
    ? [
        {
          sourceId: '',
          name: 'fontes web',
          refreshed: true,
          reason: 'tempo esgotado',
          discovered: 0,
          created: 0,
          updated: 0,
          unchanged: 0,
          error: 'a atualização não terminou a tempo',
          durationMs: WEB_REFRESH_TIMEOUT_MS,
        },
      ]
    : saida
}

export async function ensureAgentWebKnowledgeFresh(
  ownerId: string,
  agentId: ObjectId | string,
  motivo: RefreshReason = 'on_demand',
  agora: number = Date.now(),
): Promise<RefreshOutcome[]> {
  try {
    const id = typeof agentId === 'string' ? new ObjectId(agentId) : agentId
    const agent = await getAgentById(ownerId, id)
    const sites = (agent?.watchedSources ?? []).filter((s) => s.enabled !== false)
    if (!agent || sites.length === 0) return []
    const saida: RefreshOutcome[] = []
    for (const site of sites) saida.push(await atualizarFonte(ownerId, agent, site, motivo, agora))
    const trabalhadas = saida.filter((r) => r.refreshed)
    if (trabalhadas.length > 0) {
      console.info(
        `[web-source] agent=${id.toString()} reason=${motivo} ` +
          trabalhadas
            .map((r) => `${r.name}: ${r.discovered} descoberta(s), ${r.created} nova(s), ${r.updated} atualizada(s), ${r.unchanged} sem mudança${r.error ? `, erro: ${r.error}` : ''}`)
            .join(' | '),
      )
    }
    return saida
  } catch (erro) {
    console.error('falha ao atualizar as fontes web do agente:', erro)
    return []
  }
}

/**
 * A varredura do relógio: quem está na hora, entre todos os donos.
 *
 * Roda no motor de automações que já existe — não há agendador novo. O filtro é feito no
 * banco para não carregar agente que não tem fonte automática nenhuma.
 */
export async function refreshScheduledWebSources(agora: number = Date.now()): Promise<number> {
  const candidatos = await agents
    .find({ 'watchedSources.refreshMode': { $in: ['scheduled', 'hybrid'] } }, { projection: { _id: 1, ownerId: 1 } })
    .limit(200)
    .toArray()
    .catch(() => [])
  let atualizados = 0
  for (const doc of candidatos) {
    const saida = await ensureAgentWebKnowledgeFresh(doc.ownerId, doc._id, 'scheduled', agora)
    atualizados += saida.filter((r) => r.refreshed).length
  }
  return atualizados
}

/**
 * "Apaguei, e não quero de volta."
 *
 * O endereço fica marcado NA FONTE — que continua existindo, com todo o resto que ela
 * produziu. Sem isto, apagar um artigo de uma fonte ativa é um gesto que dura até o
 * próximo scan, o que é pior do que não poder apagar.
 */
export async function ignoreWebUrl(ownerId: string, agentId: ObjectId, sourceId: string, canonicalUrl: string): Promise<void> {
  await agents
    .updateOne(
      { _id: agentId, ownerId },
      { $addToSet: { 'watchedSources.$[fonte].ignoredUrls': canonicalUrl } },
      { arrayFilters: [{ 'fonte.id': sourceId }] },
    )
    .catch((erro) => console.error('não foi possível ignorar o endereço:', erro))
}
