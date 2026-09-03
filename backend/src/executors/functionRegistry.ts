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
// Puros os dois, e é o que permite importá-los aqui: este arquivo não pode arrastar
// banco nenhum. `mapping.ts` faria isso (ele importa `building.js`), por isso o guarda
// de caminho abaixo é local em vez de reaproveitado de lá.
import { evaluateCondition, readPath } from '../automations/conditions.js'

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
  /**
   * QUEM está executando — quando há um agente.
   *
   * Existe porque algumas leituras são concedidas por agente, e não por conta: uma
   * fonte em tempo real vinculada ao agente A não pode ser lida pelo agente B da mesma
   * conta só porque os dois são do mesmo dono. Opcional de propósito: uma função pura,
   * ou uma execução sem agente, continua funcionando sem ele.
   */
  agentId?: string
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
  /**
   * Quando a função consome uma SÉRIE — o que permite que ela vire indicador derivado.
   *
   * O plano precisa saber duas coisas para ligar "fechamentos" a "RSI" sem inventar nada:
   * qual argumento recebe a série, e quantos pontos a conta exige. As duas são conhecimento
   * da função, não de quem a chama — e declará-las aqui é o que evita a alternativa, que
   * seria o compilador guardar uma lista de nomes de argumento por função.
   */
  series?: SeriesInput
}

export interface SeriesInput {
  /** O argumento que recebe a série, do mais ANTIGO para o mais recente. */
  arg: string
  /** O parâmetro que define o tamanho da janela, quando ela é configurável. */
  windowParam?: string
  /** Quantos pontos além da janela a conta exige. */
  extra: number
  /** O mínimo quando a janela não é informada — o padrão da função. */
  minimum: number
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
  /** Presente quando a função consome uma série. Ver `SeriesInput`. */
  series?: SeriesInput
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
      ...(f.series ? { series: f.series } : {}),
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


// ============================================================================
// Transformar dados — o trabalho que hoje gasta um modelo para virar aritmética
// ============================================================================
//
// Agrupar uma lista, filtrar por condição, conferir se um payload serve e recortar
// campos são as quatro coisas que aparecem em quase todo fluxo. Feitas por modelo, cada
// uma custa uma inferência, demora, e devolve resultado diferente para a mesma entrada —
// que é o oposto do que um relatório precisa.

/** Teto de itens. Uma lista sem limite é a memória do processo na mão de quem chama. */
const MAX_ITENS = 1_000

/**
 * O caminho, conferido aqui mesmo.
 *
 * A mesma regra de `normalizeMappingPath`, escrita de novo de propósito: aquele módulo
 * importa `building.js`, que abre o banco, e este arquivo existe para ser puro. Nove
 * linhas duplicadas custam menos que arrastar o Mongo para dentro da fronteira.
 */
const PROTOTIPO = new Set(['__proto__', 'constructor', 'prototype'])
function caminhoSeguro(bruto: unknown, campo: string): string {
  const p = String(bruto ?? '').trim().replace(/^\$\.?/, '')
  if (!p) throw new ErroDeFuncao(`${campo}: informe o campo.`)
  if (p.length > 200) throw new ErroDeFuncao(`${campo}: caminho longo demais.`)
  if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+|\[\d+\])*$/.test(p)) {
    throw new ErroDeFuncao(`${campo}: use um caminho simples, como "cliente.nome" — sem expressão nem código.`)
  }
  if (p.split(/[.[\]]/).some((parte) => PROTOTIPO.has(parte))) throw new ErroDeFuncao(`${campo}: caminho não permitido.`)
  return p
}

const listaDe = (bruto: unknown, campo = 'items'): Record<string, unknown>[] => {
  if (!Array.isArray(bruto)) throw new ErroDeFuncao(`${campo}: envie uma lista.`)
  if (bruto.length > MAX_ITENS) throw new ErroDeFuncao(`${campo}: no máximo ${MAX_ITENS} itens por chamada.`)
  return bruto.map((i) => (i && typeof i === 'object' && !Array.isArray(i) ? (i as Record<string, unknown>) : { valor: i }))
}

const numero = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const OPERACOES = ['soma', 'contagem', 'media', 'minimo', 'maximo', 'primeiro', 'ultimo'] as const
type Operacao = (typeof OPERACOES)[number]

