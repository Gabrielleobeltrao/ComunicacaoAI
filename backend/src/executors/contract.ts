// O contrato de um agente: como ele executa, o que recebe e o que devolve.
//
// Puro. Lê o documento como ele está no banco — incluindo o de um agente criado antes de
// qualquer um destes campos existir — e devolve a forma normalizada. Nada é gravado aqui,
// e nada muda de comportamento: um agente antigo lê exatamente como se comportava.
//
// A regra que governa tudo: AUSENTE é o padrão de hoje. Um campo que falta nunca pode
// significar uma mudança — é o que permite adicionar isto sem migração destrutiva e sem
// tocar em um único documento existente.
import { isValidToolSchema } from '../jsonSchema.js'
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
  const responseMode = RESPONSE_MODES.includes(a.responseMode as ResponseMode)
    ? (a.responseMode as ResponseMode)
    : responseModeFromLegacy(a.defaultOutputFormat)

  return {
    executorKind,
    responseMode,
    executorConfig: normalizeExecutorConfig(executorKind, a.executorConfig),
    inputJsonSchema: isValidToolSchema(a.inputJsonSchema) ? (a.inputJsonSchema as Record<string, unknown>) : null,
    outputJsonSchema: isValidToolSchema(a.outputJsonSchema) ? (a.outputJsonSchema as Record<string, unknown>) : null,
  }
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
  }>
  error?: string
}

/**
 * Valida o que veio na API. Só mexe no que FOI ENVIADO.
 *
 * Um payload antigo, sem nenhum destes campos, sai daqui sem nenhum campo — o agente é
 * gravado exatamente como sempre foi. É isso que mantém as APIs anteriores funcionando.
 */
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

  if (body.executorConfig !== undefined) {
    // O tipo que vale é o que está sendo gravado agora; sem ele, o que já está no banco.
    const kind = (fields.executorKind ?? (EXECUTOR_KINDS.includes(atual?.executorKind as ExecutorKind) ? (atual!.executorKind as ExecutorKind) : 'llm')) as ExecutorKind
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

  return { fields }
}
