import type { AgentStatus } from '../ui'

// A stable character + accent colour per agent, derived from its id, so the
// same agent looks identical on the office map and on its detail page.
const CHARACTERS = ['bruno', 'lia', 'nina', 'teo'] as const
// Ambient, decorative statuses (the app has no live per-agent status) — stable
// per agent so the map and the cards always agree.
const STATUSES: AgentStatus[] = ['working', 'thinking', 'idle', 'break']
const ACCENTS = [
  'var(--dept-vendas)',
  'var(--dept-suporte)',
  'var(--dept-marketing)',
  'var(--dept-financeiro)',
  'var(--dept-dev)',
  'var(--dept-rh)',
]

function hash(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function characterFor(id: string): string {
  return CHARACTERS[hash(id) % CHARACTERS.length]
}

export function accentFor(id: string): string {
  // Offset so the accent isn't perfectly correlated with the character.
  return ACCENTS[(hash(id) + 2) % ACCENTS.length]
}

export function portraitFor(id: string): string {
  return `/illustrations/characters/${characterFor(id)}.svg`
}

export function statusFor(id: string): AgentStatus {
  return STATUSES[hash(id) % STATUSES.length]
}

export interface AgentStat {
  label: string
  value: string
}