registerFunction({
  functionName: 'lista.agrupar',
  version: '1.0.0',
  description: 'Agrupa uma lista por um campo e calcula soma, contagem, média, mínimo, máximo, primeiro ou último por grupo.',
  capabilities: ['dados', 'cálculo'],
  inputSchema: {
    type: 'object',
    properties: {
      items: { type: 'array', description: 'A lista a agrupar.' },
      por: { type: 'string', minLength: 1, description: 'O campo que define o grupo, ex.: loja' },
      operacoes: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            de: { type: 'string', description: 'O campo a calcular. Não usado em "contagem".' },
            op: { type: 'string', enum: [...OPERACOES] },
            como: { type: 'string', description: 'O nome do resultado, ex.: faturamento' },
          },
          required: ['op', 'como'],
        },
      },
    },
    required: ['items', 'por'],
  },
  outputSchema: {
    type: 'object',
    properties: { count: { type: 'number' }, grupos: { type: 'array', items: { type: 'object', additionalProperties: true } } },
    additionalProperties: false,
  },
  timeoutMs: 5_000,
  handler: async (input) => {
    const items = listaDe(input.items)
    const por = caminhoSeguro(input.por, 'por')
    const regras = (Array.isArray(input.operacoes) ? input.operacoes : []).map((o, i) => {
      const item = (o ?? {}) as Record<string, unknown>
      const op = String(item.op ?? '') as Operacao
      if (!OPERACOES.includes(op)) throw new ErroDeFuncao(`operação ${i + 1}: "${String(item.op)}" não existe.`)
      return { de: op === 'contagem' ? '' : caminhoSeguro(item.de, `operação ${i + 1}`), op, como: String(item.como ?? `r${i + 1}`).slice(0, 60) }
    })

    // `Map` preserva a ordem de aparição: o primeiro grupo a surgir é o primeiro a sair.
    // Ordenar por conta própria mudaria o resultado sem ninguém pedir.
    const grupos = new Map<string, Record<string, unknown>[]>()
    for (const item of items) {
      const chave = String(readPath(item, por) ?? '—')
      const atual = grupos.get(chave)
      if (atual) atual.push(item)
      else grupos.set(chave, [item])
    }

    const saida = [...grupos.entries()].map(([chave, doGrupo]) => {
      const linha: Record<string, unknown> = { chave, itens: doGrupo.length }
      for (const r of regras) {
        if (r.op === 'contagem') {
          linha[r.como] = doGrupo.length
          continue
        }
        const valores = doGrupo.map((i) => readPath(i, r.de))
        if (r.op === 'primeiro') linha[r.como] = valores[0] ?? null
        else if (r.op === 'ultimo') linha[r.como] = valores[valores.length - 1] ?? null
        else {
          // Só o que é número entra na conta. Um campo vazio não vira zero: zero é um
          // valor, e somá-lo mudaria a média de quem não respondeu.
          const numeros = valores.map(numero).filter((n): n is number => n !== null)
          if (r.op === 'soma') linha[r.como] = numeros.reduce((a, b) => a + b, 0)
          else if (r.op === 'media') linha[r.como] = numeros.length ? numeros.reduce((a, b) => a + b, 0) / numeros.length : null
          else if (r.op === 'minimo') linha[r.como] = numeros.length ? Math.min(...numeros) : null
          else if (r.op === 'maximo') linha[r.como] = numeros.length ? Math.max(...numeros) : null
        }
      }
      return linha
    })
    return { count: saida.length, grupos: saida }
  },
})

