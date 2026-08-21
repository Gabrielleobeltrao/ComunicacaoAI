// O caminho de uma busca: procurar barato, ler pouco, entregar só o que responde.
//
// A ordem existe para não gastar. Um serviço de busca devolve título, endereço e trecho —
// isso é barato. Abrir uma página é caro, e mandar a página inteira para o modelo é caro
// duas vezes: paga-se o token e piora-se a resposta, porque o que responde fica enterrado
// no meio do menu.
//
// Então: procura, ORDENA pelo que a pergunta pede, abre só as melhores, e do que abriu
// tira só os trechos que casam. O modelo recebe evidência, não páginas.
import { readWebPage } from '../adaptiveWebReader.js'
import { rendererAtivo } from '../browserRenderer.js'
import { extractTerms, extractWindow, scoreText } from '../lexicalRetrieval.js'
import type { SearchResult, WebSearchProvider } from './provider.js'
import type { WebSearchSettings } from './policy.js'

export interface Evidence {
  title: string
  url: string
  text: string
}

export interface SearchRunOutcome {
  ok: boolean
  provider: string
  query: string
  /** Quantos o serviço devolveu, antes de qualquer escolha. */
  found: number
  /** Os endereços escolhidos para abrir — e por que estes. */
  selected: { url: string; title: string; score: number }[]
  /** Os que foram abertos de fato, com o resultado da leitura. */
  read: { url: string; ok: boolean; code?: string; usefulChars: number; durationMs: number }[]
  evidence: Evidence[]
  durationMs: number
  error?: string
}

/**
 * Ordena os resultados pelo que a PERGUNTA pede.
 *
 * Usa a mesma comparação de texto que a busca na base usa — título e trecho contra os
 * termos da pergunta. Determinística de propósito: escolher qual página abrir é uma
 * decisão de custo, e uma decisão de custo que muda a cada execução não dá para auditar.
 *
 * O empate desempata pela ORDEM do serviço, que já é um ranking.
 */
export function rankResults(query: string, resultados: SearchResult[]): { r: SearchResult; score: number }[] {
  const termos = extractTerms(query)
  return resultados
    .map((r, i) => ({ r, i, score: scoreText(`${r.title}\n${r.snippet}`, termos) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ r, score }) => ({ r, score }))
}

/** Os trechos de uma página que respondem à pergunta — não a página. */
function evidenciasDe(texto: string, query: string, maxChars: number, maxTrechos: number): string[] {
  const termos = extractTerms(query)
  const recorte = texto.slice(0, maxChars)
  const janela = extractWindow(recorte, termos, 600)
  if (!janela.trim()) {
    // Nenhum termo casou: o começo do texto ao menos diz do que a página trata. Um trecho
    // só, porque isto é palpite, não evidência.
    return [recorte.slice(0, 600)].filter((t) => t.trim())
  }
  return [janela].slice(0, maxTrechos)
}

/**
 * Procura, escolhe, lê e extrai. Nunca lança: uma busca que falha é um resultado com
 * motivo, e o pesquisador segue com o que já tinha da base.
 */
export async function runWebSearch(
  provider: WebSearchProvider,
  query: string,
  cfg: WebSearchSettings,
  deps: { read?: typeof readWebPage } = {},
): Promise<SearchRunOutcome> {
  const comecou = Date.now()
  const base: SearchRunOutcome = {
    ok: false,
    provider: provider.name,
    query,
    found: 0,
    selected: [],
    read: [],
    evidence: [],
    durationMs: 0,
  }

  let resultados: SearchResult[]
  try {
    resultados = await provider.search(query, { maxResults: cfg.maxSearchResults, timeoutMs: cfg.searchTimeoutMs })
  } catch (erro) {
    return { ...base, error: erro instanceof Error ? erro.message.slice(0, 200) : 'falha na busca', durationMs: Date.now() - comecou }
  }

  // O teto vale mesmo que o serviço devolva mais: quem paga a leitura é esta instalação.
  const encontrados = resultados.slice(0, cfg.maxSearchResults)
  base.found = encontrados.length
  if (encontrados.length === 0) return { ...base, ok: true, durationMs: Date.now() - comecou }

  const ordenados = rankResults(query, encontrados)
  const escolhidos = ordenados.slice(0, cfg.maxPagesToRead)
  base.selected = escolhidos.map(({ r, score }) => ({ url: r.url, title: r.title, score: Math.round(score * 100) / 100 }))

  const ler = deps.read ?? readWebPage
  // Em série: abrir cinco páginas ao mesmo tempo é cinco vezes o pico de memória e um
  // pico de tráfego para sites que não pediram nada. O teto já é baixo.
  for (const { r } of escolhidos) {
    const lida = await ler(r.url, { renderer: rendererAtivo(), timeoutMs: cfg.pageReadTimeoutMs })
    base.read.push({
      url: r.url,
      ok: lida.ok,
      ...(lida.code ? { code: lida.code } : {}),
      usefulChars: lida.metadata.usefulChars,
      durationMs: lida.durationMs,
    })
    if (!lida.ok || !lida.text.trim()) continue
    for (const trecho of evidenciasDe(lida.text, query, cfg.maxCharsPerPage, cfg.maxEvidenceChunks)) {
      if (base.evidence.length >= cfg.maxEvidenceChunks) break
      base.evidence.push({ title: lida.metadata.title || r.title, url: lida.metadata.canonicalUrl || r.url, text: trecho })
    }
    if (base.evidence.length >= cfg.maxEvidenceChunks) break
  }

  return { ...base, ok: true, durationMs: Date.now() - comecou }
}
