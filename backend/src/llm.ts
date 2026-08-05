import type { ResolvedTool, ToolCallRecord } from './agentTools.js'
import * as anthropicProvider from './claude.js'
import * as openaiProvider from './openai.js'
import type { ChatTurn, RouterOption, StageTransitionOption, TeamPlan } from './systemPrompt.js'

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

function providerFor(provider: string | null | undefined) {
  return provider === 'openai' ? openaiProvider : anthropicProvider
}

// The small model used for background/utility calls, regardless of the
// (possibly flagship) model the agent uses for the visitor-facing reply.
export function auxiliaryModel(provider: string | null | undefined): string {
  return providerFor(provider).AUXILIARY_MODEL
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

export function planTeamResponse(
  options: RouterOption[],
  currentIndices: number[],
  defaultIndex: number,
  recentMessages: ChatTurn[],
  visitorMessage: string,
  provider: string | null | undefined,
  model: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<TeamPlan> {
  return providerFor(provider).planTeamResponse(
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
