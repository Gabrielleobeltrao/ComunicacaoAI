// O contrato de um agente: como ele executa, o que recebe e o que devolve.
//
// Puro. Lê o documento como ele está no banco — incluindo o de um agente criado antes de
// qualquer um destes campos existir — e devolve a forma normalizada. Nada é gravado aqui,
// e nada muda de comportamento: um agente antigo lê exatamente como se comportava.
//
// A regra que governa tudo: AUSENTE é o padrão de hoje. Um campo que falta nunca pode
// significar uma mudança — é o que permite adicionar isto sem migração destrutiva e sem
// tocar em um único documento existente.
import { describeErrors, isValidToolSchema, validateAgainstSchema } from '../jsonSchema.js'
import { findFunction } from './functionRegistry.js'
import type { ExecutorConfig, ExecutorKind, ResponseMode } from './types.js'

export const EXECUTOR_KINDS: ExecutorKind[] = ['llm', 'function', 'tool']
export const RESPONSE_MODES: ResponseMode[] = ['structured', 'text', 'structured_and_text']

/** O que o agente carrega hoje, e o que ele passa a poder carregar. */
export interface AgentContractInput {
  executorKind?: unknown
  responseMode?: unknown
  executorConfig?: unknown
  inputJsonSchema?: unknown
  outputJsonSchema?: unknown
  /** O campo ANTIGO. Continua existindo nesta fase; é dele que sai o padrão do novo. */
  defaultOutputFormat?: unknown
}

export interface AgentContract {
  executorKind: ExecutorKind
  responseMode: ResponseMode
  executorConfig: ExecutorConfig
  inputJsonSchema: Record<string, unknown> | null
  outputJsonSchema: Record<string, unknown> | null
}

/**
 * O modo de resposta que um agente TEM hoje, mesmo sem nunca ter ouvido falar do campo.
 *
 * `defaultOutputFormat: 'json'` já significa "quero dado" — e quem escolheu isso escolheu
 * `structured` sem saber. Qualquer outro valor (ou nenhum) é texto, que é como o sistema
 * sempre respondeu. A conversão é só de leitura: o campo antigo continua no documento,
 * porque apagá-lo nesta fase quebraria todo caminho que ainda o lê.
 */
export function responseModeFromLegacy(defaultOutputFormat: unknown): ResponseMode {
  return defaultOutputFormat === 'json' ? 'structured' : 'text'
}

/** O executor de um agente que não declara nenhum: o de sempre. */
export const DEFAULT_EXECUTOR: ExecutorConfig = { kind: 'llm' }

/**
 * A forma normalizada — sempre completa, nunca inventada.
 *
 * Um valor inválido cai no padrão em vez de derrubar a leitura: este caminho roda ao
 * carregar QUALQUER agente, e um documento estranho não pode tornar o agente inacessível.
 * A recusa acontece na ESCRITA (ver `parseAgentContract`), onde há alguém para avisar.
 */
export function agentContractOf(agent: AgentContractInput | null | undefined): AgentContract {
  const a = agent ?? {}
  const executorKind = EXECUTOR_KINDS.includes(a.executorKind as ExecutorKind) ? (a.executorKind as ExecutorKind) : 'llm'
  const declarado = RESPONSE_MODES.includes(a.responseMode as ResponseMode)
    ? (a.responseMode as ResponseMode)
    : responseModeFromLegacy(a.defaultOutputFormat)
  const outputJsonSchema = isValidToolSchema(a.outputJsonSchema) ? (a.outputJsonSchema as Record<string, unknown>) : null

  return {
    executorKind,
    responseMode: modoPossivel(executorKind, declarado, outputJsonSchema),
    executorConfig: normalizeExecutorConfig(executorKind, a.executorConfig),
    inputJsonSchema: isValidToolSchema(a.inputJsonSchema) ? (a.inputJsonSchema as Record<string, unknown>) : null,
    outputJsonSchema,
  }
}

/**
 * O modo que o executor CONSEGUE cumprir — não o que alguém escreveu.
 *
 * Uma função produz dado; prosa é trabalho de modelo. Um agente de função marcado como
 * "texto" prometia uma coisa e entregava outra, e o desencontro só aparecia na execução,
 * como resposta vazia ou como erro de contrato num lugar onde ninguém tinha o que
 * consertar. Aqui a promessa é ajustada ao que existe.
 *
 * Ferramenta é diferente: ela devolve o corpo de um terceiro. Só promete dado quando a
 * ação declara o formato; sem isso, o que ela tem é texto, e é isso que ela promete.
 */
function modoPossivel(kind: ExecutorKind, declarado: ResponseMode, outputSchema: Record<string, unknown> | null): ResponseMode {
  if (kind === 'function') return 'structured'
  if (kind === 'tool' && declarado !== 'text' && !outputSchema) return 'text'
  return declarado
}

/**
 * A configuração coerente com o TIPO — e só com ele.
 *
 * Guardar `functionName` num agente `llm` é guardar uma promessa que ninguém vai cumprir:
 * o campo fica lá, alguém o lê depois e conclui que o agente chama uma função. Cada tipo
 * carrega só o que lhe pertence.
 */
