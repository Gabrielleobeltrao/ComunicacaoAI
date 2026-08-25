// As funções que um agente PODE executar — uma lista fechada, escrita em código.
//
// Este arquivo é a fronteira de segurança da Fase 2, e a regra é simples: o agente guarda
// uma CHAVE, e a chave só vale se estiver aqui. O que roda é código deste repositório,
// revisado como qualquer outro.
//
// O que NÃO existe aqui, e não pode passar a existir:
//
//   * `eval` e `new Function` — transformariam um campo de banco em código.
//   * Código vindo do frontend, sob qualquer forma.
//   * Caminho de módulo configurável: `import(x)` com `x` de fora é o mesmo problema com
//     outra roupa — quem escolhe o arquivo escolhe o que roda.
//   * Comando de shell.
//   * Script arbitrário em qualquer linguagem.
//
// A pergunta que separa o seguro do inseguro não é "o que a função faz", é "quem
// escolheu o código". Aqui, sempre quem escreveu o repositório.
import { validateAgainstSchema, describeErrors } from '../jsonSchema.js'

/**
 * Um erro que o handler ESCOLHEU levantar — e cuja mensagem pode sair.
 *
 * A regra geral é que exceção não vaza: `stack` conta caminho de arquivo e mensagem crua
 * costuma carregar valor de variável. Mas "receita zero: a margem não é definida" foi
 * escrita por este repositório, para quem administra ler, e trocá-la por "falhou durante
 * a execução" apaga a única informação que permite consertar.
 *
 * A distinção é a intenção: o que o handler levanta de propósito sai; o que escapa dele
 * vira categoria.
 */
export class ErroDeFuncao extends Error {
  readonly deliberado = true
}

/**
 * O que roda de fato. Recebe dado validado e devolve dado — sem rede por padrão.
 *
 * `config` são os PARÂMETROS que o dono fixou no agente (uma moeda, um arredondamento, um
 * limite). Dados, nunca segredo: uma credencial aqui ficaria em texto claro no documento
 * do agente, e um documento vazado viraria acesso vazado. O executor recusa chaves que
 * pareçam credencial antes de chamar o handler.
 *
 * SOBRE O TETO DE TEMPO: ele corre num `setTimeout` do mesmo processo. Isso interrompe a
 * ESPERA por uma promessa, não a CPU de um laço síncrono — um handler que trava o event
 * loop trava o servidor inteiro, e nenhum timeout aqui salva. Handler registrado é código
 * deste repositório justamente por isso: mantenha-o não bloqueante, e o trabalho pesado
 * atrás de um adaptador (ver `FunctionAdapter`), em outro processo.
 */
export type FunctionHandler = (
  input: Record<string, unknown>,
  config?: Record<string, unknown>,
  /**
   * De QUEM é a execução.
   *
   * A maioria das funções é pura e ignora isto. As que leem estado da conta — o dado ao
   * vivo de uma conexão, por exemplo — precisam do dono no filtro, e recebê-lo por
   * parâmetro é o que torna impossível esquecer: sem ele não há consulta.
   *
   * Ausente só no caminho de teste; o despachante sempre passa.
   */
  ctx?: FunctionContext,
) => Promise<unknown> | unknown

export interface FunctionContext {
  ownerId: string
}

export interface RegisteredFunction {
  /** A chave que o agente guarda. Estável: mudá-la quebra os agentes que a usam. */
  functionName: string
  version: string
  description: string
  /** Para o mesmo catálogo de competências que o resto do sistema usa. */
  capabilities: string[]
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  /**
   * Os PARÂMETROS que o dono pode fixar — declarados, e por isso geráveis como formulário.
   *
   * Sem isto a única forma de oferecer `config` seria um editor JSON livre: o dono digita
   * o que quiser, o handler recebe o que vier, e nada diz quais campos existem. Com o
   * schema, a tela mostra os campos certos e o servidor recusa o resto.
   *
   * Só tipos simples, e nunca segredo: uma credencial aqui ficaria em texto claro no
   * documento do agente. Credencial vive na conexão do App.
   */
  configSchema?: Record<string, unknown>
  handler: FunctionHandler
  /** Teto de tempo. Uma função sem teto é uma execução que pode não terminar. */
  timeoutMs: number
  /**
   * Metadados SEGUROS — o que pode aparecer numa tela ou num log.
   *
   * Nada de caminho de arquivo, endereço interno ou nome de variável de ambiente: o
   * catálogo é lido pelo formulário, e o que está aqui é o que sai para o cliente.
   */
  metadata?: Record<string, string>
}

