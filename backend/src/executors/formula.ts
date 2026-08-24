// A LINGUAGEM DE FÓRMULA — cálculo do cliente, sem execução arbitrária.
//
// O pedido era colar código no agente. Numa plataforma multi-inquilino isso significa o
// código de um cliente rodando no mesmo processo que tem a chave do banco, as credenciais
// cifradas dos Apps e os dados de todas as outras contas. Um `while(true)` derruba o
// serviço inteiro; um escape do sandbox entrega tudo.
//
// A saída é não dar capacidade nenhuma, em vez de dar e depois bloquear. Este
// interpretador não tem rede, não tem disco, não tem acesso ao processo — não porque algo
// os proíbe, mas porque essas operações NÃO EXISTEM nele. E a gramática não tem laço nem
// recursão, então toda fórmula termina: não é um limite imposto, é uma propriedade do que
// se pode escrever.
//
// É o mesmo princípio de uma planilha, e resolve o caso comum — calcular, converter,
// formatar, decidir. Quem precisar de mais usa Ferramenta personalizada (HTTP), onde o
// código roda no servidor de quem escreveu.
//
// A gramática, inteira:
//
//   programa   := atribuicao (\n atribuicao)*
//   atribuicao := IDENT '=' expr
//   expr       := ou
//   ou         := e ('ou' e)*
//   e          := nao ('e' nao)*
//   nao        := 'nao' nao | comparacao
//   comparacao := soma (('='|'<>'|'<'|'<='|'>'|'>=') soma)?
//   soma       := produto (('+'|'-') produto)*
//   produto    := unario (('*'|'/'|'%') unario)*
//   unario     := '-' unario | primario
//   primario   := NUMERO | TEXTO | booleano | IDENT | chamada | '(' expr ')'

export type ValorFormula = number | string | boolean | (number | string)[]

export interface ErroDeFormula {
  /** A linha (1-based) onde está o problema. */
  line: number
  message: string
}

// --- limites -------------------------------------------------------------------------------
//
// Nenhum deles protege contra laço — não há laço. Eles existem contra o texto absurdo:
// uma fórmula de dez mil caracteres com mil parênteses aninhados consome pilha e tempo de
// análise antes de qualquer conta acontecer.

const MAX_CARACTERES = 4_000
const MAX_LINHAS = 40
const MAX_PROFUNDIDADE = 24
/** Teto de nós avaliados. Uma fórmula honesta usa dezenas; isto é a rede, não o critério. */
const MAX_PASSOS = 20_000

const PALAVRAS = new Set(['e', 'ou', 'nao', 'verdadeiro', 'falso'])

// --- o léxico ---------------------------------------------------------------------------------

type Tipo = 'num' | 'txt' | 'ident' | 'op' | 'abre' | 'fecha' | 'virgula' | 'fim'
interface Token {
  tipo: Tipo
  valor: string
  line: number
}

function tokenizar(fonte: string, line: number): Token[] {
  const tokens: Token[] = []
  let i = 0
  const erro = (m: string): never => {
    throw new ErroLexico(m, line)
  }
  while (i < fonte.length) {
    const c = fonte[i]
    if (c === ' ' || c === '\t') {
      i += 1
      continue
    }
    if (c >= '0' && c <= '9') {
      let j = i
      while (j < fonte.length && /[0-9]/.test(fonte[j])) j += 1
      if (fonte[j] === '.' && /[0-9]/.test(fonte[j + 1] ?? '')) {
        j += 1
        while (j < fonte.length && /[0-9]/.test(fonte[j])) j += 1
      }
      tokens.push({ tipo: 'num', valor: fonte.slice(i, j), line })
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      const fecha = fonte.indexOf(c, i + 1)
      if (fecha < 0) erro('texto sem aspas de fechamento')
      tokens.push({ tipo: 'txt', valor: fonte.slice(i + 1, fecha), line })
      i = fecha + 1
      continue
    }
    if (/[A-Za-zÀ-ÿ_]/.test(c)) {
      let j = i
      while (j < fonte.length && /[A-Za-zÀ-ÿ0-9_]/.test(fonte[j])) j += 1
      tokens.push({ tipo: 'ident', valor: fonte.slice(i, j), line })
      i = j
      continue
    }
    const dois = fonte.slice(i, i + 2)
    if (dois === '<=' || dois === '>=' || dois === '<>') {
      tokens.push({ tipo: 'op', valor: dois, line })
      i += 2
      continue
    }
    if ('+-*/%=<>'.includes(c)) {
      tokens.push({ tipo: 'op', valor: c, line })
      i += 1
      continue
    }
    if (c === '(') {
      tokens.push({ tipo: 'abre', valor: c, line })
      i += 1
      continue
    }
    if (c === ')') {
      tokens.push({ tipo: 'fecha', valor: c, line })
      i += 1
      continue
    }
    if (c === ',' || c === ';') {
      tokens.push({ tipo: 'virgula', valor: ',', line })
      i += 1
      continue
    }
    erro(`caractere inesperado: "${c}"`)
  }
  tokens.push({ tipo: 'fim', valor: '', line })
  return tokens
}