registerFunction({
  functionName: 'lista.filtrar',
  version: '1.0.0',
  description: 'Filtra uma lista por condições — igual, diferente, contém, maior, menor, existe.',
  capabilities: ['dados'],
  inputSchema: {
    type: 'object',
    properties: {
      items: { type: 'array' },
      condicoes: {
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            caminho: { type: 'string', description: 'O campo, ex.: cliente.plano' },
            operador: { type: 'string', enum: ['exists', 'absent', 'equals', 'not_equals', 'contains', 'gt', 'lt'] },
            valor: {},
          },
          required: ['caminho', 'operador'],
        },
      },
      modo: { type: 'string', enum: ['todas', 'qualquer'], description: 'Precisa passar em todas ou em pelo menos uma. Padrão: todas.' },
    },
    required: ['items', 'condicoes'],
  },
  outputSchema: {
    type: 'object',
    properties: { count: { type: 'number' }, removidos: { type: 'number' }, items: { type: 'array' } },
    additionalProperties: false,
  },
  timeoutMs: 5_000,
  handler: async (input) => {
    const items = listaDe(input.items)
    const brutas = Array.isArray(input.condicoes) ? input.condicoes : []
    if (!brutas.length) throw new ErroDeFuncao('condicoes: informe ao menos uma — sem nenhuma, nada seria filtrado.')
    const condicoes = brutas.map((c, i) => {
      const item = (c ?? {}) as Record<string, unknown>
      return { source: 'item', path: caminhoSeguro(item.caminho, `condição ${i + 1}`), operator: String(item.operador ?? 'exists'), value: item.valor }
    })
    const qualquer = input.modo === 'qualquer'
    // O avaliador é o MESMO das rotinas: um "maior que" aqui decide igual a um "maior
    // que" lá, e falha fechada do mesmo jeito.
    const passa = (item: Record<string, unknown>) =>
      qualquer
        ? condicoes.some((c) => evaluateCondition(c as never, { item }))
        : condicoes.every((c) => evaluateCondition(c as never, { item }))
    const mantidos = items.filter(passa)
    return { count: mantidos.length, removidos: items.length - mantidos.length, items: mantidos }
  },
})

registerFunction({
  functionName: 'dados.validar',
  version: '1.0.0',
  description: 'Confere se um dado bate com o formato esperado (JSON Schema) e diz o que está faltando ou errado.',
  capabilities: ['dados', 'validação'],
  inputSchema: {
    type: 'object',
    properties: {
      /**
       * Qualquer forma: objeto, lista, texto, número.
       *
       * `additionalProperties: true` é o que permite isso — sem ele, o validador entra
       * no ramo de objeto e recusa TODA chave, porque não há `properties` declaradas.
       * Um schema vazio aqui reprovaria justamente o dado que se quer conferir.
       */
      dados: { additionalProperties: true, description: 'O valor a conferir.' },
      schema: { type: 'object', additionalProperties: true, description: 'O formato esperado, em JSON Schema.' },
    },
    required: ['dados', 'schema'],
  },
  outputSchema: {
    type: 'object',
    properties: { valido: { type: 'boolean' }, erros: { type: 'array', items: { type: 'string' } } },
    additionalProperties: false,
  },
  timeoutMs: 5_000,
  handler: async (input) => {
    // O MESMO validador que confere argumento de ferramenta. Um segundo validador
    // divergiria do primeiro, e aí "válido" passaria a significar duas coisas.
    const r = validateAgainstSchema(input.schema, input.dados)
    return { valido: r.valid, erros: r.valid ? [] : describeErrors(r.errors).split('; ').filter(Boolean) }
  },
})

registerFunction({
  functionName: 'json.selecionar',
  version: '1.0.0',
  description: 'Recorta só os campos que interessam de um objeto — inclusive campos aninhados.',
  capabilities: ['dados'],
  inputSchema: {
    type: 'object',
    properties: {
      dados: { type: 'object', additionalProperties: true },
      campos: { type: 'array', maxItems: 30, items: { type: 'string' }, description: 'Ex.: ["cliente.nome", "total"]' },
      achatar: { type: 'boolean', description: 'Devolver "cliente_nome" em vez de aninhado. Padrão: sim.' },
    },
    required: ['dados', 'campos'],
  },
  outputSchema: { type: 'object', properties: { resultado: { type: 'object', additionalProperties: true } }, additionalProperties: false },
  timeoutMs: 5_000,
  handler: async (input) => {
    const campos = (Array.isArray(input.campos) ? input.campos : []).map((c, i) => caminhoSeguro(c, `campo ${i + 1}`))
    if (!campos.length) throw new ErroDeFuncao('campos: informe ao menos um.')
    const achatar = input.achatar !== false
    const resultado: Record<string, unknown> = {}
    for (const c of campos) {
      const lido = readPath(input.dados, c)
      // Campo ausente não vira `null`: ele simplesmente não aparece. Um nulo diria "o
      // valor é vazio", que é outra coisa.
      if (lido === undefined) continue
      if (achatar) resultado[c.replace(/[.[\]]/g, '_')] = lido
      else {
        const partes = c.split('.')
        let alvo = resultado
        for (const parte of partes.slice(0, -1)) {
          if (typeof alvo[parte] !== 'object' || alvo[parte] === null) alvo[parte] = {}
          alvo = alvo[parte] as Record<string, unknown>
        }
        alvo[partes[partes.length - 1]] = lido
      }
    }
    return { resultado }
  },
})

