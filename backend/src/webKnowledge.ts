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
import { safeFetch } from './net/safeHttp.js'
import { createDocumentFor, updateDocumentFor } from './knowledge.js'
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
  /** Por onde os endereços foram descobertos nesta rodada. */
  via?: string
  error?: string
  durationMs: number
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

async function lerPagina(url: string): Promise<{ html: string; contentType: string; finalUrl: string } | null> {
  try {
    const res = await safeFetch(url, { requireOk: true, timeoutMs: TIMEOUT_POR_PAGINA_MS, maxBytes: MAX_BYTES })
    // O endereço FINAL: um redirect leva a outra página, e é a de chegada que vale como
    // identidade — senão o mesmo conteúdo entra duas vezes, por dois endereços.
    return { html: res.body, contentType: res.contentType ?? '', finalUrl: res.finalUrl || url }
  } catch {
    return null
  }
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
async function descobrir(site: WatchedSource, cfg: ReturnType<typeof normalizeWebSource>): Promise<Descoberta> {
  const teto = cfg.maxArticlesPerRun
  const escolhido = cfg.discoveryMode === 'auto'
    ? await planDiscovery(site.url, site.kind, { fetch: async (u: string) => { const r = await lerPagina(u); return r ? { body: r.html, contentType: r.contentType } : null } }, { crawlArticles: cfg.crawlArticles })
    : { via: resolveDiscovery(cfg, site.kind, site.url), url: site.url }

  if (escolhido.via === 'single_page') return { urls: [site.url], via: 'single_page' }

  const pagina = await lerPagina(escolhido.url)
  if (!pagina) return { urls: [site.url], via: 'single_page' }

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
    const { urls, via } = await descobrir(site, cfg)
    base.discovered = urls.length
    base.via = via
    let lidas = 0

    // A leitura é em lotes: rápida sem ser atropelo no servidor do outro.
    const paginas = await emLotes(urls.slice(0, cfg.maxArticlesPerRun), CONCORRENCIA, async (url) => {
      const pagina = await lerPagina(url)
      if (!pagina) return null
      // O endereço FINAL do redirect é a identidade; o canônico declarado manda sobre ele.
      const fatos = pageFacts(pagina.html, pagina.finalUrl, new Date(agora))
      return fatos.text.trim() ? { fatos, html: pagina.html } : null
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
    for (const { fatos } of conteudos) {
      if (ignorados.has(fatos.canonicalUrl)) {
        base.ignored = (base.ignored ?? 0) + 1
        continue
      }
      const ref = webSourceRef(site.id, fatos.canonicalUrl)
      const titulo = (fatos.title ?? site.name).slice(0, 200)
      // A procedência fica NO texto: quem lê a resposta precisa poder voltar à origem.
      const conteudo = `${titulo}\nFonte: ${fatos.canonicalUrl}${fatos.publishedAt ? `\nPublicado em: ${fatos.publishedAt.toISOString().slice(0, 10)}` : ''}\n\n${fatos.text}`
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
      } else {
        // O hash bate: nada é escrito, nada é reindexado, nenhum embedding é gerado.
        base.unchanged += 1
      }
    }
    if (lidas === 0) throw new Error('nenhuma página pôde ser lida')
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
