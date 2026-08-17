// Como o modelo é chamado — e o que este produto se recusa a prometer.
//
// A tentação de uma tela de "configurações avançadas" é oferecer todo parâmetro que
// algum provedor aceita. O resultado é conhecido: o dono liga `temperature` num modelo
// que não aceita, o adapter manda de qualquer jeito, o provedor devolve 400, e a
// execução falha por causa de um campo que a interface ofereceu.
//
// Aqui a matriz de capacidades é a fonte de verdade nas duas pontas: a interface só
// mostra o que aquele provedor/modelo aceita, e o adapter nunca envia o que ele não
// aceita. Um campo não suportado não é "ignorado silenciosamente" — ele não chega a
// existir para aquele modelo.
//
// TODO campo é opcional, e ausente significa "Padrão do sistema". Isso não é
// conveniência: é o que garante que um agente criado antes desta tela se comporte
// exatamente como antes.

export type ToolChoice = 'auto' | 'none' | 'required'
export const TOOL_CHOICES: readonly ToolChoice[] = ['auto', 'none', 'required']

export type ReasoningEffort = 'low' | 'medium' | 'high'
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high']

/**
 * A configuração de execução. Tudo opcional; ausente = padrão do sistema.
 *
 * `provider` e `model` NÃO estão aqui de propósito: eles já existem no agente e
 * continuam canônicos. Duplicá-los criaria duas verdades sobre qual modelo roda.
 */
export interface RunConfig {
  temperature?: number
  reasoningEffort?: ReasoningEffort
  maxOutputTokens?: number
  toolChoice?: ToolChoice
  timeoutMs?: number
  retries?: number
  parallelTools?: boolean
  cache?: boolean
  stream?: boolean
}

/** O que um provedor/modelo aceita de fato. */
export interface ModelCapabilities {
  temperature: boolean
  reasoningEffort: boolean
  maxOutputTokens: boolean
  toolChoice: boolean
  parallelTools: boolean
  cache: boolean
  stream: boolean
}

const TUDO: ModelCapabilities = {
  temperature: true,
  reasoningEffort: false,
  maxOutputTokens: true,
  toolChoice: true,
  parallelTools: true,
  cache: true,
  /**
   * Streaming está DESLIGADO em toda a matriz, e é uma decisão, não um esquecimento.
   *
   * O transporte não existe: nem o servidor emite pedaços, nem a tela os desenha.
   * Oferecer a opção agora seria prometer uma experiência que não acontece — e a
   * alternativa pior seria "simular", entregando a resposta inteira de uma vez com um
   * efeito de digitação, que é enganar o usuário sobre onde está o tempo de espera.
   *
   * Quando o transporte existir, esta linha vira `true` e a opção aparece sozinha.
   */
  stream: false,
}

/**
 * A matriz. Conservadora de propósito.
 *
 * Um recurso só é declarado quando este código sabe enviá-lo corretamente. Marcar algo
 * como suportado "porque o provedor tem" transfere o erro para a execução do dono; não
 * marcar apenas esconde uma opção que ele não perdeu.
 *
 * Modelos de raciocínio (a família `o` da OpenAI, e os Claude com esforço) não aceitam
 * `temperature` — mandar o campo é erro, não ajuste ignorado.
 */
const MATRIX: { provider: string; match: RegExp; caps: Partial<ModelCapabilities> }[] = [
  // OpenAI, família de raciocínio: sem temperature, com esforço.
  { provider: 'openai', match: /^(o[1-9]|gpt-5)/i, caps: { temperature: false, reasoningEffort: true, cache: false } },
  // OpenAI em geral: o cache de prefixo é automático e não tem opt-out, então oferecer um
  // controle seria oferecer um botão que não faz nada.
  { provider: 'openai', match: /.*/, caps: { cache: false } },
  // Anthropic com esforço de raciocínio.
  { provider: 'anthropic', match: /^claude-(opus-[5-9]|sonnet-[5-9]|fable)/i, caps: { reasoningEffort: true } },
]

export function capabilitiesFor(provider: string | null | undefined, model: string | null | undefined): ModelCapabilities {
  const p = (provider ?? '').toLowerCase()
  const m = model ?? ''
  const linha = MATRIX.find((r) => r.provider === p && r.match.test(m))
  return { ...TUDO, ...(linha?.caps ?? {}) }
}

// --- limites ------------------------------------------------------------------------------
//
// Tetos, não sugestões. Um `timeoutMs` de duas horas seguraria um worker; um `retries`
// de cinquenta multiplicaria por cinquenta a conta de uma falha persistente.
export const LIMITS = {
  temperature: { min: 0, max: 2 },
  maxOutputTokens: { min: 64, max: 32_000 },
  timeoutMs: { min: 5_000, max: 600_000 },
  retries: { min: 0, max: 3 },
} as const

const dentro = (v: number, faixa: { min: number; max: number }): number => Math.min(faixa.max, Math.max(faixa.min, v))
const numeroFinito = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Sanea o que veio da API.
 *
 * Valor fora da faixa é APERTADO para o limite, não recusado: o dono digitou 5 na
 * temperatura porque queria "bem criativo", e recusar o salvamento inteiro por causa
 * disso é pior que salvar 2 e mostrar 2. Já um campo com tipo errado é descartado — ele
 * não expressa intenção nenhuma.
 */
