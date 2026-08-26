import OpenAI from 'openai'
import { getCachedModels, setCachedModels } from './modelCache.js'
// Uma fonte só para os padrões, e sem banco atrás dela — ver `modelDefaults.ts`.
import { OPENAI_DEFAULT_MODEL, OPENAI_AUX_MODEL } from './modelDefaults.js'
import {
  buildGuardrailCheckPrompt,
  buildIdentityExtractionPrompt,
  buildMemoryUpdatePrompt,
  buildStageTransitionPrompt,
  buildStructuredMemoryUpdatePrompt,
  buildStructuredOutputExtractionPrompt,
  buildSystemPrompt,
  buildSectorPlannerPrompt,
  GUARDRAIL_CHECK_SYSTEM_PROMPT,
  IDENTITY_EXTRACTION_SYSTEM_PROMPT,
  MEMORY_UPDATE_SYSTEM_PROMPT,
  parseInScopeResult,
  parseJsonObject,
  parseStageTransition,
  parseSectorPlan,
  STAGE_TRANSITION_SYSTEM_PROMPT,
  STRUCTURED_MEMORY_UPDATE_SYSTEM_PROMPT,
  STRUCTURED_OUTPUT_EXTRACTION_SYSTEM_PROMPT,
  SECTOR_PLANNER_SYSTEM_PROMPT,
} from './systemPrompt.js'
import type { ChatTurn, RouterOption, StageTransitionOption, SectorPlan } from './systemPrompt.js'
import type { EffectiveRunConfig } from './runConfig.js'
import type { AgentReplyResult, TokenUsage } from './llm.js'
import { MAX_TOOL_ITERATIONS, runResolvedTool } from './agentTools.js'
import type { ResolvedTool, ToolCallRecord } from './agentTools.js'

export const DEFAULT_MODEL = OPENAI_DEFAULT_MODEL