/**
 * Um executor de OUTRO tipo de função — worker Python, serviço de modelo, o que vier.
 *
 * A interface existe para que a Fase 3 tenha onde encaixar sem mexer no executor. O que
 * ela NÃO faz, e é o ponto: não recebe código. Recebe o NOME de uma função que o outro
 * lado já conhece, exatamente como aqui. Um adaptador que aceitasse script seria a mesma
 * porta que este arquivo existe para fechar.
 */
export interface FunctionAdapter {
  readonly name: string
  supports(functionName: string): boolean
  invoke(functionName: string, input: Record<string, unknown>, opts: { timeoutMs: number }): Promise<unknown>
}

const registro = new Map<string, RegisteredFunction>()
const adaptadores: FunctionAdapter[] = []

/** Registra uma função. Chamado só por este repositório, na carga do módulo. */
export function registerFunction(fn: RegisteredFunction): void {
  if (registro.has(fn.functionName)) {
    throw new Error(`função duplicada no registry: ${fn.functionName}`)
  }
  registro.set(fn.functionName, fn)
}

/** Registra um adaptador externo. Nenhum existe ainda; a porta fica preparada. */
export function registerAdapter(adapter: FunctionAdapter): void {
  adaptadores.push(adapter)
}

export const findFunction = (functionName: string): RegisteredFunction | null => registro.get(functionName) ?? null

export const findAdapterFor = (functionName: string): FunctionAdapter | null =>
  adaptadores.find((a) => a.supports(functionName)) ?? null

/**
 * O catálogo, para o formulário.
 *
 * Sem `handler`: ele é código, e código não vai para o cliente. Sem nada além do que
 * descreve a função — é a mesma lista que a tela mostra e que a validação usa.
 */
export interface PublicFunction {
  functionName: string
  version: string
  description: string
  capabilities: string[]
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  /** Os parâmetros configuráveis. Ausente = a função não aceita nenhum. */
  configSchema: Record<string, unknown> | null
  timeoutMs: number
  metadata: Record<string, string>
}

export const listPublicFunctions = (): PublicFunction[] =>
  [...registro.values()]
    .map((f) => ({
      functionName: f.functionName,
      version: f.version,
      description: f.description,
      capabilities: f.capabilities,
      inputSchema: f.inputSchema,
      outputSchema: f.outputSchema,
      configSchema: f.configSchema ?? null,
      timeoutMs: f.timeoutMs,
      metadata: f.metadata ?? {},
    }))
    .sort((a, b) => a.functionName.localeCompare(b.functionName))

/** Só para teste: o registry é montado na carga, e um teste precisa poder isolá-lo. */
export function __resetRegistry(): void {
  registro.clear()
  adaptadores.length = 0
}

// --- as funções que existem hoje --------------------------------------------------------------
//
// Todas têm a mesma propriedade, e é ela que justifica não passarem por um modelo: a
// resposta é EXATA e sempre a mesma. Um modelo calculando margem ou conferindo um dígito
// de CNPJ acerta quase sempre — e "quase sempre" numa conta é o pior resultado possível,
// porque o erro sai com a mesma cara do acerto.
//
// Nenhuma delas lê relógio. `data.*` recebe as duas datas explicitamente: uma função que
// consultasse "hoje" devolveria resposta diferente amanhã com a mesma entrada, e aí a
// promessa de determinismo — que é o motivo de tudo isto existir — deixaria de valer.

const NUMEROS_SCHEMA = {
  type: 'object',
  properties: { values: { type: 'array', items: { type: 'number' } } },
  required: ['values'],
} as const

