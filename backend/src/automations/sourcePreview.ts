// "Testar fonte": consultar a URL e mostrar o que ela devolve, sem gastar nada.
//
// A pergunta que este módulo responde é a que o usuário faz antes de salvar: *isto
// aqui funciona?*. Ele busca, interpreta e devolve uma amostra. Nenhuma LLM é
// chamada, nenhum token é consumido e nenhum checkpoint é tocado — testar não pode
// fazer a rotina "pular" um item de verdade depois.
import { safeFetch } from '../net/safeHttp.js'
import { detectHttpChange } from './sourceChange.js'
import { dedupeItems, filterByWindow, parseRssItems } from './sources.js'
import { INITIAL_WINDOWS } from './sourceChange.js'
import type { InitialWindow } from './sourceChange.js'

export interface SourcePreview {
  ok: boolean
  kind: 'rss' | 'http'
  // Mensagem para o usuário. Nunca traz corpo cru de resposta nem a URL completa —
  // a URL pode carregar token em query string, e o corpo é conteúdo de terceiro.
  message: string
  itemCount?: number
  // Amostra curta: título e link do que a rotina entregaria hoje.
  items?: { title: string; url: string; publishedAt: string | null }[]
  // HTTP: um pedaço do texto útil, para o usuário reconhecer a página.
  excerpt?: string
}

const AMOSTRA = 5
const TRECHO = 400

export async function previewSource(
  kind: 'rss' | 'http',
  url: string,
  opts: { initialWindow?: InitialWindow; now?: number } = {},
): Promise<SourcePreview> {
  const agora = opts.now ?? Date.now()
  try {
    // O MESMO safeFetch do worker: se a URL for recusada aqui, ela também seria
    // recusada rodando. Testar com regra mais frouxa que a execução seria pior que
    // não testar.
    const res = await safeFetch(url, {
      contentTypeAllowlist: kind === 'rss' ? ['xml', 'rss', 'atom', 'text'] : undefined,
    })

    if (kind === 'rss') {
      const todos = dedupeItems(parseRssItems(res.body))
      if (todos.length === 0) {
        return { ok: false, kind, message: 'A resposta chegou, mas não parece um feed RSS ou Atom — nenhum item foi encontrado.' }
      }
      const janela = INITIAL_WINDOWS[opts.initialWindow ?? '24h']
      const naJanela = filterByWindow(todos, janela, agora)
      return {
        ok: true,
        kind,
        message: `Feed lido: ${todos.length} item(ns), ${naJanela.length} dentro da janela escolhida.`,
        itemCount: naJanela.length,
        items: naJanela.slice(0, AMOSTRA).map((i) => ({ title: i.title, url: i.url, publishedAt: i.publishedAt })),
      }
    }

    // HTTP: o que interessa é o conteúdo NORMALIZADO — é ele que será comparado a
    // cada verificação, então é ele que o usuário precisa ver.
    const { conteudo } = detectHttpChange(res.body, res.contentType, null)
    if (!conteudo) {
      return { ok: false, kind, message: 'A resposta chegou vazia depois de remover a marcação. Esta página pode depender de JavaScript, que não é executado aqui.' }
    }
    return {
      ok: true,
      kind,
      message: `Página lida: ${conteudo.length} caracteres de conteúdo útil.`,
      excerpt: conteudo.slice(0, TRECHO),
    }
  } catch (erro) {
    // A mensagem do safeFetch é escrita para o dono ("endereço privado não é
    // permitido", "tipo de conteúdo não suportado"). O que nunca sai daqui é o
    // corpo da resposta nem a URL com query string.
    return { ok: false, kind, message: (erro as Error).message || 'Não foi possível consultar esta URL.' }
  }
}
