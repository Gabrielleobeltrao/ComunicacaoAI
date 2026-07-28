import OpenAI from 'openai'
import { getCachedModels, setCachedModels } from './modelCache.js'
import {
  buildGuardrailCheckPrompt,
  buildIdentityExtractionPrompt,
  buildMemoryUpdatePrompt,
  buildStageTransitionPrompt,
  buildStructuredMemoryUpdatePrompt,
  buildStructuredOutputExtractionPrompt,
  buildSystemPrompt,
  buildTeamPlannerPrompt,
  GUARDRAIL_CHECK_SYSTEM_PROMPT,
  IDENTITY_EXTRACTION_SYSTEM_PROMPT,
  MEMORY_UPDATE_SYSTEM_PROMPT,
  parseInScopeResult,
  parseJsonObject,
  parseStageTransition,
  parseTeamPlan,
  STAGE_TRANSITION_SYSTEM_PROMPT,
  STRUCTURED_MEMORY_UPDATE_SYSTEM_PROMPT,
  STRUCTURED_OUTPUT_EXTRACTION_SYSTEM_PROMPT,
  TEAM_PLANNER_SYSTEM_PROMPT,
} from './systemPrompt.js'
import type { ChatTurn, RouterOption, StageTransitionOption, TeamPlan } from './systemPrompt.js'
import type { AgentReplyResult } from './llm.js'

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.1'

// Background/utility calls (memory, extraction, guardrail check) are
// classification-style tasks that don't need the flagship model — route them
// to a small, cheap model to keep token spend down.
export const AUXILIARY_MODEL = process.env.OPENAI_AUX_MODEL ?? 'gpt-5-mini'
const PLATFORM_API_KEY = process.env.OPENAI_API_KEY

// Used only if we can't reach OpenAI (no key configured yet, or the API call fails).
const FALLBACK_MODELS = [
  { id: 'gpt-5.1', label: 'GPT-5.1' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
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
  memory: string,
  history: ChatTurn[],
  model?: string | null,
  apiKey?: string | null,
  identityInstruction = '',
  guardrailInstruction = '',
  responseStyleInstruction = '',
  // OpenAI caches long prompt prefixes automatically at no cost and offers no
  // opt-out, so the per-agent caching toggle is a no-op here — accepted only to
  // keep the provider signatures identical.
  enableCaching = true,
): Promise<AgentReplyResult> {
  void enableCaching
  // buildSystemPrompt puts the static objective + instructions first, which is
  // what OpenAI's automatic prompt caching keys off of (>1024-token prefixes).
  const response = await buildClient(apiKey).chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_completion_tokens: 1024,
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(
          objective,
          knowledge,
          memory,
          identityInstruction,
          guardrailInstruction,
          responseStyleInstruction,
        ),
      },
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    ],
  })

  return {
    text: response.choices[0]?.message?.content ?? '',
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  }
}

export async function updateMemory(
  currentMemory: string,
  visitorMessage: string,
  agentReply: string,
  model?: string | null,
  apiKey?: string | null,
): Promise<string> {
  const response = await buildClient(apiKey).chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_completion_tokens: 300,
    // gpt-5 mini/nano are reasoning models; without this they burn the whole
    // (small) token budget on reasoning and return empty content. These utility
    // tasks don't need reasoning.
    reasoning_effort: 'minimal',
    messages: [
      { role: 'system', content: MEMORY_UPDATE_SYSTEM_PROMPT },
      { role: 'user', content: buildMemoryUpdatePrompt(currentMemory, visitorMessage, agentReply) },
    ],
  })

  return response.choices[0]?.message?.content?.trim() || currentMemory
}

export async function updateStructuredMemory(
  currentMemory: Record<string, string>,
  visitorMessage: string,
  agentReply: string,
  model?: string | null,
  apiKey?: string | null,
): Promise<Record<string, string>> {
  const response = await buildClient(apiKey).chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_completion_tokens: 300,
    reasoning_effort: 'minimal',
    messages: [
      { role: 'system', content: STRUCTURED_MEMORY_UPDATE_SYSTEM_PROMPT },
      { role: 'user', content: buildStructuredMemoryUpdatePrompt(currentMemory, visitorMessage, agentReply) },
    ],
  })

  const text = response.choices[0]?.message?.content
  if (!text) return currentMemory
  const parsed = parseJsonObject(text)
  return Object.keys(parsed).length > 0 ? parsed : currentMemory
}