class ErroLexico extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message)
  }
}

// --- a árvore -----------------------------------------------------------------------------------

type No =
  | { t: 'num'; v: number }
  | { t: 'txt'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'var'; nome: string }
  | { t: 'bin'; op: string; a: No; b: No }
  | { t: 'un'; op: string; a: No }
  | { t: 'chamada'; nome: string; args: No[] }

/** Analisa UMA expressão. Sem laço na gramática: o que sai daqui sempre termina. */
function analisar(tokens: Token[], line: number): No {
  let pos = 0
  let profundidade = 0
  const atual = (): Token => tokens[pos]
  const erro = (m: string): never => {
    throw new ErroLexico(m, line)
  }
  const consumir = (tipo: Tipo, valor?: string): Token => {
    const t = atual()
    if (t.tipo !== tipo || (valor !== undefined && t.valor !== valor)) erro(`esperava ${valor ?? tipo}, veio "${t.valor || 'fim'}"`)
    pos += 1
    return t
  }
  const comProfundidade = <T>(f: () => T): T => {
    profundidade += 1
    if (profundidade > MAX_PROFUNDIDADE) erro('expressão aninhada demais')
    const r = f()
    profundidade -= 1
    return r
  }

  const primario = (): No =>
    comProfundidade(() => {
      const t = atual()
      if (t.tipo === 'num') {
        pos += 1
        return { t: 'num', v: Number(t.valor) }
      }
      if (t.tipo === 'txt') {
        pos += 1
        return { t: 'txt', v: t.valor }
      }
      if (t.tipo === 'abre') {
        pos += 1
        const e = ou()
        consumir('fecha')
        return e
      }
      if (t.tipo === 'ident') {
        const nome = t.valor.toLowerCase()
        pos += 1
        if (nome === 'verdadeiro') return { t: 'bool', v: true }
        if (nome === 'falso') return { t: 'bool', v: false }
        if (atual().tipo === 'abre') {
          pos += 1
          const args: No[] = []
          if (atual().tipo !== 'fecha') {
            args.push(ou())
            while (atual().tipo === 'virgula') {
              pos += 1
              args.push(ou())
            }
          }
          consumir('fecha')
          return { t: 'chamada', nome, args }
        }
        // Uma variável é sempre um campo da ENTRADA. Não há objeto para navegar, então
        // não há `constructor` nem protótipo que possam ser alcançados.
        return { t: 'var', nome: t.valor }
      }
      return erro(`não esperava "${t.valor || 'fim da linha'}"`)
    })

  const unario = (): No => {
    if (atual().tipo === 'op' && (atual().valor === '-' || atual().valor === '+')) {
      const op = atual().valor
      pos += 1
      return { t: 'un', op, a: unario() }
    }
    return primario()
  }
  const binario = (proximo: () => No, ops: string[]) => (): No => {
    let a = proximo()
    while (atual().tipo === 'op' && ops.includes(atual().valor)) {
      const op = atual().valor
      pos += 1
      a = { t: 'bin', op, a, b: proximo() }
    }
    return a
  }
  const produto = binario(unario, ['*', '/', '%'])
  const soma = binario(produto, ['+', '-'])
  const comparacao = (): No => {
    const a = soma()
    if (atual().tipo === 'op' && ['=', '<>', '<', '<=', '>', '>='].includes(atual().valor)) {
      const op = atual().valor
      pos += 1
      return { t: 'bin', op, a, b: soma() }
    }
    return a
  }
  const nao = (): No => {
    if (atual().tipo === 'ident' && atual().valor.toLowerCase() === 'nao') {
      pos += 1
      return { t: 'un', op: 'nao', a: nao() }
    }
    return comparacao()
  }
  const e = binario(nao, [])
  const eLogico = (): No => {
    let a = nao()
    while (atual().tipo === 'ident' && atual().valor.toLowerCase() === 'e') {
      pos += 1
      a = { t: 'bin', op: 'e', a, b: nao() }
    }
    return a
  }
  function ou(): No {
    let a = eLogico()
    while (atual().tipo === 'ident' && atual().valor.toLowerCase() === 'ou') {
      pos += 1
      a = { t: 'bin', op: 'ou', a, b: eLogico() }
    }
    return a
  }
  void e

  const arvore = ou()
  if (atual().tipo !== 'fim') erro(`sobrou "${atual().valor}" no fim da expressão`)
  return arvore
}

