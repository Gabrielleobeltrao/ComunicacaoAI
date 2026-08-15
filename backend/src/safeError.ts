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
  kind: SafeErrorKind
  // Chosen from the table above — NEVER derived from the stored message.
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
