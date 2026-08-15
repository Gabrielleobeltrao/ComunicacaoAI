// The ONE public representation of a failure.
//
// A stored error message is written by whoever failed: a provider quoting the prompt
// it refused, a fetch quoting a URL with a key in the query string, a delivery
// quoting the address it could not reach. None of that may reach a screen, a log
// listing or an API response.
//
// So the message a caller sees is never derived from the stored one: the stored KIND
// selects a fixed sentence from the table below. There is nothing to truncate and no
// regex to outsmart — an unknown kind falls back to the generic sentence, and the
// original text stays in the database for an operator with direct access.

// The failure categories the engine actually produces (runner StepError kinds, the
// delivery adapter, and the run-level 'error'). Anything else is normalised to
// 'unknown', so a new kind cannot leak a message by being unmapped.
export type SafeErrorKind = 'provider' | 'timeout' | 'validation' | 'delivery' | 'fetch' | 'canceled' | 'error' | 'unknown'

const MESSAGE: Record<SafeErrorKind, string> = {
  provider: 'O provedor de IA recusou ou não conseguiu concluir a chamada.',
  timeout: 'A etapa passou do tempo limite.',
  validation: 'A configuração da etapa é inválida.',
  delivery: 'O envio do resultado falhou.',
  fetch: 'Não foi possível acessar o endereço configurado.',
  canceled: 'A execução foi cancelada.',
  error: 'A execução falhou.',
  unknown: 'A execução falhou por um motivo não classificado.',
}

const KINDS = new Set<string>(Object.keys(MESSAGE))

// Aliases kept for records written before this table existed, so an old run still
// reads as something meaningful instead of "não classificado".
const ALIAS: Record<string, SafeErrorKind> = {
  cancel: 'canceled',
  cancelled: 'canceled',
  http: 'fetch',
  network: 'fetch',
  ssrf: 'fetch',
  step: 'error',
  provider_error: 'provider',
}

export interface PublicError {
  // 'denied' only comes from the delegation table below; the rest are engine kinds.
  kind: SafeErrorKind | 'denied'
  // Chosen from a fixed table — NEVER derived from the stored message.
  message: string
}

export function safeErrorKind(kind: unknown): SafeErrorKind {
  const raw = String(kind ?? '')
    .trim()
    .toLowerCase()
  if (KINDS.has(raw)) return raw as SafeErrorKind
  return ALIAS[raw] ?? 'unknown'
}

// A stored error → what the API may return. Pass anything; only the kind is read.
export function publicError(error: { kind?: unknown } | null | undefined): PublicError | null {
  if (!error) return null
  const kind = safeErrorKind((error as { kind?: unknown }).kind)
  return { kind, message: MESSAGE[kind] }
}

// --- delegation ---------------------------------------------------------------------
// A delegation's stored `error` is whatever the target agent's failure produced — a
// provider string, a tool response, a quoted objective. It is never sent out either.
// What a person needs to know is WHY it did not happen, and that is fully described
// by the status plus the deny code the gate itself chose.

export type DelegationDenyCode = 'forbidden' | 'depth_exceeded' | 'cycle' | 'unauthorized' | 'budget_exceeded'

const DENY_MESSAGE: Record<DelegationDenyCode, string> = {
  forbidden: 'O agente de destino não pertence a este prédio ou a esta conta.',
  depth_exceeded: 'A cadeia de delegações passou do limite de profundidade.',
  cycle: 'A delegação formaria um ciclo entre os agentes.',
  unauthorized: 'Os agentes envolvidos não estão autorizados a delegar entre si.',
  budget_exceeded: 'O orçamento de tokens da cadeia acabou.',
}

const DENIED_FALLBACK = 'A delegação foi recusada pelas regras de autorização.'

// status + denyCode → what may be shown. The stored message is never read.
export function publicDelegationError(status: unknown, denyCode: unknown): PublicError | null {
  if (status === 'denied') {
    const code = String(denyCode ?? '') as DelegationDenyCode
    return { kind: 'denied', message: DENY_MESSAGE[code] ?? DENIED_FALLBACK }
  }
  if (status === 'failed') return { kind: 'error', message: MESSAGE.error }
  if (status === 'canceled') return { kind: 'canceled', message: MESSAGE.canceled }
  return null
}