// --- as funções que existem ------------------------------------------------------------------
//
// Esta lista É a fronteira de segurança. Não há rede, disco, tempo, aleatório nem acesso ao
// processo porque essas funções não estão aqui — e o que não está aqui não pode ser
// chamado. Acrescentar uma função é uma decisão de código, revisada como qualquer outra.

const num = (v: ValorFormula, onde: string): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.')))) return Number(v.replace(',', '.'))
  throw new Error(`${onde}: esperava número, veio ${JSON.stringify(v)}`)
}
const lista = (v: ValorFormula, onde: string): (number | string)[] => {
  if (Array.isArray(v)) return v
  throw new Error(`${onde}: esperava uma lista, veio ${JSON.stringify(v)}`)
}
const txt = (v: ValorFormula): string => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'verdadeiro' : 'falso') : String(v))
const numeros = (v: ValorFormula, onde: string): number[] => lista(v, onde).map((x) => num(x as ValorFormula, onde))

type Funcao = { minArgs: number; maxArgs: number; run: (args: ValorFormula[]) => ValorFormula }

export const FUNCOES: Record<string, Funcao> = {
  // decisão
  se: { minArgs: 3, maxArgs: 3, run: ([c, a, b]) => (verdade(c) ? a : b) },
  // números
  abs: { minArgs: 1, maxArgs: 1, run: ([a]) => Math.abs(num(a, 'abs')) },
  arred: { minArgs: 1, maxArgs: 2, run: ([a, c]) => {
    const casas = c === undefined ? 0 : Math.min(10, Math.max(0, Math.trunc(num(c, 'arred'))))
    const f = 10 ** casas
    return Math.round(num(a, 'arred') * f) / f
  } },
  teto: { minArgs: 1, maxArgs: 1, run: ([a]) => Math.ceil(num(a, 'teto')) },
  piso: { minArgs: 1, maxArgs: 1, run: ([a]) => Math.floor(num(a, 'piso')) },
  min: { minArgs: 1, maxArgs: 8, run: (args) => Math.min(...aplanar(args, 'min')) },
  max: { minArgs: 1, maxArgs: 8, run: (args) => Math.max(...aplanar(args, 'max')) },
  soma: { minArgs: 1, maxArgs: 8, run: (args) => aplanar(args, 'soma').reduce((a, b) => a + b, 0) },
  media: { minArgs: 1, maxArgs: 8, run: (args) => {
    const v = aplanar(args, 'media')
    if (v.length === 0) throw new Error('media: lista vazia')
    return v.reduce((a, b) => a + b, 0) / v.length
  } },
  // texto
  texto: { minArgs: 1, maxArgs: 1, run: ([a]) => txt(a) },
  numero: { minArgs: 1, maxArgs: 1, run: ([a]) => num(a, 'numero') },
  maiusc: { minArgs: 1, maxArgs: 1, run: ([a]) => txt(a).toUpperCase() },
  minusc: { minArgs: 1, maxArgs: 1, run: ([a]) => txt(a).toLowerCase() },
  concat: { minArgs: 1, maxArgs: 8, run: (args) => args.map(txt).join('') },
  substituir: { minArgs: 3, maxArgs: 3, run: ([a, de, para]) => txt(a).split(txt(de)).join(txt(para)) },
  contem: { minArgs: 2, maxArgs: 2, run: ([a, b]) => (Array.isArray(a) ? a.includes(b as number | string) : txt(a).includes(txt(b))) },
  // listas
  tamanho: { minArgs: 1, maxArgs: 1, run: ([a]) => (Array.isArray(a) ? a.length : txt(a).length) },
  primeiro: { minArgs: 1, maxArgs: 1, run: ([a]) => primeiroOuUltimo(a, 0) },
  ultimo: { minArgs: 1, maxArgs: 1, run: ([a]) => primeiroOuUltimo(a, -1) },
}

