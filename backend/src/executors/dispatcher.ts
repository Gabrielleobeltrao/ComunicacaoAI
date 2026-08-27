// Quem executa este agente — uma escolha, num lugar só.
//
// O dispatcher existe para que "como o agente trabalha" seja uma pergunta respondida em
// UM ponto. Espalhar essa decisão por cada chamador é garantir que um deles fique para
// trás quando um tipo novo aparecer — e o que ficar para trás vai tratar um agente de
// função como se fosse um de modelo, chamando o provedor por nada.
//
// O executor de modelo é uma ADAPTAÇÃO do runtime que já existe: prompt, ferramentas,
// repetição e cobrança continuam lá, e não há uma segunda cópia de nada disso aqui. O que
// este arquivo faz é traduzir o resultado para o formato comum.
import { describeErrors, validateAgainstSchema } from '../jsonSchema.js'
import { capabilitiesOf } from '../agentCapabilities.js'
import { agentContractOf } from './contract.js'
import { executeRegisteredFunction } from './functionExecutor.js'
import { executeAgentTool } from './toolExecutor.js'
import type { Agent } from '../agents.js'
import type { AgentExecutionResult } from '../agentRuntime.js'
import type { ExecutorRequest, ExecutorResult } from './types.js'

/** Como chamar o runtime de modelo. Injetado para este módulo não depender do mundo. */
export type LlmRunner = (request: ExecutorRequest, agent: Agent) => Promise<AgentExecutionResult>

export interface DispatchDeps {
  /** Ausente = agente de modelo não executa por aqui (é o caminho antigo, ainda em uso). */
  runLlm?: LlmRunner
}

/**
 * Traduz o resultado do runtime de modelo para o formato comum.
 *
 * A separação entre dado e texto aparece aqui: `json` vira `structured`, `output` vira
 * `text`. Hoje quem consome recebe uma string e reparseia; com os dois campos, quem
 * precisa do dado pega o dado.
 */
export function fromLlmResult(r: AgentExecutionResult, comecou: number): ExecutorResult {
  const querDado = r.json !== undefined
  return {
    ok: true,
    ...(querDado
      ? { structured: { data: r.json, valid: r.format?.valid !== false, repaired: r.format?.repaired === true } }
      : {}),
    text: r.output,
    metadata: { toolsExecuted: r.toolCalls.filter((c) => c.ok).length, format: r.format ?? null },
    telemetry: {
      durationMs: Date.now() - comecou,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      externalCalls: r.toolCalls.length,
    },
  }
}

/**
 * Executa o agente pelo tipo que ele declara.
 *
 * O contrato é lido de `agentContractOf`, então um agente antigo — sem nenhum campo novo
 * — cai em `llm` e segue exatamente como sempre seguiu.
 */
/** Nada de útil chegou: nem dado estruturado, nem um pedido em texto. */
const semEntrada = (request: ExecutorRequest): boolean => {
  const temInput = request.input !== undefined && request.input !== null && (typeof request.input !== 'object' || Object.keys(request.input as object).length > 0)
  return !temInput && !String(request.objective ?? '').trim()
}

export async function dispatchAgentExecution(
  agent: Agent,
  request: ExecutorRequest,
  deps: DispatchDeps = {},
): Promise<ExecutorResult> {
  const comecou = Date.now()
  const contrato = agentContractOf(agent)

  /**
   * A CONFERÊNCIA DE ENTRADA, aqui e em nenhum outro lugar.
   *
   * Ela existia só no caminho do setor. Playground, rotina, gatilho e delegação executavam
   * sem conferir nada — e um agente com contrato declarado recebia o que viesse. Quatro
   * lugares para a mesma regra é a garantia de que um deles vai ficar para trás; este é o
   * ponto por onde todos passam.
   */
  const entradaRuim = conferirEntrada(contrato.inputJsonSchema, request.input)
  if (entradaRuim) return falha('invalid_input', entradaRuim, comecou, { executorKind: contrato.executorKind })

  /**
   * Quem trabalha SOBRE o que recebe não inventa o que não recebeu.
   *
   * Um analista sem evidência analisa o nada; um executor sem instrução completa não vai
   * pesquisar o que falta — ele não tem como, e não deveria. Sem esta recusa a execução
   * seguia e o modelo preenchia a lacuna sozinho, produzindo algo que parece resposta e
   * não tem lastro. Recusar aqui devolve a decisão a quem conduz, que é de quem ela é.
   *
   * A checagem é mecânica de propósito: entrada VAZIA. Julgar se o conteúdo é suficiente
   * exigiria entender o pedido, e um palpite errado bloquearia trabalho legítimo.
   */
  const capacidades = capabilitiesOf(agent)
  if (capacidades.needsInputs && semEntrada(request)) {
    return falha(
      'invalid_input',
      `${agent.name} trabalha a partir do que recebe e não recebeu nada. Envie os dados ou o resultado da etapa anterior — ele não busca por conta própria.`,
      comecou,
      { executorKind: contrato.executorKind, role: capacidades.role, reason: 'input_insuficiente' },
    )
  }

  let resultado: ExecutorResult
  if (contrato.executorKind === 'function') {
    if (contrato.executorConfig.kind !== 'function') return semConfiguracao('function', comecou)
    resultado = await executeRegisteredFunction(contrato.executorConfig, request.input, { ownerId: request.ownerId, agentId: request.agentId.toString() })
  } else if (contrato.executorKind === 'tool') {
    if (contrato.executorConfig.kind !== 'tool') return semConfiguracao('tool', comecou)
    resultado = await executeAgentTool(agent, request.ownerId, contrato.executorConfig, request.input)
  } else {
    if (!deps.runLlm) return semConfiguracao('llm', comecou)
    resultado = fromLlmResult(await deps.runLlm(request, agent), comecou)
  }

  if (!resultado.ok) return resultado
  return conferirSaida(contrato, resultado, comecou)
}

