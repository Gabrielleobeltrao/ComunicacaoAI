// A matriz de capacidades, do lado da tela.
//
// Ela existe nas duas pontas de propósito, e não por descuido: o servidor precisa dela
// para nunca ENVIAR um parâmetro não suportado, e a tela precisa dela para nunca
// OFERECER um. Se só o servidor tivesse, a interface mostraria um campo que é descartado
// em silêncio — e o dono ajustaria a criatividade de um modelo que não tem criatividade,
// sem nada dizer.
//
// As duas cópias têm um teste que as compara. Divergir é o defeito real aqui.

export type ToolChoice = 'auto' | 'none' | 'required'
export const TOOL_CHOICES: readonly ToolChoice[] = ['auto', 'none', 'required']

export type ReasoningEffort = 'low' | 'medium' | 'high'
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high']

// Tudo opcional; ausente = padrão do sistema. `provider` e `model` continuam nos campos
// próprios do agente — duplicá-los aqui criaria duas verdades sobre qual modelo roda.
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
  stream: true,
}

// Espelho de backend/src/runConfig.ts. Conservadora: um recurso só é declarado quando o
// código sabe enviá-lo corretamente.
const MATRIX: { provider: string; match: RegExp; caps: Partial<ModelCapabilities> }[] = [
  { provider: 'openai', match: /^(o[1-9]|gpt-5)/i, caps: { temperature: false, reasoningEffort: true } },
  { provider: 'anthropic', match: /^claude-(opus-[5-9]|sonnet-[5-9]|fable)/i, caps: { reasoningEffort: true } },
]

export function capabilitiesFor(provider: string | null | undefined, model: string | null | undefined): ModelCapabilities {
  const p = (provider ?? '').toLowerCase()
  const m = model ?? ''
  const linha = MATRIX.find((r) => r.provider === p && r.match.test(m))
  return { ...TUDO, ...(linha?.caps ?? {}) }
}

// Remove o que ficou vazio antes de enviar: um campo `undefined` no corpo é a forma de
// dizer "padrão do sistema", e mandar `null` seria dizer outra coisa.
export const cleanRunConfig = (c: RunConfig): RunConfig => {
  const out: RunConfig = {}
  for (const [k, v] of Object.entries(c)) {
    if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v
  }
  return out
}
