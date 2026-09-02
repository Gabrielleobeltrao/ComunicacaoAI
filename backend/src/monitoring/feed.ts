// O PARSER de RSS/Atom — pequeno, fechado, e sem dependência nova.
//
// Um feed é XML, mas não é preciso um parser de XML genérico para ler um: os dois formatos
// que importam têm a mesma forma — uma lista de itens com meia dúzia de campos. Trazer uma
// biblioteca de XML para isto significaria carregar um parser completo (com entidades
// externas, DTD e o resto) para ler cinco tags.
//
// E é justamente esse "resto" que faz a diferença de segurança: sem DTD e sem entidade
// externa, não existe XXE para explorar. O que este arquivo lê é texto entre etiquetas.

export interface FeedItem {
  id: string | null
  title: string | null
  link: string | null
  summary: string | null
  publishedAt: string | null
  author: string | null
}

/** Tetos: um feed com dez mil itens não é um feed, é um despejo. */
const MAX_ITENS = 200
const MAX_CAMPO = 4_000

const decodificar = (texto: string): string =>
  texto
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // O `&amp;` por último: desfazer antes transformaria `&amp;lt;` em `<`.
    .replace(/&amp;/g, '&')

/** O conteúdo da primeira etiqueta com este nome. Sem recursão e sem construir árvore. */
function tag(bloco: string, nome: string): string | null {
  const m = new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, 'i').exec(bloco)
  if (!m) return null
  const limpo = decodificar(m[1]).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return limpo ? limpo.slice(0, MAX_CAMPO) : null
}

/** O `href` de um `<link>` do Atom, que guarda o endereço no atributo e não no corpo. */
function linkAtom(bloco: string): string | null {
  const m = /<link[^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(bloco)
  return m ? decodificar(m[1]).slice(0, MAX_CAMPO) : null
}

/**
 * Lê RSS 2.0 e Atom com o mesmo caminho.
 *
 * Devolve lista vazia quando não é feed — e não lança: quem chama precisa transformar isso
 * em telemetria, e uma exceção subindo daqui apagaria a informação de que a fonte mudou de
 * formato.
 */
export function parseFeed(xml: string): FeedItem[] {
  const itens: FeedItem[] = []
  // `<item>` é RSS; `<entry>` é Atom. Os dois, no mesmo laço.
  for (const m of xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const bloco = m[2]
    itens.push({
      id: tag(bloco, 'guid') ?? tag(bloco, 'id') ?? null,
      title: tag(bloco, 'title'),
      link: tag(bloco, 'link') ?? linkAtom(bloco),
      summary: tag(bloco, 'description') ?? tag(bloco, 'summary') ?? tag(bloco, 'content'),
      publishedAt: normalizarData(tag(bloco, 'pubDate') ?? tag(bloco, 'published') ?? tag(bloco, 'updated')),
      author: tag(bloco, 'author') ?? tag(bloco, 'dc:creator'),
    })
    if (itens.length >= MAX_ITENS) break
  }
  return itens
}

/** Data em ISO, ou `null`. Um feed com data ilegível não vira uma data inventada. */
function normalizarData(bruto: string | null): string | null {
  if (!bruto) return null
  const d = new Date(bruto)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export const pareceFeed = (contentType: string, corpo: string): boolean =>
  /xml|rss|atom/i.test(contentType) || /<rss[\s>]|<feed[\s>]/i.test(corpo.slice(0, 500))
