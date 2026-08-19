// A busca que não depende de nuvem nenhuma.
//
// A recuperação de conhecimento era só `$vectorSearch`, e ele exige Atlas Search e um
// embedding da Voyage. Numa instalação sem os dois — que é o caso de qualquer mongod
// próprio — a busca falha SEMPRE: o índice não existe e, sem `VOYAGE_API_KEY`, o
// documento nem chega a virar chunk (`indexStatus: 'error'`, zero chunks). O agente
// então responde "não há dados" sobre uma base que ele tem inteira, gravada em
// `knowledge_documents.content`.
//
// Este módulo é a metade determinística da recuperação híbrida: encontra o que é
// EXATO — um ticker, uma data, um número — comparando texto, sem modelo e sem rede.
// Ele não substitui o vetorial (que acha "quanto valia" a partir de "qual era a
// cotação"); ele garante que BBSE3 em 10/08/2026 seja encontrado quando está escrito.
//
// Puro e sem banco de propósito: a extração de termos, a expansão de datas, a nota e o
// recorte da passagem são testáveis sem subir mongod, e a consulta em si fica em
// `knowledge.ts`, onde o filtro de dono já vive.

/** Um termo procurado, com o peso que ele tem na nota. */
export interface LexicalTerm {
  /** O texto a procurar, já normalizado. */
  term: string
  /**
   * Termos ESPECÍFICOS (ticker, data, valor) valem mais que palavras comuns: um trecho
   * que contém "BBSE3" responde à pergunta; um que contém "cotação" só fala do assunto.
   */
  weight: number
}

/** Escapa tudo que o motor de regex trataria como sintaxe. */
export const escapeRegex = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const DIACRITICOS = /[̀-ͯ]/g
/** Minúsculas e sem acento, para "análise" casar com "analise". */
export const normalize = (texto: string): string => texto.normalize('NFD').replace(DIACRITICOS, '').toLowerCase()

// Palavras que aparecem em toda pergunta e não distinguem documento nenhum. Uma lista
// curta: filtrar demais é perder o termo que importava.
const VAZIAS = new Set([
  'para','como','qual','quais','quando','onde','porque','sobre','esse','essa','este','esta','isso','aquilo',
  'the','and','for','with','what','when','where','which','from','that','this',
  'valor','dados','dado','favor','preciso','gostaria','saber','pode','poderia','me','diga','informe',
])

const RE_DATA_BR = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g
const RE_DATA_ISO = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g
// "4 de agosto", "6 de agosto de 2026" — como uma pessoa escreve.
const RE_DATA_PT = /\b(\d{1,2})\s+de\s+([\p{L}]{3,12})(?:\s+de\s+(\d{4}))?/giu
// "Aug 4, 2026", "August 4 2026" — como as tabelas exportadas escrevem.
const RE_DATA_EN = /\b([\p{L}]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})?\b/giu

// Os doze meses nas escritas que aparecem de verdade. O índice é o mês - 1.
const MES_PT = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
const MES_EN = ['january','february','march','april','may','june','july','august','september','october','november','december']
const ABREV_EN = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
const ABREV_PT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']

/** O número do mês (1-12) a partir do nome, em português ou inglês, inteiro ou abreviado. */
export function mesDoNome(nome: string): number | null {
  const n = normalize(nome).replace(/\.$/, '')
  for (const tabela of [MES_PT, MES_EN, ABREV_EN, ABREV_PT]) {
    const i = tabela.indexOf(n)
    if (i >= 0) return i + 1
  }
  // "sept" é comum e não está em nenhuma das tabelas.
  if (n === 'sept') return 9
  return null
}
// Um código alfanumérico: tem letra E dígito, como BBSE3, PETR4, NF-1234, ISO9001.
const RE_CODIGO = /\b(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]{3,}\b/gi
// Um número com casas decimais, com vírgula ou ponto: 36,42 / 36.42 / 1.234,56.
const RE_NUMERO = /\b\d{1,3}(?:[.\s]\d{3})*[,.]\d{1,2}\b|\b\d+[,.]\d{1,2}\b/g
const RE_PALAVRA = /[\p{L}\p{N}]{4,}/gu

const pad = (n: string): string => (n.length === 1 ? `0${n}` : n)

/**
 * As duas escritas da mesma data.
 *
 * "10/08/2026" e "2026-08-10" são o mesmo dia, e quem pergunta de um jeito costuma ter
 * guardado do outro. Sem isto, a base responderia vazia por causa de uma barra.
 */
export function expandirData(dia: string, mes: string, ano?: string): string[] {
  const d = pad(dia)
  const m = pad(mes)
  const n = Number(dia)
  const i = Number(mes) - 1
  if (i < 0 || i > 11) return []
  const formas: string[] = []
  if (ano) {
    formas.push(`${d}/${m}/${ano}`, `${ano}-${m}-${d}`, `${d}-${m}-${ano}`, `${n}/${Number(mes)}/${ano}`)
    // A escrita das tabelas exportadas — que é justamente a que o dono carrega na base.
    formas.push(`${ABREV_EN[i]} ${n}, ${ano}`, `${ABREV_EN[i]} ${n} ${ano}`, `${MES_EN[i]} ${n}, ${ano}`)
    formas.push(`${n} de ${MES_PT[i]} de ${ano}`)
  }
  // Sem ano, a vírgula e o espaço são o que impede "4" de casar dentro de "40": as duas
  // escritas existem ("Aug 4, 2026" e "Aug 4 2026"), então as duas entram.
  formas.push(`${ABREV_EN[i]} ${n},`, `${ABREV_EN[i]} ${n} `, `${n} de ${MES_PT[i]}`)
  return formas
}

