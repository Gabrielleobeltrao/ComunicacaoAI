import type { ResolvedTool, ToolCallRecord } from './agentTools.js'
import * as anthropicProvider from './claude.js'
import * as openaiProvider from './openai.js'
import * as fakeProvider from './llmFake.js'
import type { ChatTurn, RouterOption, StageTransitionOption, SectorPlan } from './systemPrompt.js'
import type { EffectiveRunConfig } from './runConfig.js'

export type { ChatTurn }
export type Provider = 'anthropic' | 'openai'

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface AgentReplyResult {
  text: string
  usage: TokenUsage
  toolCalls: ToolCallRecord[]
}

export const PROVIDER_INFO: { id: Provider; label: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai', label: 'OpenAI (GPT)' },
]

export const PROVIDER_IDS = PROVIDER_INFO.map((p) => p.id)

// O portão do adaptador falso, resolvido UMA vez no carregamento do módulo.
//
// Duas condições, e as duas verificadas aqui e não no ponto de uso: o processo
// precisa ter subido como `test` E alguém precisa ter pedido explicitamente. Um
// processo de produção sobe com NODE_ENV=production, então nenhuma variável lida
// depois do boot, nenhuma rota e nenhuma configuração de usuário conseguem ligar
// isto — não existe caminho, não é uma checagem que dê para esquecer de fazer.
//
// `llmFakeGate.test.mjs` afirma as duas metades.
export const FAKE_LLM_ENABLED = process.env.NODE_ENV === 'test' && process.env.LLM_FAKE === '1'

function providerFor(provider: string | null | undefined) {
  if (FAKE_LLM_ENABLED) return fakeProvider
  return provider === 'openai' ? openaiProvider : anthropicProvider
}

// The small model used for background/utility calls, regardless of the
// (possibly flagship) model the agent uses for the visitor-facing reply.
export function auxiliaryModel(provider: string | null | undefined): string {
  return providerFor(provider).AUXILIARY_MODEL
}

/**
 * A configuração de execução que chega ao adapter.
 *
 * Vem como objeto no fim, e não como mais quatro parâmetros posicionais: esta assinatura
 * já tem doze, e o próximo argumento solto seria o erro de chamada esperando para
 * acontecer.
 *
 * Já passou por `effectiveRunConfig`: o que está aqui é o que aquele modelo aceita, e o
 * adapter só precisa traduzir os nomes.
 */
export interface ReplyOptions {
  runConfig?: EffectiveRunConfig
  /**
   * O sinal de cancelamento DESTA tentativa.
   *
   * Sem ele, um timeout apenas rejeita a promessa: a chamada continua viva, o modelo
   * responde depois, e o laço de ferramentas executa uma ESCRITA que já ninguém está
   * esperando. Se o runtime tiver tentado de novo enquanto isso, a mesma escrita
   * acontece duas vezes.
   *
   * O sinal é conferido antes de cada ferramenta e vai para o SDK, que aborta a
   * requisição em curso.
   */
  signal?: AbortSignal
  /**
   * Avisa que uma ferramenta VAI começar, com o risco dela.
   *
   * É o que permite ao runtime decidir se ainda pode tentar de novo: depois que uma
   * escrita começou, nem o cancelamento garante que ela não chegou ao outro lado — e
   * repetir seria a segunda cobrança, o segundo e-mail, o segundo pedido.
   */
  onToolStart?: (risk: 'read' | 'write' | 'high_risk') => void
}

export function generateAgentReply(
  objective: string,
  knowledge: string[],
  memory: string,
  history: ChatTurn[],
  provider: string | null | undefined,
  model: string | null | undefined,
  apiKey: string | null | undefined,
  identityInstruction = '',
  guardrailInstruction = '',
  responseStyleInstruction = '',
  enableCaching = true,
  tools: ResolvedTool[] = [],
  opts: ReplyOptions = {},
): Promise<AgentReplyResult> {
  return providerFor(provider).generateAgentReply(
    objective,
    knowledge,
    memory,
    history,
    model,
    apiKey,
    identityInstruction,
    guardrailInstruction,
    responseStyleInstruction,
    enableCaching,
    tools,
    opts,
  )
}

export function checkGuardrail(
  objective: string,
  recentMessages: ChatTurn[],
  visitorMessage: string,
  provider: string | null | undefined,
  model: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<boolean> {
  return providerFor(provider).checkGuardrail(objective, recentMessages, visitorMessage, model, apiKey)
}

export function planSectorResponse(
  options: RouterOption[],
  currentIndices: number[],
  defaultIndex: number,
  recentMessages: ChatTurn[],
  visitorMessage: string,
  provider: string | null | undefined,
  model: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<SectorPlan> {
  return providerFor(provider).planSectorResponse(
    options,
    currentIndices,
    defaultIndex,
    recentMessages,
    visitorMessage,
    model,
    apiKey,
  )
}

export function planStageTransition(
  currentStageName: string,
  currentStageGoal: string,
  options: StageTransitionOption[],
  recentMessages: ChatTurn[],
  visitorMessage: string,
  provider: string | null | undefined,
  model: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<number> {
  return providerFor(provider).planStageTransition(
    currentStageName,
    currentStageGoal,
    options,
    recentMessages,
    visitorMessage,
    model,
    apiKey,
  )
}

export function extractStructuredOutput(
  fields: string[],
  currentData: Record<string, string>,
  visitorMessage: string,
  agentReply: string,
  provider: string | null | undefined,
  model: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<Record<string, string>> {
  return providerFor(provider).extractStructuredOutput(fields, currentData, visitorMessage, agentReply, model, apiKey)
}

export function updateConversationMemory(
  currentMemory: string,
  visitorMessage: string,
  agentReply: string,
  provider: string | null | undefined,
  model: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<string> {
  return providerFor(provider).updateMemory(currentMemory, visitorMessage, agentReply, model, apiKey)
}

export function updateStructuredMemory(
  currentMemory: Record<string, string>,
  visitorMessage: string,
  agentReply: string,
  provider: string | null | undefined,
  model: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<Record<string, string>> {
  return providerFor(provider).updateStructuredMemory(currentMemory, visitorMessage, agentReply, model, apiKey)
}

export function extractIdentity(
  fields: string[],
  recentMessages: ChatTurn[],
  provider: string | null | undefined,
  model: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<Record<string, string> | null> {
  return providerFor(provider).extractIdentity(fields, recentMessages, model, apiKey)
}

export function transcribeImage(
  base64Data: string,
  mediaType: string,
  provider: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<string> {
  return providerFor(provider).transcribeImage(base64Data, mediaType, apiKey)
}

export function listModelsForProvider(
  provider: Provider,
  apiKey: string | null | undefined,
): Promise<{ id: string; label: string }[]> {
  return providerFor(provider).listAvailableModels(apiKey)
}
