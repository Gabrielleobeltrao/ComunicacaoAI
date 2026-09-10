import { ErroDeFuncao, registerFunction } from './functionRegistry.js'

// A BIBLIOTECA BASE — as contas que aparecem em quase todo pedido.
//
// O catálogo tinha oito funções: ler histórico, ler valor ao vivo, calcular RSI. Qualquer
// coisa fora disso virava pendência — corretamente, e para sempre, porque ninguém estava
// enchendo a estante. "Buscar pelo id", "comparar dois valores", "quanto variou", "quantos
// de cada" são pedidos que voltam toda semana, com assuntos diferentes: bitcoin, estoque,
// pedidos, sensor. Escrever cada um na hora seria escrever o mesmo quatro vezes.
//
// Todas seguem a regra das que já existem, e é ela que faz uma função valer mais que um
// prompt:
//
//   MESMA ENTRADA, MESMA SAÍDA. Sempre. É o que permite comparar a leitura de hoje com a de
//   ontem e concluir alguma coisa da diferença.
//
//   DADO INSUFICIENTE É RECUSA, NÃO ESTIMATIVA. Uma variação sobre base zero não é infinita:
//   é uma pergunta mal formada, e dizer isso é mais útil que devolver um número.
//
//   NENHUMA FONTE ESCONDIDA. Nenhuma delas vai buscar dado em lugar nenhum. Elas recebem o
//   que alguém autorizado leu — quem lê é `data_history.*`, com as permissões daquele agente.

/** Um valor comparável sem ambiguidade. Objeto e lista ficam de fora de propósito. */
type Simples = string | number | boolean | null

const simples = (v: unknown): v is Simples => v === null || ['string', 'number', 'boolean'].includes(typeof v)

/**
 * O caminho dentro de um objeto — `preco`, `dados.preco`, `itens.0.valor`.
 *
 * Sem fundo demais e sem `__proto__`: um caminho vindo de fora é entrada, não código.
 */
function ler(objeto: Record<string, unknown>, caminho: string): unknown {
  const partes = String(caminho ?? '').split('.').filter(Boolean)
  if (!partes.length || partes.length > 12) return undefined
  let atual: unknown = objeto
  for (const p of partes) {
    if (p === '__proto__' || p === 'constructor' || p === 'prototype') return undefined
    if (atual === null || typeof atual !== 'object') return undefined
    atual = (atual as Record<string, unknown>)[p]
  }
  return atual
}

const numero = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const LISTA = {
  type: 'array' as const,
  maxItems: 5000,
  items: { type: 'object' as const, additionalProperties: true },
  description: 'Os registros. Quem os lê é data_history.range ou data_history.series, com as permissões de quem pediu.',
}

// --- buscar ----------------------------------------------------------------------------------

/**
 * ACHAR O REGISTRO por um campo — o "buscar pelo id" que faltava.
 *
 * Devolve o registro e QUANTOS bateram. O segundo número importa: um `id` que casa com três
 * registros não é um id, e quem chamou precisa saber disso antes de agir sobre o primeiro.
 */
registerFunction({
  functionName: 'registros.buscar',
  version: '1.0.0',
  description: 'Acha o registro cujo campo tem um valor — por id, por código, por nome. Diz quantos bateram.',
  capabilities: ['dados', 'buscar'],
  // Recebe tudo por parâmetro: nada de armazém, nada de rede.
  semAcessoADados: true,
  inputSchema: {
    type: 'object',
    properties: {
      registros: LISTA,
      campo: { type: 'string', description: 'Onde procurar, ex.: id ou dados.sku' },
      valor: { description: 'O valor procurado: texto, número ou booleano.' },
    },
    required: ['registros', 'campo', 'valor'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      encontrado: { type: 'boolean' },
      registro: { type: 'object', additionalProperties: true },
      quantos: { type: 'integer', description: 'Quantos registros bateram. Mais de um significa que o campo não é único.' },
    },
  },
  timeoutMs: 5_000,
  handler: async (input) => {
    const { registros, campo, valor } = input as { registros: Record<string, unknown>[]; campo: string; valor: unknown }
    if (!simples(valor)) throw new ErroDeFuncao('o valor procurado precisa ser texto, número ou booleano')
    const batem = (registros ?? []).filter((r) => {
      const lido = ler(r, campo)
      // Comparação por texto: uma fonte que entrega "77131.82" e outra 77131.82 falam do
      // mesmo número, e recusar isso seria transformar formato em ausência.
      return lido !== undefined && String(lido) === String(valor)
    })
    return { encontrado: batem.length > 0, registro: batem[0] ?? null, quantos: batem.length }
  },
})