/**
 * Os termos que valem procurar numa pergunta.
 *
 * A ordem é a da especificidade: primeiro o que identifica (datas, códigos, valores),
 * depois as palavras. O limite existe para uma pergunta longa não virar uma consulta com
 * cinquenta alternativas.
 */
export function extractTerms(query: string, max = 24): LexicalTerm[] {
  const vistos = new Set<string>()
  const saida: LexicalTerm[] = []
  const push = (term: string, weight: number) => {
    const chave = normalize(term)
    if (!chave || vistos.has(chave)) return
    vistos.add(chave)
    saida.push({ term, weight })
  }

  for (const m of query.matchAll(RE_DATA_BR)) for (const forma of expandirData(m[1], m[2], m[3])) push(forma, 4)
  for (const m of query.matchAll(RE_DATA_ISO)) for (const forma of expandirData(m[3], m[2], m[1])) push(forma, 4)
  // "6 de agosto de 2026" e "Aug 6, 2026" são a mesma data que "06/08/2026", e sem isto
  // uma pergunta escrita por gente nunca encontrava a linha de uma tabela em inglês.
  for (const m of query.matchAll(RE_DATA_PT)) {
    const mes = mesDoNome(m[2])
    if (mes) for (const forma of expandirData(m[1], String(mes), m[3])) push(forma, 4)
  }
  for (const m of query.matchAll(RE_DATA_EN)) {
    const mes = mesDoNome(m[1])
    if (mes) for (const forma of expandirData(m[2], String(mes), m[3])) push(forma, 4)
  }
  for (const m of query.matchAll(RE_CODIGO)) push(m[0], 3)
  for (const m of query.matchAll(RE_NUMERO)) push(m[0], 3)
  for (const m of query.matchAll(RE_PALAVRA)) {
    const palavra = m[0]
    if (VAZIAS.has(normalize(palavra))) continue
    push(palavra, 1)
  }
  return saida.slice(0, max)
}

/** Uma alternância `a|b|c` escapada, para casar qualquer termo de uma vez. */
export const termsToPattern = (termos: LexicalTerm[]): string => termos.map((t) => escapeRegex(t.term)).join('|')

/**
 * Quanto deste texto responde à pergunta, entre 0 e 1.
 *
 * Determinística: os mesmos termos no mesmo texto dão sempre a mesma nota. O piso de
 * 0,5 existe porque uma correspondência EXATA de identificador é evidência mais forte
 * que um vizinho vetorial fraco — e `selectKnowledgeHits` descarta abaixo de 0,5.
 */
export function scoreText(texto: string, termos: LexicalTerm[]): number {
  if (termos.length === 0) return 0
  const alvo = normalize(texto)
  let obtido = 0
  let total = 0
  let algumEspecifico = false
  for (const { term, weight } of termos) {
    total += weight
    if (alvo.includes(normalize(term))) {
      obtido += weight
      if (weight > 1) algumEspecifico = true
    }
  }
  if (obtido === 0) return 0
  // Sem nenhum termo específico, é só assunto em comum: fica abaixo do piso e não chega
  // ao prompt como se fosse resposta.
  if (!algumEspecifico) return Math.min(0.49, obtido / total)
  return 0.5 + 0.5 * (obtido / total)
}

/**
 * O pedaço do documento em volta do que casou.
 *
 * Mandar o documento inteiro estouraria o orçamento de caracteres e afogaria a
 * passagem que importa. A janela é centrada na PRIMEIRA ocorrência do termo mais
 * específico, e as bordas andam até um espaço para não cortar palavra no meio.
 */
export function extractWindow(texto: string, termos: LexicalTerm[], tamanho = 600): string {
  if (texto.length <= tamanho) return texto.trim()
  /**
   * O começo do documento, que é o que dá sentido a uma linha solta.
   *
   * Numa tabela exportada as primeiras linhas dizem DE QUE é a tabela e QUAIS são as
   * colunas. Sem elas, "Aug 4, 2026 23,500.00 24,600.00 23,250.00 23,580.00" obriga o
   * modelo a adivinhar qual número é a abertura — e a acertar por hábito é o tipo de
   * acerto que um dia sai errado sem avisar. Foi assim que uma cotação de um papel foi
   * apresentada como sendo de outro.
   *
   * Só entram linhas INTEIRAS: um documento de texto corrido sem quebra nenhuma não
   * ganha um pedaço de frase cortado no meio.
   */
  const inicioDoTexto = texto.slice(0, 240)
  const cabecalho = inicioDoTexto.includes('\n')
    ? inicioDoTexto.split('\n').slice(0, 3).join('\n').trim()
    : ''
  const alvo = normalize(texto)
  let posicao = -1
  for (const { term } of [...termos].sort((a, b) => b.weight - a.weight)) {
    posicao = alvo.indexOf(normalize(term))
    if (posicao >= 0) break
  }
  if (posicao < 0) return texto.slice(0, tamanho).trim()

  let inicio = Math.max(0, posicao - Math.floor(tamanho / 2))
  let fim = Math.min(texto.length, inicio + tamanho)
  if (inicio > 0) {
    const espaco = texto.indexOf(' ', inicio)
    if (espaco >= 0 && espaco < inicio + 40) inicio = espaco + 1
  }
  if (fim < texto.length) {
    const espaco = texto.lastIndexOf(' ', fim)
    if (espaco > inicio && espaco > fim - 40) fim = espaco
  }
  const janela = texto.slice(inicio, fim).trim()
  // Só quando o recorte começou DEPOIS dela — senão o cabeçalho apareceria duas vezes.
  return cabecalho && inicio > cabecalho.length ? `${cabecalho}\n…\n${janela}` : janela
}
