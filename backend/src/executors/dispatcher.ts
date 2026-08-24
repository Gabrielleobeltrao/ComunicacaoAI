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
export async function dispatchAgentExecution(
  agent: Agent,
  request: ExecutorRequest,
  deps: DispatchDeps = {},
): Promise<ExecutorResult> {
  const comecou = Date.now()
  const contrato = agentContractOf(agent)

  if (contrato.executorKind === 'function') {
    if (contrato.executorConfig.kind !== 'function') {
      return semConfiguracao('function', comecou)
    }
    return executeRegisteredFunction(contrato.executorConfig, request.input)
  }

  if (contrato.executorKind === 'tool') {
    if (contrato.executorConfig.kind !== 'tool') {
      return semConfiguracao('tool', comecou)
    }
    return executeAgentTool(agent, request.ownerId, contrato.executorConfig, request.input)
  }

  if (!deps.runLlm) {
    return semConfiguracao('llm', comecou)
  }
  const r = await deps.runLlm(request, agent)
  return fromLlmResult(r, comecou)
}

const semConfiguracao = (kind: string, comecou: number): ExecutorResult => ({
  ok: false,
  metadata: { executorKind: kind },
  telemetry: { durationMs: Date.now() - comecou },
  error: { kind: 'not_configured', message: `Este agente está marcado como "${kind}" e não tem a configuração correspondente.` },
})
