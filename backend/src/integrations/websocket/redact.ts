/**
 * Riscar a credencial CONHECIDA — em qualquer forma que ela apareça.
 *
 * Há serviço que ecoa a mensagem de autenticação de volta e há serviço que devolve o
 * token dentro do erro. A chave chega pelo socket como conteúdo, e daí para o trecho
 * que a tela mostra, para o payload do evento e para o dado ao vivo é um passo.
 *
 * Duas decisões:
 *
 * RECURSIVO, e não `JSON.stringify` → substituir → `JSON.parse`. Aquele caminho
 * atravessava a estrutura inteira duas vezes, quebrava em ciclo, e — pior — podia
 * produzir JSON inválido quando o segredo continha aspas ou barra: a substituição
 * mexia no texto JÁ ESCAPADO, e o `parse` de volta lançava. Uma exceção ali derrubava
 * a mensagem inteira, que é o oposto de proteger.
 *
 * TRÊS FORMAS da mesma chave. Ela chega literal, chega escapada dentro de um JSON que
 * veio como string (`a\\"b`), e chega percent-encoded quando o serviço devolve a URL
 * que recebeu. Riscar só a literal deixava as outras duas passarem.
 */
export const MASCARA = '***'

/** Só valores com algum tamanho: riscar `usd` ou `paper` estragaria mensagem legítima. */
const TAMANHO_MINIMO = 8

/** As variações de um mesmo segredo que podem chegar pelo fio. */
export function variacoesDe(segredo: string): string[] {
  if (typeof segredo !== 'string' || segredo.length < TAMANHO_MINIMO) return []
  const formas = new Set<string>([segredo])
  // Escapado dentro de um JSON que chegou como texto.
  formas.add(JSON.stringify(segredo).slice(1, -1))
  // Percent-encoded, das duas maneiras — `encodeURIComponent` não escapa `!*()'`.
  formas.add(encodeURIComponent(segredo))
  formas.add(encodeURI(segredo))
  try {
    // E o contrário: o serviço pode devolver decodificado o que recebeu codificado.
    formas.add(decodeURIComponent(segredo))
  } catch {
    // Um `%` solto no segredo faz `decodeURIComponent` lançar. Não é motivo para nada.
  }
  return [...formas].filter((f) => f.length >= TAMANHO_MINIMO)
}

const todasAsFormas = (segredos: readonly string[]): string[] => [...new Set(segredos.flatMap(variacoesDe))]

export function mascarar(texto: string, segredos: readonly string[]): string {
  const formas = todasAsFormas(segredos)
  if (!formas.length) return String(texto ?? '')
  let fora = String(texto ?? '')
  for (const forma of formas) fora = fora.split(forma).join(MASCARA)
  return fora
}

/**
 * A mesma máscara, descendo na estrutura e PRESERVANDO os tipos.
 *
 * Número continua número, data continua data, `null` continua `null`. O caminho antigo
 * transformava tudo em texto e de volta, e uma data virava string no meio do percurso.
 */
export function mascararProfundo<T>(valor: T, segredos: readonly string[], vistos = new WeakSet<object>()): T {
  const formas = todasAsFormas(segredos)
  if (!formas.length) return valor
  return descer(valor, formas, vistos) as T
}

function descer(valor: unknown, formas: readonly string[], vistos: WeakSet<object>): unknown {
  if (typeof valor === 'string') {
    let fora = valor
    for (const forma of formas) fora = fora.split(forma).join(MASCARA)
    return fora
  }
  if (valor === null || typeof valor !== 'object') return valor
  // Um ciclo não pode virar recursão infinita — e um payload de fora pode ter um.
  if (vistos.has(valor)) return valor
  vistos.add(valor)
  if (Array.isArray(valor)) return valor.map((v) => descer(v, formas, vistos))
  // Data, RegExp e afins passam inteiros: descer neles produziria um objeto vazio.
  if (Object.getPrototypeOf(valor) !== Object.prototype && Object.getPrototypeOf(valor) !== null) return valor
  const fora: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    // A CHAVE também é texto de fora: um serviço pode devolver o token como nome do campo.
    let chave = k
    for (const forma of formas) chave = chave.split(forma).join(MASCARA)
    fora[chave] = descer(v, formas, vistos)
  }
  return fora
}

/** Os valores de uma credencial que valem a pena riscar. */
export const segredosDe = (credencial: Record<string, string> | null | undefined): string[] =>
  Object.values(credencial ?? {}).filter((v) => typeof v === 'string' && v.length >= TAMANHO_MINIMO)

/** O segredo aparece neste texto, em qualquer das formas? */
export const contemSegredo = (texto: string, segredos: readonly string[]): boolean =>
  todasAsFormas(segredos).some((f) => String(texto ?? '').includes(f))
