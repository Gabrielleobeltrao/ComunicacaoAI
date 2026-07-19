import * as anthropicProvider from './claude.js'
import * as openaiProvider from './openai.js'
import type { ChatTurn } from './systemPrompt.js'

export type { ChatTurn }
export type Provider = 'anthropic' | 'openai'

export const PROVIDER_INFO: { id: Provider; label: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai', label: 'OpenAI (GPT)' },
]

export const PROVIDER_IDS = PROVIDER_INFO.map((p) => p.id)

function providerFor(provider: string | null | undefined) {
  return provider === 'openai' ? openaiProvider : anthropicProvider
}

export function generateAgentReply(
  objective: string,
  knowledge: string[],
  memory: string,
  history: ChatTurn[],
  provider: string | null | undefined,
  model: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<string> {
  return providerFor(provider).generateAgentReply(objective, knowledge, memory, history, model, apiKey)
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
