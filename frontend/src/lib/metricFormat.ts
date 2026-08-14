// Operational-metric formatters. A null value means "no telemetry" and renders as
// the em dash "—", kept distinct from a real zero (which renders as "0").
export const EMPTY = '—'

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return EMPTY
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(ms < 600_000 ? 1 : 0)}min`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return EMPTY
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatCount(n: number | null | undefined): string {
  if (n == null) return EMPTY
  return n.toLocaleString('pt-BR')
}

export function formatPercent(rate: number | null | undefined): string {
  if (rate == null) return EMPTY
  return `${Math.round(rate * 100)}%`
}