registerFunction({
  functionName: 'math.summary',
  version: '1.0.0',
  description: 'Soma, média, mínimo e máximo de uma lista de números.',
  capabilities: ['cálculo', 'estatística'],
  inputSchema: NUMEROS_SCHEMA as unknown as Record<string, unknown>,
  outputSchema: {
    type: 'object',
    properties: {
      count: { type: 'number' },
      sum: { type: 'number' },
      average: { type: 'number' },
      min: { type: 'number' },
      max: { type: 'number' },
    },
    required: ['count', 'sum', 'average', 'min', 'max'],
  },
  timeoutMs: 2_000,
  /**
   * Um parâmetro de verdade, para o formulário gerado ter o que mostrar — e para o caminho
   * `config` ficar exercitado por uma função que existe, e não só por teste.
   */
  configSchema: {
    type: 'object',
    properties: {
      decimals: { type: 'integer', minimum: 0, maximum: 6, description: 'Casas decimais da média' },
    },
  },
  handler: (input, config) => {
    const casas = typeof config?.decimals === 'number' ? config.decimals : null
    const values = (input.values as number[]) ?? []
    if (values.length === 0) return { count: 0, sum: 0, average: 0, min: 0, max: 0 }
    const sum = values.reduce((a, b) => a + b, 0)
    const media = sum / values.length
    return {
      count: values.length,
      sum,
      average: casas === null ? media : Number(media.toFixed(casas)),
      min: Math.min(...values),
      max: Math.max(...values),
    }
  },
})

// --- documentos brasileiros --------------------------------------------------------------------
//
// O dígito verificador é o ponto: um modelo aceita "11.111.111/1111-11" como CNPJ porque
// ele PARECE um. A conta não aceita. E um cadastro que entra com documento inválido só é
// descoberto quando alguém tenta emitir a nota.

const digitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