// --- comparar --------------------------------------------------------------------------------

/**
 * COMPARAR DOIS NÚMEROS, com o resultado em palavras.
 *
 * A saída não é só `true`: ela diz a relação e a diferença. "Está acima" e "está 3,20 acima"
 * levam a decisões diferentes, e quem chamou não deveria ter de fazer a subtração de novo.
 */
registerFunction({
  functionName: 'valores.comparar',
  version: '1.0.0',
  description: 'Compara dois números: diz se é maior, menor ou igual, e por quanto — em valor e em porcentagem.',
  capabilities: ['calcular', 'comparar'],
  // Recebe tudo por parâmetro: nada de armazém, nada de rede.
  semAcessoADados: true,
  inputSchema: {
    type: 'object',
    properties: {
      valor: { type: 'number' },
      referencia: { type: 'number' },
      tolerancia: { type: 'number', minimum: 0, description: 'Diferença que ainda conta como igual. Padrão 0.' },
    },
    required: ['valor', 'referencia'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      relacao: { type: 'string', enum: ['maior', 'menor', 'igual'] },
      diferenca: { type: 'number' },
      variacaoPercentual: { type: ['number', 'null'] },
    },
  },
  timeoutMs: 5_000,
  handler: async (input) => {
    const { valor, referencia, tolerancia } = input as { valor: number; referencia: number; tolerancia?: number }
    const v = numero(valor)
    const r = numero(referencia)
    if (v === null || r === null) throw new ErroDeFuncao('valor e referência precisam ser números')
    const folga = Math.abs(numero(tolerancia) ?? 0)
    const diferenca = v - r
    const relacao = Math.abs(diferenca) <= folga ? 'igual' : diferenca > 0 ? 'maior' : 'menor'
    return {
      relacao,
      diferenca,
      // Base zero não dá porcentagem: "aumentou infinito" é uma pergunta mal formada, e
      // devolver `null` diz isso melhor do que um número inventado.
      variacaoPercentual: r === 0 ? null : (diferenca / Math.abs(r)) * 100,
    }
  },
})

/**
 * QUANTO VARIOU entre dois pontos de uma série.
 *
 * A pergunta que vem depois de toda série guardada: "subiu ou caiu desde ontem, e quanto?".
 */
registerFunction({
  functionName: 'serie.variacao',
  version: '1.0.0',
  description: 'A variação entre o primeiro e o último ponto de uma série: em valor e em porcentagem.',
  capabilities: ['calcular', 'dados'],
  // Recebe tudo por parâmetro: nada de armazém, nada de rede.
  semAcessoADados: true,
  inputSchema: {
    type: 'object',
    properties: {
      registros: LISTA,
      campo: { type: 'string', description: 'O campo numérico observado, ex.: preco' },
    },
    required: ['registros', 'campo'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      de: { type: 'number' },
      para: { type: 'number' },
      diferenca: { type: 'number' },
      variacaoPercentual: { type: ['number', 'null'] },
      pontos: { type: 'integer' },
    },
  },
  timeoutMs: 5_000,
  handler: async (input) => {
    const { registros, campo } = input as { registros: Record<string, unknown>[]; campo: string }
    const numeros = (registros ?? []).map((r) => numero(ler(r, campo))).filter((n): n is number => n !== null)
    // Um ponto não tem variação. Devolver zero diria "não mudou", que é diferente de "não dá
    // para saber" — e é a diferença entre uma decisão certa e uma errada.
    if (numeros.length < 2) {
      throw new ErroDeFuncao(`variação precisa de ao menos 2 pontos com "${campo}"; vieram ${numeros.length}`)
    }
    const de = numeros[0]
    const para = numeros[numeros.length - 1]
    const diferenca = para - de
    return { de, para, diferenca, variacaoPercentual: de === 0 ? null : (diferenca / Math.abs(de)) * 100, pontos: numeros.length }
  },
})

// --- contar ----------------------------------------------------------------------------------

