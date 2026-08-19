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
import { contentHashOf, normalizeHttpContent } from './automations/sourceChange.js'
import { safeFetch } from './net/safeHttp.js'
import { createDocumentFor, updateDocumentFor } from './knowledge.js'
import type { KnowledgeDocument } from './knowledge.js'
import { titleFromPage, urlsFromFeed, urlsFromListing, urlsFromSitemap } from './webDiscovery.js'
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
  error?: string
  durationMs: number
}

/** Quanto texto de UMA página vira documento. Uma base não é um espelho da internet. */
const MAX_CARACTERES = 20_000

async function lerPagina(url: string): Promise<{ texto: string; html: string; contentType: string } | null> {
  try {
    const res = await safeFetch(url, { requireOk: true })
    const contentType = res.contentType ?? ''
    return { texto: normalizeHttpContent(res.body, contentType).slice(0, MAX_CARACTERES), html: res.body, contentType }
  } catch {
    return null
  }
}

/**
 * Os endereços a ler nesta rodada — por regra, sem modelo.
 *
 * Sempre inclui o próprio endereço cadastrado: mesmo num feed ou num sitemap, a página de
 * origem costuma ter o resumo que dá sentido ao resto.
 */
async function descobrir(site: WatchedSource, cfg: ReturnType<typeof normalizeWebSource>): Promise<string[]> {
  const modo = resolveDiscovery(cfg, site.kind, site.url)
  if (modo === 'single_page') return [site.url]

  const pagina = await lerPagina(site.url)
  if (!pagina) return [site.url]

  const teto = cfg.maxArticlesPerRun
  if (modo === 'rss') return [...urlsFromFeed(pagina.html, teto)]
  if (modo === 'sitemap') return [...urlsFromSitemap(pagina.html, teto)]
  // listing
  return [site.url, ...urlsFromListing(pagina.html, site.url, { sameDomainOnly: cfg.sameDomainOnly, max: teto })].slice(0, teto + 1)
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
    const urls = await descobrir(site, cfg)
    base.discovered = urls.length
    let lidas = 0
    for (const url of urls.slice(0, cfg.maxArticlesPerRun + 1)) {
      const pagina = await lerPagina(url)
      if (!pagina || !pagina.texto.trim()) continue
      lidas += 1
      const ref = webSourceRef(site.id, url)
      const titulo = titleFromPage(pagina.html, url, site.name)
      // A procedência fica NO texto: quem lê a resposta precisa poder voltar à origem.
      const conteudo = `${titulo}\nFonte: ${url}\n\n${pagina.texto}`
      const anterior = porRef.get(ref)
      if (!anterior) {
        await createDocumentFor(
          { ownerType: 'agent', ownerId: agent._id },
          { title: titulo, content: conteudo, source: 'web', sourceRef: ref, authorId: ownerId },
        )
        base.created += 1
      } else if (contentHashOf(anterior.content ?? '') !== contentHashOf(conteudo)) {
        await updateDocumentFor({ ownerType: 'agent', ownerId: agent._id }, anterior._id, { title: titulo, content: conteudo })
        base.updated += 1
      } else {
        // Não mudou: nada é escrito, nada é reindexado, nada é cobrado.
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