// ============================================================================
// Mais transformação: ordenar, cruzar, limpar texto, formatar e ler série
// ============================================================================

registerFunction({
  functionName: 'lista.ordenar',
  version: '1.0.0',
  description: 'Ordena uma lista por um campo, crescente ou decrescente, e pode devolver só os primeiros.',
  capabilities: ['dados'],
  inputSchema: {
    type: 'object',
    properties: {
      items: { type: 'array' },
      por: { type: 'string', minLength: 1, description: 'Ex.: total' },
      ordem: { type: 'string', enum: ['crescente', 'decrescente'] },
      limite: { type: 'integer', minimum: 1, maximum: 1000, description: 'Quantos devolver. Ex.: 10' },
    },
    required: ['items', 'por'],
  },
  outputSchema: { type: 'object', properties: { count: { type: 'number' }, items: { type: 'array' } }, additionalProperties: false },
  timeoutMs: 5_000,
  handler: async (input) => {
    const items = listaDe(input.items)
    const por = caminhoSeguro(input.por, 'por')
    const desc = input.ordem === 'decrescente'
    const ordenada = [...items].sort((a, b) => {
      const x = readPath(a, por)
      const y = readPath(b, por)
      const nx = numero(x)
      const ny = numero(y)
      // Número compara como número; o resto, como texto. Comparar "10" com "9" como
      // texto poria o 10 antes, que é a armadilha clássica de ordenação.
      const r = nx !== null && ny !== null ? nx - ny : String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR')
      return desc ? -r : r
    })
    const limite = Number(input.limite ?? 0)
    return { count: ordenada.length, items: limite > 0 ? ordenada.slice(0, limite) : ordenada }
  },
})

registerFunction({
  functionName: 'lista.unicos',
  version: '1.0.0',
  description: 'Remove repetidos de uma lista, comparando por um campo. Fica o primeiro de cada.',
  capabilities: ['dados'],
  inputSchema: {
    type: 'object',
    properties: { items: { type: 'array' }, por: { type: 'string', minLength: 1, description: 'Ex.: email' } },
    required: ['items', 'por'],
  },
  outputSchema: {
    type: 'object',
    properties: { count: { type: 'number' }, removidos: { type: 'number' }, items: { type: 'array' } },
    additionalProperties: false,
  },
  timeoutMs: 5_000,
  handler: async (input) => {
    const items = listaDe(input.items)
    const por = caminhoSeguro(input.por, 'por')
    const vistos = new Set<string>()
    const unicos: Record<string, unknown>[] = []
    for (const item of items) {
      const chave = JSON.stringify(readPath(item, por) ?? null)
      if (vistos.has(chave)) continue
      vistos.add(chave)
      unicos.push(item)
    }
    return { count: unicos.length, removidos: items.length - unicos.length, items: unicos }
  },
})