/**
 * QUANTOS DE CADA — a contagem por categoria.
 *
 * "Quantos pedidos por status", "quantas leituras por sensor". Ordenado do maior para o
 * menor, porque quem pergunta isso quer saber qual é o maior.
 */
registerFunction({
  functionName: 'registros.contar_por',
  version: '1.0.0',
  description: 'Conta quantos registros existem de cada valor de um campo. Ordena do mais frequente para o menos.',
  capabilities: ['dados', 'calcular'],
  // Recebe tudo por parâmetro: nada de armazém, nada de rede.
  semAcessoADados: true,
  inputSchema: {
    type: 'object',
    properties: {
      registros: LISTA,
      campo: { type: 'string', description: 'O campo que separa os grupos, ex.: status' },
      limite: { type: 'integer', minimum: 1, maximum: 200, description: 'Quantos grupos devolver. Padrão 20.' },
    },
    required: ['registros', 'campo'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      grupos: { type: 'array', items: { type: 'object', properties: { valor: {}, quantos: { type: 'integer' } } } },
      total: { type: 'integer' },
      semValor: { type: 'integer', description: 'Registros em que o campo não existe. Contados à parte, nunca somados a um grupo.' },
    },
  },
  timeoutMs: 5_000,
  handler: async (input) => {
    const { registros, campo, limite } = input as { registros: Record<string, unknown>[]; campo: string; limite?: number }
    const contagem = new Map<string, number>()
    let semValor = 0
    for (const r of registros ?? []) {
      const lido = ler(r, campo)
      // Ausente não é um grupo chamado "undefined": ele é contado à parte, porque somá-lo a
      // um grupo inventaria uma categoria que ninguém tem.
      if (lido === undefined || lido === null) {
        semValor += 1
        continue
      }
      const chave = String(lido)
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1)
    }
    const grupos = [...contagem.entries()]
      .map(([valor, quantos]) => ({ valor, quantos }))
      // Empate resolvido pelo nome: sem isso, a mesma entrada daria ordens diferentes entre
      // duas chamadas, e uma função que muda de resposta não é determinística.
      .sort((a, b) => b.quantos - a.quantos || a.valor.localeCompare(b.valor))
      .slice(0, Math.min(Math.max(Number(limite) || 20, 1), 200))
    return { grupos, total: (registros ?? []).length, semValor }
  },
})

// --- filtrar ---------------------------------------------------------------------------------

/**
 * OS REGISTROS QUE PASSAM numa condição numérica.
 *
 * "Só os acima de 100", "só os abaixo do limite". A condição é uma lista fechada de
 * operadores: aceitar expressão livre aqui seria aceitar código vindo de fora.
 */
registerFunction({
  functionName: 'registros.filtrar',
  version: '1.0.0',
  description: 'Devolve os registros cujo campo numérico passa numa comparação: gt, gte, lt, lte, eq, ne.',
  capabilities: ['dados', 'buscar'],
  // Recebe tudo por parâmetro: nada de armazém, nada de rede.
  semAcessoADados: true,
  inputSchema: {
    type: 'object',
    properties: {
      registros: LISTA,
      campo: { type: 'string' },
      operador: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte', 'eq', 'ne'] },
      valor: { type: 'number' },
    },
    required: ['registros', 'campo', 'operador', 'valor'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      registros: { type: 'array', items: { type: 'object', additionalProperties: true } },
      quantos: { type: 'integer' },
      ignorados: { type: 'integer', description: 'Registros em que o campo não é número. Não passam nem reprovam: eles não têm o dado.' },
    },
  },
  timeoutMs: 5_000,
  handler: async (input) => {
    const { registros, campo, operador, valor } = input as {
      registros: Record<string, unknown>[]
      campo: string
      operador: string
      valor: number
    }
    const alvo = numero(valor)
    if (alvo === null) throw new ErroDeFuncao('o valor da comparação precisa ser um número')
    const passa: Record<string, unknown>[] = []
    let ignorados = 0
    for (const r of registros ?? []) {
      const n = numero(ler(r, campo))
      if (n === null) {
        ignorados += 1
        continue
      }
      const ok =
        operador === 'gt' ? n > alvo : operador === 'gte' ? n >= alvo : operador === 'lt' ? n < alvo : operador === 'lte' ? n <= alvo : operador === 'eq' ? n === alvo : n !== alvo
      if (ok) passa.push(r)
    }
    return { registros: passa, quantos: passa.length, ignorados }
  },
})