export async function extractIdentity(
  fields: string[],
  recentMessages: ChatTurn[],
  model?: string | null,
  apiKey?: string | null,
): Promise<Record<string, string> | null> {
  const response = await buildClient(apiKey).chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_completion_tokens: 200,
    reasoning_effort: 'minimal',
    messages: [
      { role: 'system', content: IDENTITY_EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: buildIdentityExtractionPrompt(fields, recentMessages) },
    ],
  })

  const text = response.choices[0]?.message?.content
  if (!text) return null
  const parsed = parseJsonObject(text)
  return Object.keys(parsed).length === fields.length ? parsed : null
}

export async function checkGuardrail(
  objective: string,
  recentMessages: ChatTurn[],
  visitorMessage: string,
  model?: string | null,
  apiKey?: string | null,
): Promise<boolean> {
  const response = await buildClient(apiKey).chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_completion_tokens: 100,
    reasoning_effort: 'minimal',
    messages: [
      { role: 'system', content: GUARDRAIL_CHECK_SYSTEM_PROMPT },
      { role: 'user', content: buildGuardrailCheckPrompt(objective, recentMessages, visitorMessage) },
    ],
  })

  const text = response.choices[0]?.message?.content
  if (!text) return true
  return parseInScopeResult(text)
}

export async function planTeamResponse(
  options: RouterOption[],
  currentIndices: number[],
  defaultIndex: number,
  recentMessages: ChatTurn[],
  visitorMessage: string,
  model?: string | null,
  apiKey?: string | null,
): Promise<TeamPlan> {
  const response = await buildClient(apiKey).chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_completion_tokens: 150,
    reasoning_effort: 'minimal',
    messages: [
      { role: 'system', content: TEAM_PLANNER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildTeamPlannerPrompt(options, currentIndices, defaultIndex, recentMessages, visitorMessage),
      },
    ],
  })

  const text = response.choices[0]?.message?.content
  if (!text) return { specialists: [defaultIndex], clarify: false }
  return parseTeamPlan(text, options.length, defaultIndex)
}

export async function planStageTransition(
  currentStageName: string,
  currentStageGoal: string,
  options: StageTransitionOption[],
  recentMessages: ChatTurn[],
  visitorMessage: string,
  model?: string | null,
  apiKey?: string | null,
): Promise<number> {
  const validTargets = options.map((o) => o.target)
  const response = await buildClient(apiKey).chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_completion_tokens: 100,
    reasoning_effort: 'minimal',
    messages: [
      { role: 'system', content: STAGE_TRANSITION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildStageTransitionPrompt(currentStageName, currentStageGoal, options, recentMessages, visitorMessage),
      },
    ],
  })

  const text = response.choices[0]?.message?.content
  if (!text) return -1
  return parseStageTransition(text, validTargets)
}

export async function extractStructuredOutput(
  fields: string[],
  currentData: Record<string, string>,
  visitorMessage: string,
  agentReply: string,
  model?: string | null,
  apiKey?: string | null,
): Promise<Record<string, string>> {
  const response = await buildClient(apiKey).chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_completion_tokens: 300,
    reasoning_effort: 'minimal',
    messages: [
      { role: 'system', content: STRUCTURED_OUTPUT_EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildStructuredOutputExtractionPrompt(fields, currentData, visitorMessage, agentReply),
      },
    ],
  })

  const text = response.choices[0]?.message?.content
  if (!text) return currentData
  const parsed = parseJsonObject(text)
  return Object.keys(parsed).length > 0 ? parsed : currentData
}

export async function transcribeImage(
  base64Data: string,
  mediaType: string,
  apiKey?: string | null,
): Promise<string> {
  const response = await buildClient(apiKey).chat.completions.create({
    model: DEFAULT_MODEL,
    max_completion_tokens: 2048,
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
