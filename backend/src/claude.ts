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
  opts: { runConfig?: EffectiveRunConfig; signal?: AbortSignal; onToolStart?: (risk: 'read' | 'write' | 'high_risk') => void } = {},
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

  /**
   * A configuração do dono, traduzida para os nomes da Anthropic.
   *
   * Os padrões que já existiam continuam quando o campo está ausente — `max_tokens:
   * 1024` e esforço baixo eram o comportamento de todo agente, e mudá-los aqui mexeria
   * em todos de uma vez.
   *
   * O que era hardcode e passa a ser escolha: `max_tokens` e o esforço. `thinking` só é
   * desligado quando o esforço não foi pedido — pedir esforço alto e desligar o
   * raciocínio na linha seguinte seria anular a escolha.
   */
  const cfg: Partial<EffectiveRunConfig> = opts.runConfig ?? {}
  const esforco = cfg.reasoningEffort
  const tuning = {
    max_tokens: cfg.maxOutputTokens ?? 1024,
    ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
    ...(esforco ? { output_config: { effort: esforco } } : { thinking: { type: 'disabled' as const }, output_config: { effort: 'low' as const } }),
  }

  // `none` não é uma opção de `tool_choice` aqui: a forma de proibir ferramenta é não
  // mandar ferramenta nenhuma. Mandar a lista e pedir para não usar gasta tokens
  // descrevendo o que não pode ser chamado.
  const proibirFerramentas = cfg.toolChoice === 'none'
  const escolha: Anthropic.MessageCreateParams['tool_choice'] | undefined =
    cfg.toolChoice === 'required'
      ? { type: 'any', ...(cfg.parallelTools === false ? { disable_parallel_tool_use: true } : {}) }
      : cfg.parallelTools === false
        ? { type: 'auto', disable_parallel_tool_use: true }
        : undefined

  // Agentic loop: keep letting the model call tools until it answers, or we hit
  // the iteration cap (on the last pass tools are withheld so it must reply).
  for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
    const allowTools = toolDefs.length > 0 && !proibirFerramentas && iteration < MAX_TOOL_ITERATIONS
    // O sinal também vai para o SDK: ele aborta a requisição em curso em vez de
    // deixá-la terminar sozinha e produzir um resultado que ninguém vai usar.
    const response = await client.messages.create(
      {
        model: model || DEFAULT_MODEL,
        ...tuning,
        system,
        messages,
        ...(allowTools ? { tools: toolDefs } : {}),
        ...(allowTools && escolha ? { tool_choice: escolha } : {}),
      },
      opts.signal ? { signal: opts.signal } : undefined,
    )
    const turnUsage = anthropicUsage(response.usage)
    usage.inputTokens += turnUsage.inputTokens
    usage.outputTokens += turnUsage.outputTokens

    if (allowTools && response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content })
      const pedidos = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

      /**
       * Em paralelo só quando TODAS as chamadas deste lote são de leitura.
       *
       * A decisão é sobre as ferramentas CHAMADAS, não sobre as disponíveis: o modelo
       * pode ter dez à mão e pedir duas leituras — esse lote é seguro. E basta uma
       * escrita para tudo voltar a ser sequencial, porque a ordem em que duas escritas
       * chegam ao outro lado é o que o dono configurou.
       *
       * Risco ausente conta como escrita. Uma ferramenta que não declarou o que faz não
       * ganha paralelismo por omissão.
       */
      const soLeitura = pedidos.every((p) => tools.find((t) => t.name === p.name)?.risk === 'read')
      const emParalelo = opts.runConfig?.parallelTools === true && soLeitura && pedidos.length > 1

      const executar = (bloco: Anthropic.ToolUseBlock) => {
        // A porteira: uma tentativa cancelada não INICIA mais nada. Sem esta linha o
        // laço continuaria chamando ferramentas depois do timeout, e a escrita que o
        // dono já desistiu de esperar aconteceria assim mesmo.
        if (opts.signal?.aborted) throw new Error('execução cancelada por tempo esgotado')
        const ferramenta = tools.find((t) => t.name === bloco.name)
        opts.onToolStart?.(ferramenta?.risk ?? 'write')
        return runResolvedTool(tools, bloco.name, (bloco.input ?? {}) as Record<string, unknown>)
      }

      // `map` preserva a ordem em qualquer um dos caminhos: cada resultado volta no
      // índice do pedido, e o `tool_use_id` que os pareia vem do mesmo bloco.
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
        for (const bloco of pedidos) registros.push(await executar(bloco))
      }

      const results: Anthropic.ToolResultBlockParam[] = pedidos.map((bloco, i) => ({
        type: 'tool_result',
        tool_use_id: bloco.id,
        content: registros[i].result,
        is_error: !registros[i].ok,
      }))
      toolCalls.push(...registros)
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

export async function planSectorResponse(
  options: RouterOption[],
  currentIndices: number[],
  defaultIndex: number,
  recentMessages: ChatTurn[],
  visitorMessage: string,
  model?: string | null,
  apiKey?: string | null,
): Promise<SectorPlan> {
  const response = await buildClient(apiKey).messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 80,
    system: SECTOR_PLANNER_SYSTEM_PROMPT,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content: buildSectorPlannerPrompt(options, currentIndices, defaultIndex, recentMessages, visitorMessage),
      },
    ],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return { specialists: [defaultIndex], clarify: false }
  return parseSectorPlan(textBlock.text, options.length, defaultIndex)
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