// Background/utility calls (memory, extraction, guardrail check) are
// classification-style tasks that don't need the flagship model — route them
// to a small, cheap model to keep token spend down.
export const AUXILIARY_MODEL = OPENAI_AUX_MODEL
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
  tools: ResolvedTool[] = [],
  opts: { runConfig?: EffectiveRunConfig; signal?: AbortSignal; onToolStart?: (risk: 'read' | 'write' | 'high_risk') => void } = {},
): Promise<AgentReplyResult> {
  void enableCaching
  const client = buildClient(apiKey)
  const toolDefs: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }))

  // buildSystemPrompt puts the static objective + instructions first, which is
  // what OpenAI's automatic prompt caching keys off of (>1024-token prefixes).
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
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
  ]
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  const toolCalls: ToolCallRecord[] = []
  let text = ''

  /**
   * A configuração do dono, traduzida para os nomes da OpenAI.
   *
   * `max_completion_tokens: 1024` era hardcode e continua sendo o padrão quando o campo
   * está ausente: mudá-lo aqui alteraria o comportamento de todos os agentes existentes.
   *
   * `parallel_tool_calls` só é enviado quando o dono escolheu `false`. Mandar `true`
   * explicitamente seria dizer ao provedor algo que já é o padrão dele — e um campo a
   * mais na requisição é uma chance a mais de incompatibilidade num modelo futuro.
   */
  const cfg: Partial<EffectiveRunConfig> = opts.runConfig ?? {}
  const proibirFerramentas = cfg.toolChoice === 'none'
  const tuning = {
    max_completion_tokens: cfg.maxOutputTokens ?? 1024,
    ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
    ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort } : {}),
  }

  // Agentic loop: keep letting the model call tools until it answers, or we hit
  // the cap (tools are withheld on the last pass so it must reply).
  for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
    const allowTools = toolDefs.length > 0 && !proibirFerramentas && iteration < MAX_TOOL_ITERATIONS
    const response = await client.chat.completions.create(
      {
        model: model || DEFAULT_MODEL,
        ...tuning,
        messages,
        ...(allowTools ? { tools: toolDefs } : {}),
        ...(allowTools && cfg.toolChoice === 'required' ? { tool_choice: 'required' as const } : {}),
        ...(allowTools && cfg.parallelTools === false ? { parallel_tool_calls: false } : {}),
      },
      opts.signal ? { signal: opts.signal } : undefined,
    )
    usage.inputTokens += response.usage?.prompt_tokens ?? 0
    usage.outputTokens += response.usage?.completion_tokens ?? 0

    const message = response.choices[0]?.message
    const calls = message?.tool_calls ?? []
    if (allowTools && message && calls.length > 0) {
      messages.push(message)
      const pedidos = calls.filter((c) => c.type === 'function')

      /**
       * Em paralelo só quando TODAS as chamadas deste lote são de leitura.
       *
       * Sobre as ferramentas CHAMADAS, não as disponíveis: o modelo pode ter dez à mão e
       * pedir duas leituras — esse lote é seguro. Uma escrita no meio devolve tudo para
       * sequencial, porque a ordem em que duas escritas chegam ao outro lado é o que o
       * dono configurou. Risco ausente conta como escrita.
       */
      const soLeitura = pedidos.every((c) => tools.find((t) => t.name === c.function.name)?.risk === 'read')
      const emParalelo = cfg.parallelTools === true && soLeitura && pedidos.length > 1

      const executar = (call: (typeof pedidos)[number]) => {
        // Uma tentativa cancelada não inicia mais ferramenta nenhuma.
        if (opts.signal?.aborted) throw new Error('execução cancelada por tempo esgotado')
        opts.onToolStart?.(tools.find((t) => t.name === call.function.name)?.risk ?? 'write')
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(call.function.arguments || '{}')
        } catch {
          /* leave args empty on malformed JSON */
        }
        return runResolvedTool(tools, call.function.name, args)
      }

      // A ordem das mensagens de resultado é preservada nos dois caminhos: `map` devolve
      // no índice do pedido, e o `tool_call_id` que as pareia vem do mesmo objeto.
      /**
       * O laço sequencial é um `for...of` de propósito.
       *
       * Um `reduce` com `async (acc, x) => [...(await acc), await executar(x)]` PARECE
       * sequencial e não é: o `reduce` chama o callback para todos os elementos de uma
       * vez, então `executar(x)` dispara em todos antes de qualquer `await` — e o
       * encadeamento só ordena a COLETA dos resultados, não a execução. Duas escritas
       * sairiam juntas mesmo com o paralelismo desligado.
       */
      let registros: ToolCallRecord[]
      if (emParalelo) {
        registros = await Promise.all(pedidos.map(executar))
      } else {
        registros = []
        for (const call of pedidos) registros.push(await executar(call))
      }

      pedidos.forEach((call, i) => {
        toolCalls.push(registros[i])
        messages.push({ role: 'tool', tool_call_id: call.id, content: registros[i].result })
      })
      continue
    }

    text = message?.content ?? ''
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

/** Uma pergunta de bastidor: prompt entra, texto sai. Ver `claude.ts` para o porquê. */
export async function askAux(prompt: string, model?: string | null, apiKey?: string | null, maxTokens = 600): Promise<string> {
  return (await askAuxWithUsage(prompt, model, apiKey, maxTokens)).text
}

/** O mesmo pedido, com o consumo junto — ver a nota em `claude.ts`. */
export async function askAuxWithUsage(
  prompt: string,
  model?: string | null,
  apiKey?: string | null,
  maxTokens = 600,
): Promise<{ text: string; usage: TokenUsage }> {
  const response = await buildClient(apiKey).chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_completion_tokens: maxTokens,
    reasoning_effort: 'minimal',
    messages: [{ role: 'user', content: prompt }],
  })
  return {
    text: response.choices[0]?.message?.content ?? '',
    usage: { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 },
  }
}

export async function planSectorResponse(
  options: RouterOption[],
  currentIndices: number[],
  defaultIndex: number,
  recentMessages: ChatTurn[],
  visitorMessage: string,
  model?: string | null,
  apiKey?: string | null,
): Promise<SectorPlan> {
  const response = await buildClient(apiKey).chat.completions.create({
    model: model || DEFAULT_MODEL,
    max_completion_tokens: 150,
    reasoning_effort: 'minimal',
    messages: [
      { role: 'system', content: SECTOR_PLANNER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildSectorPlannerPrompt(options, currentIndices, defaultIndex, recentMessages, visitorMessage),
      },
    ],
  })

  const text = response.choices[0]?.message?.content
  if (!text) return { specialists: [defaultIndex], clarify: false }
  return parseSectorPlan(text, options.length, defaultIndex)
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