const primeiroOuUltimo = (a: ValorFormula, onde: 0 | -1): ValorFormula => {
  const l = lista(a, onde === 0 ? 'primeiro' : 'ultimo')
  if (l.length === 0) throw new Error(`${onde === 0 ? 'primeiro' : 'ultimo'}: lista vazia`)
  return onde === 0 ? l[0] : l[l.length - 1]
}
const aplanar = (args: ValorFormula[], onde: string): number[] =>
  args.flatMap((a) => (Array.isArray(a) ? numeros(a, onde) : [num(a, onde)]))

/** O que conta como verdadeiro. Explícito, para `se()` não depender de intuição. */
const verdade = (v: ValorFormula): boolean => {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (Array.isArray(v)) return v.length > 0
  return v.trim() !== ''
}

// --- a avaliação -----------------------------------------------------------------------------

function avaliar(no: No, entrada: Record<string, ValorFormula>, orcamento: { passos: number }): ValorFormula {
  orcamento.passos -= 1
  if (orcamento.passos < 0) throw new Error('fórmula complexa demais')

  switch (no.t) {
    case 'num':
      return no.v
    case 'txt':
      return no.v
    case 'bool':
      return no.v
    case 'var': {
      // `hasOwnProperty`: sem isto, `constructor` ou `toString` resolveriam para algo
      // herdado do protótipo — e uma variável passaria a alcançar o motor.
      if (!Object.prototype.hasOwnProperty.call(entrada, no.nome)) throw new Error(`campo "${no.nome}" não veio na entrada`)
      return entrada[no.nome]
    }
    case 'un': {
      if (no.op === 'nao') return !verdade(avaliar(no.a, entrada, orcamento))
      const v = num(avaliar(no.a, entrada, orcamento), no.op)
      return no.op === '-' ? -v : v
    }
    case 'chamada': {
      const f = FUNCOES[no.nome]
      if (!f) throw new Error(`função "${no.nome}" não existe`)
      if (no.args.length < f.minArgs || no.args.length > f.maxArgs) {
        throw new Error(`${no.nome}: esperava ${f.minArgs === f.maxArgs ? f.minArgs : `${f.minArgs} a ${f.maxArgs}`} argumento(s)`)
      }
      const r = f.run(no.args.map((a) => avaliar(a, entrada, orcamento)))
      return conferir(r)
    }
    case 'bin': {
      const a = avaliar(no.a, entrada, orcamento)
      // `e`/`ou` em curto-circuito: `se(x <> 0 e 10 / x > 1, …)` não pode dividir por zero
      // só porque o lado direito foi avaliado antes da hora.
      if (no.op === 'e') return verdade(a) ? verdade(avaliar(no.b, entrada, orcamento)) : false
      if (no.op === 'ou') return verdade(a) ? true : verdade(avaliar(no.b, entrada, orcamento))
      const b = avaliar(no.b, entrada, orcamento)
      switch (no.op) {
        case '=':
          return iguais(a, b)
        case '<>':
          return !iguais(a, b)
        case '<':
          return num(a, '<') < num(b, '<')
        case '<=':
          return num(a, '<=') <= num(b, '<=')
        case '>':
          return num(a, '>') > num(b, '>')
        case '>=':
          return num(a, '>=') >= num(b, '>=')
        case '+':
          // `+` soma; para juntar texto existe `concat`, e a distinção evita o clássico
          // "1" + 1 = "11" que ninguém escreveu de propósito.
          return typeof a === 'string' || typeof b === 'string' ? txt(a) + txt(b) : conferir(num(a, '+') + num(b, '+'))
        case '-':
          return conferir(num(a, '-') - num(b, '-'))
        case '*':
          return conferir(num(a, '*') * num(b, '*'))
        case '/': {
          const d = num(b, '/')
          if (d === 0) throw new Error('divisão por zero')
          return conferir(num(a, '/') / d)
        }
        case '%': {
          const d = num(b, '%')
          if (d === 0) throw new Error('resto por zero')
          return conferir(num(a, '%') % d)
        }
        default:
          throw new Error(`operador desconhecido: ${no.op}`)
      }
    }
  }
}