registerFunction({
  functionName: 'lista.juntar',
  version: '1.0.0',
  description: 'Cruza duas listas por uma chave — como um PROCV. Traz os campos da segunda para a primeira.',
  capabilities: ['dados'],
  inputSchema: {
    type: 'object',
    properties: {
      items: { type: 'array', description: 'A lista principal.' },
      com: { type: 'array', description: 'A lista de onde trazer os campos.' },
      chave: { type: 'string', minLength: 1, description: 'O campo em comum. Ex.: id' },
      chaveDe: { type: 'string', description: 'O campo na segunda lista, quando tem outro nome.' },
      somenteComPar: { type: 'boolean', description: 'Descartar quem não encontrou par. Padrão: não.' },
    },
    required: ['items', 'com', 'chave'],
  },
  outputSchema: {
    type: 'object',
    properties: { count: { type: 'number' }, semPar: { type: 'number' }, items: { type: 'array' } },
    additionalProperties: false,
  },
  timeoutMs: 5_000,
  handler: async (input) => {
    const items = listaDe(input.items)
    const outros = listaDe(input.com, 'com')
    const chave = caminhoSeguro(input.chave, 'chave')
    const chaveDe = input.chaveDe ? caminhoSeguro(input.chaveDe, 'chaveDe') : chave

    // Índice pelo lado MENOR? Não: pelo lado de referência, sempre. Uma escolha
    // condicional mudaria qual duplicata vence e o resultado deixaria de ser previsível.
    const indice = new Map<string, Record<string, unknown>>()
    for (const o of outros) {
      const k = String(readPath(o, chaveDe) ?? '')
      if (!indice.has(k)) indice.set(k, o)
    }

    let semPar = 0
    const juntados: Record<string, unknown>[] = []
    for (const item of items) {
      const par = indice.get(String(readPath(item, chave) ?? ''))
      if (!par) {
        semPar += 1
        if (input.somenteComPar !== true) juntados.push(item)
        continue
      }
      // O item principal MANDA nos campos repetidos: quem chamou pediu para enriquecer
      // a primeira lista, não para sobrescrevê-la.
      juntados.push({ ...par, ...item })
    }
    return { count: juntados.length, semPar, items: juntados }
  },
})

registerFunction({
  functionName: 'json.mesclar',
  version: '1.0.0',
  description: 'Junta dois objetos. O segundo manda nos campos que existirem nos dois.',
  capabilities: ['dados'],
  inputSchema: {
    type: 'object',
    properties: {
      base: { type: 'object', additionalProperties: true },
      sobrepor: { type: 'object', additionalProperties: true },
      profundo: { type: 'boolean', description: 'Juntar também os objetos de dentro. Padrão: não.' },
    },
    required: ['base', 'sobrepor'],
  },
  outputSchema: { type: 'object', properties: { resultado: { type: 'object', additionalProperties: true } }, additionalProperties: false },
  timeoutMs: 5_000,
  handler: async (input) => {
    const limpo = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
    const juntar = (a: Record<string, unknown>, b: Record<string, unknown>, nivel = 0): Record<string, unknown> => {
      const fora: Record<string, unknown> = { ...a }
      for (const [k, v] of Object.entries(b)) {
        // Nomes que mexem no protótipo não entram — nem no primeiro nível, nem nos de
        // dentro. É o único ponto desta função onde um objeto de fora vira chave.
        if (PROTOTIPO.has(k)) continue
        const atual = fora[k]
        fora[k] =
          input.profundo === true && nivel < 5 && atual && typeof atual === 'object' && !Array.isArray(atual) && v && typeof v === 'object' && !Array.isArray(v)
            ? juntar(atual as Record<string, unknown>, v as Record<string, unknown>, nivel + 1)
            : v
      }
      return fora
    }
    return { resultado: juntar(limpo(input.base), limpo(input.sobrepor)) }
  },
})

registerFunction({
  functionName: 'texto.normalizar',
  version: '1.0.0',
  description: 'Limpa um texto: tira espaços sobrando, acentos, deixa em minúsculas ou vira um identificador.',
  capabilities: ['texto'],
  inputSchema: {
    type: 'object',
    properties: {
      texto: { type: 'string' },
      forma: { type: 'string', enum: ['limpo', 'minusculas', 'sem_acento', 'identificador'], description: 'Padrão: limpo' },
    },
    required: ['texto'],
  },
  outputSchema: { type: 'object', properties: { resultado: { type: 'string' } }, additionalProperties: false },
  timeoutMs: 3_000,
  handler: async (input) => {
    const limpo = String(input.texto ?? '').trim().replace(/\s+/g, ' ')
    const forma = String(input.forma ?? 'limpo')
    if (forma === 'limpo') return { resultado: limpo }
    // `normalize('NFD')` separa a letra do acento; a faixa abaixo remove só o acento.
    const semAcento = limpo.normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (forma === 'sem_acento') return { resultado: semAcento }
    if (forma === 'minusculas') return { resultado: limpo.toLowerCase() }
    return { resultado: semAcento.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) }
  },
})

