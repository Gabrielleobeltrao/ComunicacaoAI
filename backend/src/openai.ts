import OpenAI from 'openai'
import { getCachedModels, setCachedModels } from './modelCache.js'
import { buildSystemPrompt } from './systemPrompt.js'
import type { ChatTurn } from './systemPrompt.js'

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.1'
const PLATFORM_API_KEY = process.env.OPENAI_API_KEY

// Used only if we can't reach OpenAI (no key configured yet, or the API call fails).
const FALLBACK_MODELS = [
  { id: 'gpt-5.1', label: 'GPT-5.1' },
  { id: 'gpt-5.1-mini', label: 'GPT-5.1 Mini' },
]

// OpenAI's /v1/models lists everything on the account (embeddings, tts,
// whisper, fine-tunes...), not just chat models, and gives no display name —
// so we filter down to chat-capable ids and derive a readable label.
const CHAT_MODEL_PATTERN = /^(gpt-|o[134](-|$))/i
const EXCLUDED_PATTERN =
  /audio|realtime|transcribe|tts|embedding|moderation|instruct|search|similarity|edit|whisper|dall-e|davinci|babbage|computer-use/i

function isChatModel(id: string): boolean {
  return CHAT_MODEL_PATTERN.test(id) && !EXCLUDED_PATTERN.test(id)
}

function humanizeModelId(id: string): string {
  return id
    .split('-')
    .map((part) => (part.toLowerCase() === 'gpt' ? 'GPT' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}

function buildClient(apiKey?: string | null) {
  const key = apiKey || PLATFORM_API_KEY
  if (!key) {
    throw new Error(
      'No OpenAI API key available — configure one in Settings or set OPENAI_API_KEY on the server',
    )
  }
  return new OpenAI({ apiKey: key })
}

export async function listAvailableModels(
  apiKey?: string | null,
): Promise<{ id: string; label: string }[]> {
  const key = apiKey || PLATFORM_API_KEY
  if (!key) return FALLBACK_MODELS

  const cached = getCachedModels('openai', key)
  if (cached) return cached

  try {
    const page = await new OpenAI({ apiKey: key }).models.list()
    const models = page
      .getPaginatedItems()
      .filter((model) => isChatModel(model.id))
      .sort((a, b) => b.created - a.created)
      .map((model) => ({ id: model.id, label: humanizeModelId(model.id) }))
    const result = models.length > 0 ? models : FALLBACK_MODELS
    setCachedModels('openai', key, result)
    return result
  } catch (error) {
    console.error('Failed to list OpenAI models, using fallback list:', error)
    return FALLBACK_MODELS
  }
}

export async function generateAgentReply(
  objective: string,
  knowledge: string[],
  history: ChatTurn[],
  model?: string | null,
  apiKey?: string | null,
): Promise<string> {
  const response = await buildClient(apiKey).chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: buildSystemPrompt(objective, knowledge) },
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    ],
  })

  return response.choices[0]?.message?.content ?? ''
}

export async function transcribeImage(
  base64Data: string,
  mediaType: string,
  apiKey?: string | null,
): Promise<string> {
  const response = await buildClient(apiKey).chat.completions.create({
    model: DEFAULT_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mediaType};base64,${base64Data}` },
          },
          {
            type: 'text',
            text: 'Transcreva integralmente todo o texto visível nesta imagem (ex: itens de cardápio, preços, horários, avisos) e descreva qualquer informação relevante que não seja texto. Responda apenas com o conteúdo extraído, sem comentários adicionais.',
          },
        ],
      },
    ],
  })

  return response.choices[0]?.message?.content ?? ''
}
