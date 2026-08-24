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
) => Promise<unknown> | unknown

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
// Duas, de propósito: elas provam o caminho inteiro (validação de entrada, execução,
// validação de saída, timeout) sem inventar comportamento de produto que ninguém pediu.
// O app de candles NÃO entra aqui — ele é assunto de outra fase.

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

registerFunction({
  functionName: 'text.wordCount',
  version: '1.0.0',
  description: 'Conta palavras e caracteres de um texto.',
  capabilities: ['texto'],
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  outputSchema: {
    type: 'object',
    properties: { words: { type: 'number' }, characters: { type: 'number' } },
    required: ['words', 'characters'],
  },
  timeoutMs: 2_000,
  handler: (input) => {
    const texto = String(input.text ?? '')
    return { words: texto.split(/\s+/).filter(Boolean).length, characters: texto.length }
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