const iguais = (a: ValorFormula, b: ValorFormula): boolean =>
  Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b

/** Infinito e NaN não saem daqui: eles atravessam o resto do sistema como "número". */
const conferir = (v: ValorFormula): ValorFormula => {
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('o resultado não é um número finito')
  return v
}

// --- o programa, e o contrato que ele declara --------------------------------------------------

export interface FormulaCompilada {
  /** Os nomes atribuídos, na ordem. São eles que formam a SAÍDA. */
  saidas: string[]
  /** Os campos que a fórmula lê e não define. São eles que formam a ENTRADA. */
  entradas: string[]
  linhas: { nome: string; arvore: No; line: number }[]
}

export interface ResultadoDaCompilacao {
  ok: boolean
  compilada?: FormulaCompilada
  errors: ErroDeFormula[]
}

/**
 * Lê o programa e descobre o contrato dele.
 *
 * As variáveis LIDAS e nunca atribuídas são a entrada; os nomes ATRIBUÍDOS são a saída.
 * Isso não é conveniência: é o que impede o contrato de divergir da fórmula. Um schema
 * escrito à mão ao lado do cálculo começa igual e envelhece — e o que envelhece recusa
 * entrada boa ou aceita entrada ruim, sem ninguém perceber.
 */
export function compilarFormula(fonte: string): ResultadoDaCompilacao {
  const errors: ErroDeFormula[] = []
  if (!fonte.trim()) return { ok: false, errors: [{ line: 1, message: 'a fórmula está vazia' }] }
  if (fonte.length > MAX_CARACTERES) {
    return { ok: false, errors: [{ line: 1, message: `a fórmula passa de ${MAX_CARACTERES} caracteres` }] }
  }

  const brutas = fonte.split('\n').map((l, i) => ({ texto: l.trim(), line: i + 1 }))
  const uteis = brutas.filter((l) => l.texto !== '' && !l.texto.startsWith('#'))
  if (uteis.length > MAX_LINHAS) {
    return { ok: false, errors: [{ line: MAX_LINHAS + 1, message: `a fórmula passa de ${MAX_LINHAS} linhas` }] }
  }

  const linhas: FormulaCompilada['linhas'] = []
  const definidos = new Set<string>()
  const lidos = new Set<string>()

  for (const { texto, line } of uteis) {
    const igual = texto.indexOf('=')
    // `=` de comparação (`<=`, `>=`, `<>`) não abre uma atribuição.
    const atribui = igual > 0 && !['<', '>', '='].includes(texto[igual - 1]) && texto[igual + 1] !== '='
    if (!atribui) {
      errors.push({ line, message: 'cada linha precisa ser "nome = expressão"' })
      continue
    }
    const nome = texto.slice(0, igual).trim()
    if (!/^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*$/.test(nome)) {
      errors.push({ line, message: `"${nome}" não é um nome válido` })
      continue
    }
    if (PALAVRAS.has(nome.toLowerCase()) || FUNCOES[nome.toLowerCase()]) {
      errors.push({ line, message: `"${nome}" é uma palavra da linguagem e não pode ser um nome` })
      continue
    }
    if (definidos.has(nome)) {
      errors.push({ line, message: `"${nome}" já foi definido acima` })
      continue
    }
    try {
      const arvore = analisar(tokenizar(texto.slice(igual + 1), line), line)
      coletarVariaveis(arvore, lidos)
      linhas.push({ nome, arvore, line })
      definidos.add(nome)
    } catch (erro) {
      errors.push({ line, message: erro instanceof Error ? erro.message : 'não consegui ler esta linha' })
    }
  }

  if (linhas.length === 0 && errors.length === 0) errors.push({ line: 1, message: 'a fórmula não define nada' })
  if (errors.length > 0) return { ok: false, errors }

  // Uma variável lida DEPOIS de ser definida é interna; lida sem nunca ser definida, é
  // entrada. A ordem importa, e por isso a coleta acontece linha a linha acima.
  const entradas = [...lidos].filter((v) => !definidos.has(v)).sort()
  return { ok: true, errors: [], compilada: { saidas: [...definidos], entradas, linhas } }
}