registerFunction({
  functionName: 'texto.preencher',
  version: '1.0.0',
  description: 'Preenche um modelo com os campos de um objeto: "Olá, {{nome}}" vira "Olá, Ana".',
  capabilities: ['texto'],
  inputSchema: {
    type: 'object',
    properties: {
      modelo: { type: 'string', description: 'Ex.: Olá, {{cliente.nome}}' },
      dados: { type: 'object', additionalProperties: true },
      manterFaltantes: { type: 'boolean', description: 'Deixar {{campo}} quando não houver valor. Padrão: não — vira vazio.' },
    },
    required: ['modelo', 'dados'],
  },
  outputSchema: {
    type: 'object',
    properties: { resultado: { type: 'string' }, faltantes: { type: 'array', items: { type: 'string' } } },
    additionalProperties: false,
  },
  timeoutMs: 3_000,
  handler: async (input) => {
    const faltantes: string[] = []
    const resultado = String(input.modelo ?? '').replace(/\{\{\s*([A-Za-z0-9_.]{1,80})\s*\}\}/g, (inteiro, caminho: string) => {
      // O caminho vem do MODELO, que é configuração — mas passa pelo mesmo guarda:
      // um modelo é texto, e texto pode ter sido colado de qualquer lugar.
      if (caminho.split('.').some((p) => PROTOTIPO.has(p))) return ''
      const valor = readPath(input.dados, caminho)
      if (valor === undefined || valor === null) {
        faltantes.push(caminho)
        return input.manterFaltantes === true ? inteiro : ''
      }
      return typeof valor === 'object' ? JSON.stringify(valor) : String(valor)
    })
    // Os faltantes saem à parte: um texto com buraco parece pronto, e quem chamou
    // precisa poder decidir se manda assim mesmo.
    return { resultado, faltantes: [...new Set(faltantes)] }
  },
})

/**
 * Os padrões que `texto.extrair` conhece — uma lista FECHADA.
 *
 * Aceitar expressão regular de quem chama seria dar a alguém de fora o poder de travar
 * o processo com uma expressão que não termina. Uma lista fechada cobre o que se extrai
 * de verdade e não tem esse risco.
 */
const PADROES: Record<string, RegExp> = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  url: /https?:\/\/[^\s<>"']{3,300}/g,
  numero: /-?\d+(?:[.,]\d+)?/g,
  cpf: /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g,
  cnpj: /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g,
  cep: /\d{5}-?\d{3}/g,
  telefone: /\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g,
  data: /\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/g,
}

registerFunction({
  functionName: 'texto.extrair',
  version: '1.0.0',
  description: 'Tira de um texto os e-mails, links, números, datas, CPF, CNPJ, CEP ou telefones que aparecerem.',
  capabilities: ['texto', 'dados'],
  inputSchema: {
    type: 'object',
    properties: {
      texto: { type: 'string' },
      tipo: { type: 'string', enum: Object.keys(PADROES) },
      limite: { type: 'integer', minimum: 1, maximum: 200 },
    },
    required: ['texto', 'tipo'],
  },
  outputSchema: {
    type: 'object',
    properties: { count: { type: 'number' }, encontrados: { type: 'array', items: { type: 'string' } } },
    additionalProperties: false,
  },
  timeoutMs: 3_000,
  handler: async (input) => {
    const padrao = PADROES[String(input.tipo ?? '')]
    if (!padrao) throw new ErroDeFuncao(`tipo: escolha um de ${Object.keys(PADROES).join(', ')}.`)
    const texto = String(input.texto ?? '').slice(0, 100_000)
    const limite = Math.min(Number(input.limite ?? 50), 200)
    // Repetidos saem: um e-mail citado três vezes é um e-mail.
    const encontrados = [...new Set(texto.match(new RegExp(padrao.source, 'g')) ?? [])].slice(0, limite)
    return { count: encontrados.length, encontrados }
  },
})