/** O algoritmo de módulo 11, comum ao CPF e ao CNPJ — mudam só os pesos. */
const modulo11 = (base: string, pesos: number[]): number => {
  const soma = base.split('').reduce((acc, d, i) => acc + Number(d) * pesos[i], 0)
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

const DOC_SAIDA = {
  type: 'object',
  properties: { valido: { type: 'boolean' }, formatado: { type: 'string' }, limpo: { type: 'string' }, motivo: { type: 'string' } },
  required: ['valido', 'formatado', 'limpo', 'motivo'],
} as const

registerFunction({
  functionName: 'br.cpf',
  version: '1.0.0',
  description: 'Valida um CPF pelo dígito verificador e devolve formatado.',
  capabilities: ['documento', 'cadastro', 'validação'],
  inputSchema: { type: 'object', properties: { cpf: { type: 'string' } }, required: ['cpf'] },
  outputSchema: DOC_SAIDA as unknown as Record<string, unknown>,
  timeoutMs: 1_000,
  handler: (input) => {
    const n = digitos(input.cpf)
    if (n.length !== 11) return { valido: false, formatado: '', limpo: n, motivo: `esperava 11 dígitos, veio ${n.length}` }
    // Todos iguais passa na conta e não é CPF de ninguém — é o caso que o algoritmo sozinho deixa entrar.
    if (/^(\d)\1{10}$/.test(n)) return { valido: false, formatado: '', limpo: n, motivo: 'todos os dígitos iguais' }
    const d1 = modulo11(n.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2])
    const d2 = modulo11(n.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
    if (Number(n[9]) !== d1 || Number(n[10]) !== d2) return { valido: false, formatado: '', limpo: n, motivo: 'dígito verificador não confere' }
    return { valido: true, formatado: `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`, limpo: n, motivo: '' }
  },
})

registerFunction({
  functionName: 'br.cnpj',
  version: '1.0.0',
  description: 'Valida um CNPJ pelo dígito verificador e devolve formatado.',
  capabilities: ['documento', 'cadastro', 'validação'],
  inputSchema: { type: 'object', properties: { cnpj: { type: 'string' } }, required: ['cnpj'] },
  outputSchema: DOC_SAIDA as unknown as Record<string, unknown>,
  timeoutMs: 1_000,
  handler: (input) => {
    const n = digitos(input.cnpj)
    if (n.length !== 14) return { valido: false, formatado: '', limpo: n, motivo: `esperava 14 dígitos, veio ${n.length}` }
    if (/^(\d)\1{13}$/.test(n)) return { valido: false, formatado: '', limpo: n, motivo: 'todos os dígitos iguais' }
    const d1 = modulo11(n.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    const d2 = modulo11(n.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    if (Number(n[12]) !== d1 || Number(n[13]) !== d2) return { valido: false, formatado: '', limpo: n, motivo: 'dígito verificador não confere' }
    return {
      valido: true,
      formatado: `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`,
      limpo: n,
      motivo: '',
    }
  },
})

registerFunction({
  functionName: 'br.cep',
  version: '1.0.0',
  description: 'Confere o formato de um CEP e devolve formatado. Não consulta endereço.',
  capabilities: ['documento', 'cadastro', 'endereço'],
  inputSchema: { type: 'object', properties: { cep: { type: 'string' } }, required: ['cep'] },
  outputSchema: DOC_SAIDA as unknown as Record<string, unknown>,
  timeoutMs: 1_000,
  handler: (input) => {
    const n = digitos(input.cep)
    // CEP não tem dígito verificador: dá para conferir o FORMATO, e é só isso que esta
    // função promete. Saber se ele existe exige consultar os Correios — outra coisa,
    // com rede, e o lugar disso é uma Ferramenta.
    if (n.length !== 8) return { valido: false, formatado: '', limpo: n, motivo: `esperava 8 dígitos, veio ${n.length}` }
    return { valido: true, formatado: `${n.slice(0, 5)}-${n.slice(5)}`, limpo: n, motivo: '' }
  },
})

registerFunction({
  functionName: 'br.telefone',
  version: '1.0.0',
  description: 'Confere e formata um telefone brasileiro, com DDD.',
  capabilities: ['documento', 'cadastro', 'contato'],
  inputSchema: { type: 'object', properties: { telefone: { type: 'string' } }, required: ['telefone'] },
  outputSchema: {
    type: 'object',
    properties: {
      valido: { type: 'boolean' },
      formatado: { type: 'string' },
      limpo: { type: 'string' },
      celular: { type: 'boolean' },
      motivo: { type: 'string' },
    },
    required: ['valido', 'formatado', 'limpo', 'celular', 'motivo'],
  },
  timeoutMs: 1_000,
  handler: (input) => {
    let n = digitos(input.telefone)
    if (n.startsWith('55') && n.length > 11) n = n.slice(2)
    const ruim = (motivo: string) => ({ valido: false, formatado: '', limpo: n, celular: false, motivo })
    if (n.length !== 10 && n.length !== 11) return ruim(`esperava 10 ou 11 dígitos com DDD, veio ${n.length}`)
    const ddd = Number(n.slice(0, 2))
    if (ddd < 11 || ddd > 99) return ruim(`DDD inválido: ${n.slice(0, 2)}`)
    // Celular tem 9 dígitos e começa com 9. Fixo tem 8 e começa de 2 a 5.
    const celular = n.length === 11
    if (celular && n[2] !== '9') return ruim('celular precisa começar com 9 depois do DDD')
    if (!celular && !'2345'.includes(n[2])) return ruim('fixo precisa começar de 2 a 5 depois do DDD')
    const corpo = n.slice(2)
    const meio = celular ? corpo.slice(0, 5) : corpo.slice(0, 4)
    return { valido: true, formatado: `(${n.slice(0, 2)}) ${meio}-${corpo.slice(meio.length)}`, limpo: n, celular, motivo: '' }
  },
})

// --- dinheiro e percentual ----------------------------------------------------------------------
//
// Arredondamento explícito em todas: dinheiro com casa decimal sobrando é diferença que
// aparece na conciliação, e o padrão de 2 casas é o que qualquer nota fiscal espera.

const arredondar = (v: number, casas: number): number => {
  const f = 10 ** casas
  return Math.round((v + Number.EPSILON) * f) / f
}
const casasDe = (config: Record<string, unknown> | undefined): number => {
  const c = config?.casas
  return typeof c === 'number' ? Math.min(6, Math.max(0, Math.trunc(c))) : 2
}
const CONFIG_CASAS = {
  type: 'object',
  properties: { casas: { type: 'integer', minimum: 0, maximum: 6, description: 'Casas decimais do resultado (padrão 2)' } },
} as const

registerFunction({
  functionName: 'financeiro.margem',
  version: '1.0.0',
  description: 'Lucro e margem percentual a partir de receita e custo.',
  capabilities: ['financeiro', 'cálculo', 'margem'],
  inputSchema: {
    type: 'object',
    properties: { receita: { type: 'number' }, custo: { type: 'number' } },
    required: ['receita', 'custo'],
  },
  outputSchema: {
    type: 'object',
    properties: { lucro: { type: 'number' }, margemPercentual: { type: 'number' } },
    required: ['lucro', 'margemPercentual'],
  },
  configSchema: CONFIG_CASAS as unknown as Record<string, unknown>,
  timeoutMs: 1_000,
  handler: (input, config) => {
    const receita = Number(input.receita)
    const custo = Number(input.custo)
    // Receita zero não tem margem definida. Devolver 0 ou 100 seria inventar um número
    // que alguém usaria para decidir.
    if (receita === 0) throw new ErroDeFuncao('receita zero: a margem não é definida')
    const casas = casasDe(config)
    const lucro = receita - custo
    return { lucro: arredondar(lucro, casas), margemPercentual: arredondar((lucro / receita) * 100, casas) }
  },
})

registerFunction({
  functionName: 'financeiro.percentual',
  version: '1.0.0',
  description: 'Aplica um percentual sobre um valor: comissão, desconto, acréscimo ou imposto.',
  capabilities: ['financeiro', 'cálculo', 'comissão', 'desconto', 'imposto'],
  inputSchema: {
    type: 'object',
    properties: {
      valor: { type: 'number' },
      percentual: { type: 'number' },
      operacao: { type: 'string', enum: ['calcular', 'acrescentar', 'descontar'] },
    },
    required: ['valor', 'percentual'],
  },
  outputSchema: {
    type: 'object',
    properties: { parte: { type: 'number' }, total: { type: 'number' } },
    required: ['parte', 'total'],
  },
  configSchema: CONFIG_CASAS as unknown as Record<string, unknown>,
  timeoutMs: 1_000,
  handler: (input, config) => {
    const casas = casasDe(config)
    const valor = Number(input.valor)
    const parte = (valor * Number(input.percentual)) / 100
    const operacao = typeof input.operacao === 'string' ? input.operacao : 'calcular'
    const total = operacao === 'acrescentar' ? valor + parte : operacao === 'descontar' ? valor - parte : parte
    return { parte: arredondar(parte, casas), total: arredondar(total, casas) }
  },
})

registerFunction({
  functionName: 'financeiro.converter',
  version: '1.0.0',
  description: 'Converte um valor por uma taxa informada. Não consulta cotação.',
  capabilities: ['financeiro', 'cálculo', 'moeda', 'conversão'],
  inputSchema: {
    type: 'object',
    properties: { valor: { type: 'number' }, taxa: { type: 'number' } },
    required: ['valor', 'taxa'],
  },
  outputSchema: { type: 'object', properties: { convertido: { type: 'number' } }, required: ['convertido'] },
  configSchema: CONFIG_CASAS as unknown as Record<string, unknown>,
  timeoutMs: 1_000,
  handler: (input, config) => {
    // A TAXA vem de fora. Buscar cotação é rede, e rede não é assunto de função — quem
    // precisa de cotação do dia usa uma Ferramenta, ou um pesquisador com busca na web.
    const taxa = Number(input.taxa)
    if (taxa <= 0) throw new ErroDeFuncao('a taxa precisa ser maior que zero')
    return { convertido: arredondar(Number(input.valor) * taxa, casasDe(config)) }
  },
})

// --- classificar em faixas -----------------------------------------------------------------------

registerFunction({
  functionName: 'regra.faixa',
  version: '1.0.0',
  description: 'Classifica um número numa faixa que você define no agente (score, risco, prioridade).',
  capabilities: ['classificação', 'regra', 'faixa'],
  inputSchema: { type: 'object', properties: { valor: { type: 'number' } }, required: ['valor'] },
  outputSchema: {
    type: 'object',
    properties: { faixa: { type: 'string' }, corte: { type: 'number' } },
    required: ['faixa', 'corte'],
  },
  /**
   * A REGRA fica no agente, não no prompt.
   *
   * Um modelo classificando por faixa muda de opinião entre execuções — e a faixa é
   * justamente o tipo de decisão que precisa ser a mesma toda vez, porque alguém vai
   * comparar dois resultados depois.
   */
  configSchema: {
    type: 'object',
    properties: {
      faixas: {
        type: 'string',
        description: 'Cortes e rótulos, do menor para o maior. Ex.: 0:baixo, 500:medio, 1000:alto',
      },
    },
    required: ['faixas'],
  },
  timeoutMs: 1_000,
  handler: (input, config) => {
    const bruto = String(config?.faixas ?? '').trim()
    if (!bruto) throw new ErroDeFuncao('configure as faixas no agente, no formato "0:baixo, 500:medio"')
    const faixas = bruto.split(',').map((par) => {
      const [corte, ...rotulo] = par.split(':')
      const n = Number(String(corte).trim())
      const r = rotulo.join(':').trim()
      if (!Number.isFinite(n) || !r) throw new ErroDeFuncao(`faixa inválida: "${par.trim()}" — use "corte:rótulo"`)
      return { corte: n, rotulo: r }
    })
    faixas.sort((a, b) => a.corte - b.corte)
    const valor = Number(input.valor)
    // A ÚLTIMA faixa cujo corte o valor alcança. Abaixo da primeira é erro, e não um
    // rótulo escolhido por conveniência: quem configurou não previu este caso.
    const escolhida = [...faixas].reverse().find((f) => valor >= f.corte)
    if (!escolhida) throw new ErroDeFuncao(`${valor} está abaixo do menor corte configurado (${faixas[0].corte})`)
    return { faixa: escolhida.rotulo, corte: escolhida.corte }
  },
})

// --- datas e prazos --------------------------------------------------------------------------------
//
// Nenhuma lê o relógio. Uma função que consultasse "hoje" devolveria resposta diferente
// amanhã com a mesma entrada — e o determinismo é o motivo de tudo isto existir. Quem
// precisa de "hoje" passa a data na entrada.

const DIA = 86_400_000
const lerData = (v: unknown, campo: string): Date => {
  const bruto = String(v ?? '').trim()
  // ISO (2026-08-24) ou brasileiro (24/08/2026). Sem hora: prazo se conta em dias.
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(bruto)
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : bruto
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new ErroDeFuncao(`${campo}: use AAAA-MM-DD ou DD/MM/AAAA`)
  const d = new Date(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) throw new ErroDeFuncao(`${campo}: data inexistente`)
  // `2026-02-31` vira 3 de março silenciosamente. A volta pega isso.
  if (d.toISOString().slice(0, 10) !== iso) throw new ErroDeFuncao(`${campo}: data inexistente`)
  return d
}
const emISO = (d: Date): string => d.toISOString().slice(0, 10)

registerFunction({
  functionName: 'data.diferenca',
  version: '1.0.0',
  description: 'Dias entre duas datas, e se a segunda já passou da primeira.',
  capabilities: ['data', 'prazo', 'cálculo'],
  inputSchema: { type: 'object', properties: { de: { type: 'string' }, ate: { type: 'string' } }, required: ['de', 'ate'] },
  outputSchema: {
    type: 'object',
    properties: { dias: { type: 'number' }, vencido: { type: 'boolean' }, de: { type: 'string' }, ate: { type: 'string' } },
    required: ['dias', 'vencido', 'de', 'ate'],
  },
  timeoutMs: 1_000,
  handler: (input) => {
    const de = lerData(input.de, 'de')
    const ate = lerData(input.ate, 'ate')
    const dias = Math.round((ate.getTime() - de.getTime()) / DIA)
    return { dias, vencido: dias < 0, de: emISO(de), ate: emISO(ate) }
  },
})

registerFunction({
  functionName: 'data.somar',
  version: '1.0.0',
  description: 'Soma dias a uma data. Pode contar só dias úteis (segunda a sexta).',
  capabilities: ['data', 'prazo', 'vencimento'],
  inputSchema: {
    type: 'object',
    properties: { data: { type: 'string' }, dias: { type: 'integer' }, apenasUteis: { type: 'boolean' } },
    required: ['data', 'dias'],
  },
  outputSchema: {
    type: 'object',
    properties: { data: { type: 'string' }, diaDaSemana: { type: 'string' } },
    required: ['data', 'diaDaSemana'],
  },
  timeoutMs: 1_000,
  handler: (input) => {
    const inicio = lerData(input.data, 'data')
    const dias = Math.trunc(Number(input.dias))
    if (!Number.isFinite(dias) || Math.abs(dias) > 3_650) throw new ErroDeFuncao('dias: use um valor entre -3650 e 3650')
    const uteis = input.apenasUteis === true
    let d = new Date(inicio.getTime())
    if (!uteis) d = new Date(inicio.getTime() + dias * DIA)
    else {
      // Feriado NÃO entra: o calendário muda por município e por ano, e uma lista
      // desatualizada daria um vencimento errado com cara de certo.
      const passo = dias >= 0 ? 1 : -1
      let restam = Math.abs(dias)
      while (restam > 0) {
        d = new Date(d.getTime() + passo * DIA)
        const semana = d.getUTCDay()
        if (semana !== 0 && semana !== 6) restam -= 1
      }
    }
    const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
    return { data: emISO(d), diaDaSemana: nomes[d.getUTCDay()] }
  },
})

registerFunction({
  functionName: 'data.idade',
  version: '1.0.0',
  description: 'Idade em anos completos entre a data de nascimento e uma data de referência.',
  capabilities: ['data', 'cálculo'],
  inputSchema: {
    type: 'object',
    properties: { nascimento: { type: 'string' }, referencia: { type: 'string' } },
    required: ['nascimento', 'referencia'],
  },
  outputSchema: { type: 'object', properties: { anos: { type: 'number' } }, required: ['anos'] },
  timeoutMs: 1_000,
  handler: (input) => {
    // `referencia` é OBRIGATÓRIA de propósito: sem ela a função leria o relógio, e a mesma
    // entrada passaria a dar resposta diferente conforme o dia.
    const nasc = lerData(input.nascimento, 'nascimento')
    const ref = lerData(input.referencia, 'referencia')
    if (ref < nasc) throw new ErroDeFuncao('a referência é anterior ao nascimento')
    let anos = ref.getUTCFullYear() - nasc.getUTCFullYear()
    const fezAniversario =
      ref.getUTCMonth() > nasc.getUTCMonth() || (ref.getUTCMonth() === nasc.getUTCMonth() && ref.getUTCDate() >= nasc.getUTCDate())
    if (!fezAniversario) anos -= 1
    return { anos }
  },
})

/** Conferência de contrato: uma função cujo schema não valida seria um contrato de mentira. */
/** Os tipos que o formulário gerado sabe desenhar. Prometer mais seria prometer o que não há. */
const TIPOS_DE_CONFIG = new Set(['string', 'number', 'integer', 'boolean'])
/** A mesma peneira de nomes do executor: parâmetro não é lugar de credencial. */
const CONFIG_PROIBIDA = /(authorization|api[-_]?key|apikey|token|secret|password|senha|credential|cookie|private[-_]?key)/i

export function assertRegistryIsSound(): void {
  for (const f of registro.values()) {
    for (const [nome, schema] of [
      ['inputSchema', f.inputSchema],
      ['outputSchema', f.outputSchema],
    ] as const) {
      const r = validateAgainstSchema(schema, undefined)
      // `validateAgainstSchema` com valor indefinido só falha por schema quebrado; o que
      // interessa aqui é que ele consiga ser interpretado.
      if (r.errors.some((e) => /schema/i.test(e.message))) {
        throw new Error(`${f.functionName}: ${nome} inválido — ${describeErrors(r.errors)}`)
      }
    }
    /**
     * O `configSchema` gera um FORMULÁRIO, e um formulário só desenha o que ele sabe
     * desenhar. Um tipo fora da lista viraria um campo em branco na tela; um nome que
     * pareça credencial viraria uma credencial em texto claro no documento do agente.
     */
    if (f.configSchema) {
      const props = (f.configSchema as { properties?: Record<string, unknown> }).properties ?? {}
      for (const [campo, def] of Object.entries(props)) {
        if (CONFIG_PROIBIDA.test(campo)) {
          throw new Error(`${f.functionName}: configSchema.${campo} parece uma credencial — credenciais ficam na conexão do App.`)
        }
        const tipo = (def as { type?: unknown })?.type
        if (typeof tipo !== 'string' || !TIPOS_DE_CONFIG.has(tipo)) {
          throw new Error(`${f.functionName}: configSchema.${campo} usa o tipo "${String(tipo)}", que o formulário não desenha.`)
        }
      }
    }
  }
}

