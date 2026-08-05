import Anthropic from '@anthropic-ai/sdk'
import { getCachedModels, setCachedModels } from './modelCache.js'
import {
  buildGuardrailCheckPrompt,
  buildIdentityExtractionPrompt,
  buildMemoryUpdatePrompt,
  buildStageTransitionPrompt,
  buildStructuredMemoryUpdatePrompt,
  buildStructuredOutputExtractionPrompt,
  buildSystemPromptParts,
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
import type { AgentReplyResult, TokenUsage } from './llm.js'
import { MAX_TOOL_ITERATIONS, runResolvedTool } from './agentTools.js'
import type { ResolvedTool, ToolCallRecord } from './agentTools.js'

export type { ChatTurn }

// Anthropic reports cached reads/writes separately; sum them so the metric
// reflects total tokens processed.
function anthropicUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens:
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
  }
}

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

// Background/utility calls (memory, extraction, guardrail check) are
// classification-style tasks that don't need the flagship model — route them
// to a small, cheap model to keep token spend down.
export const AUXILIARY_MODEL = process.env.ANTHROPIC_AUX_MODEL ?? 'claude-haiku-4-5'
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
  guardrailInstruction = '',
  responseStyleInstruction = '',
  enableCaching = true,
  tools: ResolvedTool[] = [],
): Promise<AgentReplyResult> {
  const { cacheablePrefix, dynamicSuffix } = buildSystemPromptParts(
    objective,
    knowledge,
    memory,
    identityInstruction,
    guardrailInstruction,
    responseStyleInstruction,
  )

  // Mark the static prefix (objective + behavior instructions) as cacheable so
  // repeated turns in a conversation pay ~10% for that prefix instead of full price.
  const system: Anthropic.TextBlockParam[] = [
    enableCaching
      ? { type: 'text', text: cacheablePrefix, cache_control: { type: 'ephemeral' } }
      : { type: 'text', text: cacheablePrefix },
  ]
  if (dynamicSuffix) system.push({ type: 'text', text: dynamicSuffix })

  const client = buildClient(apiKey)
  const toolDefs: Anthropic.Tool[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }))

  const messages: Anthropic.MessageParam[] = history.map((turn) => ({ role: turn.role, content: turn.content }))
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  const toolCalls: ToolCallRecord[] = []
  let text = ''

  // Agentic loop: keep letting the model call tools until it answers, or we hit
  // the iteration cap (on the last pass tools are withheld so it must reply).
  for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
    const allowTools = toolDefs.length > 0 && iteration < MAX_TOOL_ITERATIONS
    const response = await client.messages.create({
      model: model || DEFAULT_MODEL,
      max_tokens: 1024,
      system,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      messages,
      ...(allowTools ? { tools: toolDefs } : {}),
    })
    const turnUsage = anthropicUsage(response.usage)
    usage.inputTokens += turnUsage.inputTokens
    usage.outputTokens += turnUsage.outputTokens

    if (allowTools && response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content })
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const record = await runResolvedTool(tools, block.name, (block.input ?? {}) as Record<string, unknown>)
          toolCalls.push(record)
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: record.result,
            is_error: !record.ok,
          })
        }
      }
      messages.push({ role: 'user', content: results })
      continue
    }

    const textBlock = response.content.find((block) => block.type === 'text')
    text = textBlock && textBlock.type === 'text' ? textBlock.text : ''
    break
  }

  return { text, usage, toolCalls }
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

export async function checkGuardrail(
  objective: string,
  recentMessages: ChatTurn[],
  visitorMessage: string,
  model?: string | null,
  apiKey?: string | null,
): Promise<boolean> {
  const response = await buildClient(apiKey).messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 50,
    system: GUARDRAIL_CHECK_SYSTEM_PROMPT,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: buildGuardrailCheckPrompt(objective, recentMessages, visitorMessage) }],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return true
  return parseInScopeResult(textBlock.text)
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
  const response = await buildClient(apiKey).messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 80,
    system: TEAM_PLANNER_SYSTEM_PROMPT,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content: buildTeamPlannerPrompt(options, currentIndices, defaultIndex, recentMessages, visitorMessage),
      },
    ],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return { specialists: [defaultIndex], clarify: false }
  return parseTeamPlan(textBlock.text, options.length, defaultIndex)
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
  const response = await buildClient(apiKey).messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 50,
    system: STAGE_TRANSITION_SYSTEM_PROMPT,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content: buildStageTransitionPrompt(currentStageName, currentStageGoal, options, recentMessages, visitorMessage),
      },
    ],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return -1
  return parseStageTransition(textBlock.text, validTargets)
}

export async function extractStructuredOutput(
  fields: string[],
  currentData: Record<string, string>,
  visitorMessage: string,
  agentReply: string,
  model?: string | null,
  apiKey?: string | null,
): Promise<Record<string, string>> {
  const response = await buildClient(apiKey).messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 300,
    system: STRUCTURED_OUTPUT_EXTRACTION_SYSTEM_PROMPT,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content: buildStructuredOutputExtractionPrompt(fields, currentData, visitorMessage, agentReply),
      },
    ],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return currentData
  const parsed = parseJsonObject(textBlock.text)
  return Object.keys(parsed).length > 0 ? parsed : currentData
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