export function normalizeExecutorConfig(kind: ExecutorKind, bruto: unknown): ExecutorConfig {
  const cfg = (bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>

  if (kind === 'function') {
    return {
      kind: 'function',
      functionName: String(cfg.functionName ?? '').trim(),
      ...(typeof cfg.version === 'string' && cfg.version.trim() ? { version: cfg.version.trim() } : {}),
      // Dados, nunca segredo — e nunca código: o corpo da função vive no servidor.
      ...(cfg.config && typeof cfg.config === 'object' && !Array.isArray(cfg.config)
        ? { config: cfg.config as Record<string, unknown> }
        : {}),
    }
  }

  if (kind === 'tool') {
    return {
      kind: 'tool',
      ...(typeof cfg.toolId === 'string' && cfg.toolId.trim() ? { toolId: cfg.toolId.trim() } : {}),
      ...(typeof cfg.appKey === 'string' && cfg.appKey.trim() ? { appKey: cfg.appKey.trim() } : {}),
      ...(typeof cfg.actionKey === 'string' && cfg.actionKey.trim() ? { actionKey: cfg.actionKey.trim() } : {}),
    }
  }

  // `llm` não carrega configuração própria: provedor, modelo e `runConfig` já são campos
  // do agente. Duplicá-los aqui criaria duas verdades sobre qual modelo roda.
  return { kind: 'llm' }
}

// --- a escrita: aqui a recusa é possível, porque há alguém para avisar --------------------

export interface ContractParseResult {
  fields: Partial<{
    executorKind: ExecutorKind
    responseMode: ResponseMode
    executorConfig: ExecutorConfig
    inputJsonSchema: Record<string, unknown> | null
    /** Derivado do registro para uma função — nunca lido do que o cliente mandou. */
    outputJsonSchema: Record<string, unknown> | null
    /** Idem: as capacidades de um agente de função são as da função. */
    capabilities: string[]
  }>
  error?: string
}

/**
 * Valida o que veio na API. Só mexe no que FOI ENVIADO.
 *
 * Um payload antigo, sem nenhum destes campos, sai daqui sem nenhum campo — o agente é
 * gravado exatamente como sempre foi. É isso que mantém as APIs anteriores funcionando.
 */
/**
 * O contrato de uma FUNÇÃO vem do registro. Sempre.
 *
 * Deixar o cliente gravar os schemas de um agente de função cria duas verdades sobre o
 * que ela aceita: a do formulário e a do código que roda. Elas começam iguais e divergem
 * na primeira vez que a função muda — e a que estiver errada é descoberta em produção,
 * como uma entrada válida recusada ou, pior, uma inválida aceita.
 *
 * Aqui só existe uma: a do registro.
 */
export function contractFromFunction(functionName: string, version?: string): {
  inputJsonSchema: Record<string, unknown>
  outputJsonSchema: Record<string, unknown>
  version: string
  capabilities: string[]
  configSchema: Record<string, unknown> | null
} | { error: string } {
  const f = findFunction(functionName)
  if (!f) return { error: `A função "${functionName}" não está disponível neste servidor.` }
  if (version && version !== f.version) {
    return { error: `A função "${functionName}" está na versão ${f.version}, e foi pedida a ${version}.` }
  }
  return {
    inputJsonSchema: f.inputSchema,
    outputJsonSchema: f.outputSchema,
    version: f.version,
    capabilities: f.capabilities,
    configSchema: f.configSchema ?? null,
  }
}

export function parseAgentContract(body: Record<string, unknown>, atual?: { executorKind?: unknown } | null): ContractParseResult {
  const fields: ContractParseResult['fields'] = {}

  if (body.executorKind !== undefined) {
    if (!EXECUTOR_KINDS.includes(body.executorKind as ExecutorKind)) {
      return { fields, error: `executorKind must be one of: ${EXECUTOR_KINDS.join(', ')}` }
    }
    fields.executorKind = body.executorKind as ExecutorKind
  }

  if (body.responseMode !== undefined) {
    if (!RESPONSE_MODES.includes(body.responseMode as ResponseMode)) {
      return { fields, error: `responseMode must be one of: ${RESPONSE_MODES.join(', ')}` }
    }
    fields.responseMode = body.responseMode as ResponseMode
  }

  if (body.inputJsonSchema !== undefined) {
    if (body.inputJsonSchema === null || body.inputJsonSchema === '') fields.inputJsonSchema = null
    else {
      // O MESMO validador das ferramentas: um contrato que ninguém consegue verificar não
      // é contrato, e duas noções de "schema válido" divergiriam na primeira mudança.
      if (!isValidToolSchema(body.inputJsonSchema)) return { fields, error: 'inputJsonSchema must be an object JSON Schema' }
      fields.inputJsonSchema = body.inputJsonSchema as Record<string, unknown>
    }
  }

  /**
   * O TIPO que vale nesta gravação: o que está sendo enviado, ou o que já está no banco.
   *
   * A validação abaixo precisa rodar mesmo quando `executorConfig` NÃO veio no corpo.
   * Antes ela só rodava dentro do `if`, e mandar `executorKind: 'function'` sozinho
   * gravava um agente de função sem função nenhuma: ele passava pela API, aparecia na
   * tela como configurado, e falhava na primeira execução com "não configurado" — longe
   * daqui, e sem nada que apontasse para o pedido que o criou.
   */
  const kindEfetivo = (fields.executorKind ??
    (EXECUTOR_KINDS.includes(atual?.executorKind as ExecutorKind) ? (atual!.executorKind as ExecutorKind) : 'llm')) as ExecutorKind

  if (body.executorConfig !== undefined) {
    const kind = kindEfetivo
    const cfg = body.executorConfig
    if (cfg !== null && (typeof cfg !== 'object' || Array.isArray(cfg))) {
      return { fields, error: 'executorConfig must be an object' }
    }
    // Uma configuração que declara um tipo diferente do do agente é ambígua: qual dos
    // dois vale? Recusar é melhor que escolher um e o dono descobrir depois.
    const declarado = (cfg as { kind?: unknown } | null)?.kind
    if (declarado !== undefined && declarado !== kind) {
      return { fields, error: `executorConfig.kind (${String(declarado)}) does not match executorKind (${kind})` }
    }
    const normalizada = normalizeExecutorConfig(kind, cfg)
    if (normalizada.kind === 'function' && !normalizada.functionName) {
      return { fields, error: 'executorConfig.functionName is required for executorKind "function"' }
    }
    if (normalizada.kind === 'tool' && !normalizada.toolId && !(normalizada.appKey && normalizada.actionKey)) {
      return { fields, error: 'executorConfig requires toolId, or appKey with actionKey, for executorKind "tool"' }
    }
    fields.executorConfig = normalizada
  }

  /**
   * O tipo mudou e a configuração não veio junto.
   *
   * Um `executorKind` sem a referência do que executar é uma promessa sem cumprimento.
   * Recusar aqui é o único lugar onde existe alguém para avisar.
   */
  if (fields.executorKind !== undefined && fields.executorConfig === undefined) {
    if (fields.executorKind === 'function') {
      return { fields, error: 'executorConfig.functionName is required for executorKind "function"' }
    }
    if (fields.executorKind === 'tool') {
      return { fields, error: 'executorConfig requires toolId, or appKey with actionKey, for executorKind "tool"' }
    }
    // Voltar para `llm` limpa a configuração do tipo anterior: deixá-la gravada seria
    // guardar uma promessa que ninguém mais cumpre.
    fields.executorConfig = { kind: 'llm' }
  }

  /**
   * Uma FUNÇÃO manda no próprio contrato.
   *
   * Os schemas enviados pelo cliente são ignorados aqui — não recusados, derivados: o que
   * vale é o registro, e é ele que preenche. Assim o formulário pode mandar o que quiser
   * que o banco continua tendo uma verdade só.
   */
  /**
   * Uma função é `structured`. Pedir outro modo é pedir o que ela não faz.
   *
   * Aceitar em silêncio e corrigir na leitura funcionaria — e deixaria a tela mostrando
   * "Texto" para um agente que devolve dados. A recusa acontece aqui porque aqui existe
   * alguém para avisar.
   */
  if (kindEfetivo === 'function' && fields.responseMode !== undefined && fields.responseMode !== 'structured') {
    return { fields, error: 'Um agente de função produz dados: responseMode precisa ser "structured".' }
  }
  if (kindEfetivo === 'function') fields.responseMode = 'structured'

  const cfgFinal = fields.executorConfig
  if (kindEfetivo === 'function' && cfgFinal?.kind === 'function' && cfgFinal.functionName) {
    const derivado = contractFromFunction(cfgFinal.functionName, cfgFinal.version)
    if ('error' in derivado) return { fields, error: derivado.error }
    /**
     * Os PARÂMETROS, contra o schema que a função declara.
     *
     * Uma função que não declara `configSchema` não aceita parâmetro nenhum — e guardar um
     * seria guardar um campo que o handler nunca lê. Uma que declara aceita só o que está
     * lá: o resto é ruído no documento do agente, e um campo extra hoje é o campo que
     * alguém tenta usar amanhã achando que vale.
     */
    const parametros = cfgFinal.config
    if (parametros && Object.keys(parametros).length > 0) {
      if (!derivado.configSchema) {
        return { fields, error: `A função "${cfgFinal.functionName}" não aceita parâmetros de configuração.` }
      }
      // O validador já recusa campo não previsto por padrão — uma segunda checagem aqui
      // seria uma segunda regra sobre a mesma coisa, com outra mensagem.
      const v = validateAgainstSchema(derivado.configSchema, parametros)
      if (!v.valid) return { fields, error: `Parâmetros fora do contrato: ${describeErrors(v.errors.slice(0, 3))}` }
    }
    fields.inputJsonSchema = derivado.inputJsonSchema
    fields.outputJsonSchema = derivado.outputJsonSchema
    fields.executorConfig = { ...cfgFinal, version: derivado.version }
    fields.capabilities = derivado.capabilities
  }

  return { fields }
}