registerFunction({
  functionName: 'data.formatar',
  version: '1.0.0',
  description: 'Escreve uma data no fuso e no formato pedidos — o horário é o de quem lê, não o do servidor.',
  capabilities: ['data'],
  inputSchema: {
    type: 'object',
    properties: {
      data: { type: 'string', description: 'Ex.: 2026-03-10T14:00:00Z' },
      fuso: { type: 'string', description: 'Ex.: America/Sao_Paulo' },
      formato: { type: 'string', enum: ['data', 'data_hora', 'hora', 'dia_semana', 'iso'], description: 'Padrão: data_hora' },
      idioma: { type: 'string', description: 'Ex.: pt-BR' },
    },
    required: ['data'],
  },
  outputSchema: { type: 'object', properties: { resultado: { type: 'string' }, iso: { type: 'string' } }, additionalProperties: false },
  timeoutMs: 3_000,
  handler: async (input) => {
    const d = new Date(String(input.data ?? ''))
    if (Number.isNaN(d.getTime())) throw new ErroDeFuncao('data: use ISO 8601, como 2026-03-10T14:00:00Z.')
    const timeZone = String(input.fuso ?? 'UTC')
    const locale = String(input.idioma ?? 'pt-BR')
    const formato = String(input.formato ?? 'data_hora')
    if (formato === 'iso') return { resultado: d.toISOString(), iso: d.toISOString() }
    try {
      const opcoes: Record<string, Intl.DateTimeFormatOptions> = {
        data: { dateStyle: 'short' },
        data_hora: { dateStyle: 'short', timeStyle: 'short' },
        hora: { timeStyle: 'short' },
        dia_semana: { weekday: 'long' },
      }
      return { resultado: new Intl.DateTimeFormat(locale, { timeZone, ...opcoes[formato] }).format(d), iso: d.toISOString() }
    } catch {
      // Fuso ou idioma que o ambiente não conhece: a recusa diz qual, em vez de devolver
      // uma data no fuso errado — que passaria despercebida.
      throw new ErroDeFuncao(`fuso ou idioma desconhecido: "${timeZone}" / "${locale}".`)
    }
  },
})

registerFunction({
  functionName: 'math.serie',
  version: '1.0.0',
  description: 'Lê uma série de números: variação do começo ao fim, tendência, mediana e percentil.',
  capabilities: ['cálculo', 'dados'],
  inputSchema: {
    type: 'object',
    properties: {
      values: { type: 'array', items: { type: 'number' }, description: 'Os números, em ordem de tempo.' },
      percentil: { type: 'number', minimum: 0, maximum: 100, description: 'Ex.: 90' },
    },
    required: ['values'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      count: { type: 'number' },
      primeiro: {},
      ultimo: {},
      variacao: {},
      variacaoPercentual: {},
      tendencia: { type: 'string' },
      mediana: {},
      percentil: {},
    },
    additionalProperties: false,
  },
  timeoutMs: 5_000,
  handler: async (input) => {
    const brutos = Array.isArray(input.values) ? input.values : []
    if (brutos.length > MAX_ITENS) throw new ErroDeFuncao(`values: no máximo ${MAX_ITENS} números.`)
    const nums = brutos.map(numero).filter((n): n is number => n !== null)
    if (!nums.length) return { count: 0, primeiro: null, ultimo: null, variacao: null, variacaoPercentual: null, tendencia: 'sem_dados', mediana: null, percentil: null }

    const primeiro = nums[0]
    const ultimo = nums[nums.length - 1]
    const variacao = ultimo - primeiro
    // Sair de zero não tem variação percentual: dividir por zero daria infinito, e
    // "cresceu infinito por cento" não é resposta.
    const variacaoPercentual = primeiro === 0 ? null : (variacao / Math.abs(primeiro)) * 100
    const ordenados = [...nums].sort((a, b) => a - b)
    const meio = Math.floor(ordenados.length / 2)
    const mediana = ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2

    let percentil: number | null = null
    if (input.percentil !== undefined && input.percentil !== null) {
      const p = Math.min(Math.max(Number(input.percentil), 0), 100)
      // Interpolação linear: com poucos pontos, o índice inteiro devolve sempre o mesmo
      // valor para percentis diferentes, e o número pareceria não reagir.
      const pos = (p / 100) * (ordenados.length - 1)
      const baixo = Math.floor(pos)
      const alto = Math.ceil(pos)
      percentil = baixo === alto ? ordenados[baixo] : ordenados[baixo] + (ordenados[alto] - ordenados[baixo]) * (pos - baixo)
    }

    // "Estável" existe de propósito: sem ele, uma variação de um centavo viraria
    // "subindo", e quem lê agiria sobre ruído.
    const limite = Math.abs(primeiro) * 0.001
    const tendencia = Math.abs(variacao) <= limite ? 'estavel' : variacao > 0 ? 'subindo' : 'descendo'
    return { count: nums.length, primeiro, ultimo, variacao, variacaoPercentual, tendencia, mediana, percentil }
  },
})