export function normalizeRunConfig(raw: unknown): RunConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out: RunConfig = {}

  if (numeroFinito(r.temperature)) out.temperature = Math.round(dentro(r.temperature, LIMITS.temperature) * 100) / 100
  if (typeof r.reasoningEffort === 'string' && (REASONING_EFFORTS as readonly string[]).includes(r.reasoningEffort)) {
    out.reasoningEffort = r.reasoningEffort as ReasoningEffort
  }
  if (numeroFinito(r.maxOutputTokens)) out.maxOutputTokens = Math.round(dentro(r.maxOutputTokens, LIMITS.maxOutputTokens))
  if (typeof r.toolChoice === 'string' && (TOOL_CHOICES as readonly string[]).includes(r.toolChoice)) out.toolChoice = r.toolChoice as ToolChoice
  if (numeroFinito(r.timeoutMs)) out.timeoutMs = Math.round(dentro(r.timeoutMs, LIMITS.timeoutMs))
  if (numeroFinito(r.retries)) out.retries = Math.round(dentro(r.retries, LIMITS.retries))
  if (typeof r.parallelTools === 'boolean') out.parallelTools = r.parallelTools
  if (typeof r.cache === 'boolean') out.cache = r.cache
  if (typeof r.stream === 'boolean') out.stream = r.stream

  return out
}

/**
 * A precedência: execução/rotina > agente > provedor.
 *
 * Camada de cima ganha CAMPO A CAMPO, não em bloco. Um objeto inteiro substituindo o
 * outro faria a rotina que só quis mudar o timeout perder a temperatura do agente.
 */
export function resolveRunConfig(...camadas: (RunConfig | null | undefined)[]): RunConfig {
  const out: RunConfig = {}
  for (const camada of camadas) {
    if (!camada) continue
    for (const [k, v] of Object.entries(camada)) {
      if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v
    }
  }
  return out
}

export type RunContext = 'chat' | 'automation'

export interface EffectiveRunConfig extends RunConfig {
  // Quais campos foram DESCARTADOS por não serem suportados, e por quê. Vai para o
  // log: um parâmetro que silenciosamente não vale é pior que um erro.
  dropped: { field: string; reason: string }[]
}

/**
 * O que efetivamente vai para o adapter, dado o modelo e o contexto.
 *
 * É a única função que o adapter deveria consultar. Ela remove — não ignora — todo
 * campo que aquele modelo não aceita, e aplica as regras que não são do provedor e sim
 * deste produto:
 *
 * - `stream` só em chat. Uma automação grava o resultado e segue; streaming ali não
 *   tem para quem entregar os pedaços, e complica o caminho de erro sem ganho nenhum.
 * - `parallelTools` só quando TODAS as ferramentas disponíveis são de leitura. Duas
 *   escritas em paralelo podem chegar fora de ordem, e a ordem é o que o dono
 *   configurou. Basta uma ferramenta de escrita para tudo virar sequencial.
 * - `toolChoice: 'required'` sem ferramenta nenhuma é contradição: o modelo seria
 *   obrigado a chamar algo que não existe.
 */
export function effectiveRunConfig(
  config: RunConfig,
  opts: { provider?: string | null; model?: string | null; context: RunContext; toolRisks?: ('read' | 'write' | 'high_risk')[] },
): EffectiveRunConfig {
  const caps = capabilitiesFor(opts.provider, opts.model)
  const out: EffectiveRunConfig = { ...config, dropped: [] }
  const descartar = (field: keyof RunConfig, reason: string) => {
    if (out[field] === undefined) return
    delete out[field]
    out.dropped.push({ field, reason })
  }

  if (!caps.temperature) descartar('temperature', 'este modelo não aceita temperatura')
  if (!caps.reasoningEffort) descartar('reasoningEffort', 'este modelo não expõe esforço de raciocínio')
  if (!caps.maxOutputTokens) descartar('maxOutputTokens', 'este modelo não aceita limite de saída')
  if (!caps.toolChoice) descartar('toolChoice', 'este modelo não aceita escolha de ferramenta')
  if (!caps.cache) descartar('cache', 'este modelo não suporta cache de prompt')

  if (!caps.stream) descartar('stream', 'este modelo não suporta streaming')
  else if (opts.context !== 'chat' && out.stream) descartar('stream', 'streaming vale só em conversa; automação grava o resultado')

  if (!caps.parallelTools) descartar('parallelTools', 'este modelo não suporta chamadas paralelas')
  else if (out.parallelTools && (opts.toolRisks ?? []).some((r) => r !== 'read')) {
    descartar('parallelTools', 'há ferramenta que altera dados: a ordem precisa ser garantida')
  }

  const semFerramentas = (opts.toolRisks ?? []).length === 0
  if (out.toolChoice === 'required' && semFerramentas) {
    descartar('toolChoice', 'não há ferramenta disponível para tornar obrigatória')
  }

  return out
}

/**
 * Uma falha merece nova inferência?
 *
 * Só antes de haver resposta válida, e só quando o motivo é transitório. Repetir por
 * falha de PERSISTÊNCIA ou de telemetria seria pagar a inferência duas vezes por um
 * problema que não é do modelo — o texto já existe, o que falhou foi guardá-lo.
 */
export const RETRYABLE_KINDS: readonly string[] = ['provider', 'network', 'timeout', 'rate_limit']

export function shouldRetryInference(kind: string, opts: { hasValidAnswer: boolean }): boolean {
  if (opts.hasValidAnswer) return false
  return RETRYABLE_KINDS.includes(kind)
}