/** A entrada cumpre o contrato? Sem contrato declarado, não há o que conferir. */
function conferirEntrada(schema: Record<string, unknown> | null, input: unknown): string | null {
  if (!schema) return null
  // Ausente é diferente de inválido: um agente com contrato chamado SEM entrada é um
  // pedido incompleto, e o schema dirá quais campos faltam.
  const v = validateAgainstSchema(schema, input ?? {})
  return v.valid ? null : `Entrada fora do contrato: ${describeErrors(v.errors.slice(0, 3))}`
}

/**
 * A saída cumpre o contrato, e o modo entrega o que prometeu.
 *
 * Para `function` e `tool`, uma saída inválida é o fim: pedir a um modelo que conserte o
 * retorno de uma função esconderia um defeito de código e cobraria por isso. O executor de
 * modelo já teve a correção dele lá dentro, uma vez, e chega aqui decidido.
 */
function conferirSaida(
  contrato: ReturnType<typeof agentContractOf>,
  resultado: ExecutorResult,
  comecou: number,
): ExecutorResult {
  const modo = contrato.responseMode
  const metadata = { ...resultado.metadata, executorKind: contrato.executorKind, responseMode: modo }

  if (modo !== 'text') {
    if (!resultado.structured) {
      return falha('invalid_output', 'Este agente promete dados e devolveu apenas texto.', comecou, metadata)
    }
    if (contrato.outputJsonSchema) {
      const v = validateAgainstSchema(contrato.outputJsonSchema, resultado.structured.data)
      if (!v.valid) {
        return falha('invalid_output', `Saída fora do contrato: ${describeErrors(v.errors.slice(0, 3))}`, comecou, metadata)
      }
    }
  }
  // `structured_and_text` promete as duas coisas. Uma função produz dado; prosa é trabalho
  // de modelo. Texto vazio aqui seria relatar sucesso completo para meia entrega.
  if (modo === 'structured_and_text' && !resultado.text?.trim()) {
    return falha(
      'invalid_output',
      'Este agente promete dados E texto, e produziu só dados. Encadeie um agente de IA para apresentar o resultado, ou mude o modo para "Dados estruturados".',
      comecou,
      metadata,
    )
  }
  if (modo === 'text' && !resultado.text?.trim()) {
    return falha('invalid_output', 'Este agente promete texto e não produziu nenhum.', comecou, metadata)
  }

  // O MODO recorta o que sai. Entregar o que não foi pedido é como um dado intermediário
  // vira frase, e a frase vira a entrada do próximo.
  return {
    ...resultado,
    metadata,
    ...(modo === 'text' ? { structured: undefined } : {}),
    ...(modo === 'structured' ? { text: undefined } : {}),
  }
}

const falha = (
  kind: 'invalid_input' | 'invalid_output',
  message: string,
  comecou: number,
  metadata: Record<string, unknown>,
): ExecutorResult => ({
  ok: false,
  metadata,
  telemetry: { durationMs: Date.now() - comecou },
  error: { kind, message },
})

const semConfiguracao = (kind: string, comecou: number): ExecutorResult => ({
  ok: false,
  metadata: { executorKind: kind },
  telemetry: { durationMs: Date.now() - comecou },
  error: { kind: 'not_configured', message: `Este agente está marcado como "${kind}" e não tem a configuração correspondente.` },
})
