import bruto from './indice.json'

// O ÍNDICE, com o markdown já anexado.
//
// A lista de páginas é `indice.json` — dados, para que o script de build a leia sem
// compilar TypeScript. Aqui ela ganha o conteúdo: o Vite lê todos os markdown da pasta de
// uma vez, e cada página encontra o seu pelo slug. Assim, acrescentar uma página é uma
// entrada no JSON e um arquivo `.md`; não há um terceiro lugar para esquecer.

const ARQUIVOS = import.meta.glob('./conteudo/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export interface PaginaDoc {
  slug: string
  titulo: string
  /** Uma frase — ela aparece no índice, no resultado de busca e na prévia do link. */
  resumo: string
  markdown: string
}

export interface SecaoDoc {
  titulo: string
  paginas: PaginaDoc[]
}

const dados = bruto as { secoes: { titulo: string; paginas: { slug: string; titulo: string; resumo: string }[] }[] }

export const SECOES: SecaoDoc[] = dados.secoes.map((s) => ({
  titulo: s.titulo,
  paginas: s.paginas.map((p) => ({ ...p, markdown: ARQUIVOS[`./conteudo/${p.slug}.md`] ?? '' })),
}))

export const TODAS: PaginaDoc[] = SECOES.flatMap((s) => s.paginas)

export const paginaPorSlug = (slug: string): PaginaDoc | undefined => TODAS.find((p) => p.slug === slug)

/**
 * A busca — sobre o texto inteiro, e não só sobre os títulos.
 *
 * Quem procura documentação procura pelo termo que viu num erro ou num campo, e esse termo
 * quase nunca é um título. Buscar só em títulos devolve vazio para exatamente a consulta
 * que trouxe a pessoa até aqui.
 */
export function buscar(termo: string): { pagina: PaginaDoc; trecho: string }[] {
  const alvo = termo.trim().toLowerCase()
  if (alvo.length < 2) return []
  const fora: { pagina: PaginaDoc; trecho: string }[] = []
  for (const pagina of TODAS) {
    const onde = pagina.markdown.toLowerCase().indexOf(alvo)
    const noTitulo = pagina.titulo.toLowerCase().includes(alvo) || pagina.resumo.toLowerCase().includes(alvo)
    if (onde === -1 && !noTitulo) continue
    // O trecho mostra o termo NO contexto: um resultado sem contexto obriga a abrir a
    // página para descobrir se era aquilo mesmo.
    const trecho =
      onde === -1
        ? pagina.resumo
        : pagina.markdown.slice(Math.max(0, onde - 60), onde + 100).replace(/\s+/g, ' ').trim()
    fora.push({ pagina, trecho })
  }
  return fora
}