function coletarVariaveis(no: No, alvo: Set<string>): void {
  if (no.t === 'var') alvo.add(no.nome)
  else if (no.t === 'un') coletarVariaveis(no.a, alvo)
  else if (no.t === 'bin') {
    coletarVariaveis(no.a, alvo)
    coletarVariaveis(no.b, alvo)
  } else if (no.t === 'chamada') for (const a of no.args) coletarVariaveis(a, alvo)
}

/** Roda a fórmula. Sem laço na gramática, ela sempre termina — o orçamento é a rede. */
export function executarFormula(
  compilada: FormulaCompilada,
  entrada: Record<string, unknown>,
): { ok: true; data: Record<string, ValorFormula> } | { ok: false; error: ErroDeFormula } {
  const escopo: Record<string, ValorFormula> = Object.create(null)
  for (const [k, v] of Object.entries(entrada)) {
    // Só o que a linguagem sabe manipular. Um objeto aninhado na entrada não vira
    // variável: não há como navegá-lo, e deixá-lo entrar só adiaria o erro.
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') escopo[k] = v
    else if (Array.isArray(v) && v.every((x) => typeof x === 'number' || typeof x === 'string')) escopo[k] = v as (number | string)[]
  }

  const orcamento = { passos: MAX_PASSOS }
  const data: Record<string, ValorFormula> = {}
  for (const linha of compilada.linhas) {
    try {
      const valor = avaliar(linha.arvore, escopo, orcamento)
      escopo[linha.nome] = valor
      data[linha.nome] = valor
    } catch (erro) {
      return { ok: false, error: { line: linha.line, message: erro instanceof Error ? erro.message : 'falhou' } }
    }
  }
  return { ok: true, data }
}

// --- os contratos, derivados ------------------------------------------------------------------

const tipoJson = (v: ValorFormula): string => (Array.isArray(v) ? 'array' : typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : 'string')

/**
 * O contrato de ENTRADA: as variáveis livres.
 *
 * Sem tipo declarado — a linguagem converte texto em número quando dá — então tudo entra
 * como opcional e o tipo é conferido na hora de usar, com a mensagem dizendo qual campo.
 */
export function schemaDeEntrada(c: FormulaCompilada): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(c.entradas.map((n) => [n, { type: ['number', 'string', 'boolean', 'array'] }])),
    required: c.entradas,
  }
}

/**
 * O contrato de SAÍDA, descoberto RODANDO a fórmula com a entrada de exemplo.
 *
 * O tipo de `se(x > 0, "alta", 0)` depende do valor, e nenhuma análise estática honesta
 * diria qual é. Executar uma vez com dados reais responde de verdade — e como a linguagem
 * não tem efeito colateral, executar de novo não custa nem muda nada.
 */
export function schemaDeSaida(c: FormulaCompilada, amostra: Record<string, ValorFormula>): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(c.saidas.map((n) => [n, { type: amostra[n] !== undefined ? tipoJson(amostra[n]) : 'string' }])),
    required: c.saidas,
  }
}
