import Anthropic from '@anthropic-ai/sdk'
import { getCachedModels, setCachedModels } from './modelCache.js'
import {
  buildIdentityExtractionPrompt,
  buildMemoryUpdatePrompt,
  buildStructuredMemoryUpdatePrompt,
  buildSystemPrompt,
  IDENTITY_EXTRACTION_SYSTEM_PROMPT,
  MEMORY_UPDATE_SYSTEM_PROMPT,
  parseJsonObject,
  STRUCTURED_MEMORY_UPDATE_SYSTEM_PROMPT,
} from './systemPrompt.js'
import type { ChatTurn } from './systemPrompt.js'

export type { ChatTurn }

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
const PLATFORM_API_KEY = process.env.ANTHROPIC_API_KEY

// Used only if we can't reach Anthropic (no key configured yet, or the API call fails).
const FALLBACK_MODELS = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
]

function buildClient(apiKey?: string | null) {
  const key = apiKey || PLATFORM_API_KEY
  if (!key) {
    throw new Error(
      'No Anthropic API key available — configure one in Settings or set ANTHROPIC_API_KEY on the server',
    )
  }
  return new Anthropic({ apiKey: key })
}

export async function listAvailableModels(
  apiKey?: string | null,
): Promise<{ id: string; label: string }[]> {
  const key = apiKey || PLATFORM_API_KEY
  if (!key) return FALLBACK_MODELS

  const cached = getCachedModels('anthropic', key)
  if (cached) return cached

  try {
    const page = await new Anthropic({ apiKey: key }).models.list()
    const models = page
      .getPaginatedItems()
      .map((model) => ({ id: model.id, label: model.display_name }))
    const result = models.length > 0 ? models : FALLBACK_MODELS
    setCachedModels('anthropic', key, result)
    return result
  } catch (error) {
    console.error('Failed to list Anthropic models, using fallback list:', error)
    return FALLBACK_MODELS
  }
}

export async function generateAgentReply(
  objective: string,
  knowledge: string[],
  memory: string,
  history: ChatTurn[],
  model?: string | null,
  apiKey?: string | null,
  identityInstruction = '',
): Promise<string> {
  const response = await buildClient(apiKey).messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(objective, knowledge, memory, identityInstruction),
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: history.map((turn) => ({ role: turn.role, content: turn.content })),
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  return textBlock && textBlock.type === 'text' ? textBlock.text : ''
}

export async function updateMemory(
  currentMemory: string,
  visitorMessage: string,
  agentReply: string,
  model?: string | null,
  apiKey?: string | null,
): Promise<string> {
  const response = await buildClient(apiKey).messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 300,
    system: MEMORY_UPDATE_SYSTEM_PROMPT,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: buildMemoryUpdatePrompt(currentMemory, visitorMessage, agentReply) }],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  return textBlock && textBlock.type === 'text' ? textBlock.text.trim() : currentMemory
}

export async function updateStructuredMemory(
  currentMemory: Record<string, string>,
  visitorMessage: string,
  agentReply: string,
  model?: string | null,
  apiKey?: string | null,
): Promise<Record<string, string>> {
  const response = await buildClient(apiKey).messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 300,
    system: STRUCTURED_MEMORY_UPDATE_SYSTEM_PROMPT,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [
      { role: 'user', content: buildStructuredMemoryUpdatePrompt(currentMemory, visitorMessage, agentReply) },
    ],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return currentMemory
  const parsed = parseJsonObject(textBlock.text)
  return Object.keys(parsed).length > 0 ? parsed : currentMemory
}

export async function extractIdentity(
  fields: string[],
  recentMessages: ChatTurn[],
  model?: string | null,
  apiKey?: string | null,
): Promise<Record<string, string> | null> {
  const response = await buildClient(apiKey).messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 200,
    system: IDENTITY_EXTRACTION_SYSTEM_PROMPT,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: buildIdentityExtractionPrompt(fields, recentMessages) }],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return null
  const parsed = parseJsonObject(textBlock.text)
  return Object.keys(parsed).length === fields.length ? parsed : null
}

export async function transcribeImage(
  base64Data: string,
  mediaType: string,
  apiKey?: string | null,
): Promise<string> {
  const response = await buildClient(apiKey).messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 2048,
    thinking: { type: 'disabled' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType as 'image/jpeg', data: base64Data },
          },
          {
            type: 'text',
            text: 'Transcreva integralmente todo o texto visível nesta imagem (ex: itens de cardápio, preços, horários, avisos) e descreva qualquer informação relevante que não seja texto. Responda apenas com o conteúdo extraído, sem comentários adicionais.',
          },
        ],
      },
    ],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  return textBlock && textBlock.type === 'text' ? textBlock.text : ''
}
