import type { AgentStatus } from '../ui'
import { characterSrc } from './officeAssets'

// A stable character + accent colour per agent, derived from its id, so the
// same agent looks identical on the office map and on its detail page. The full
// cast lives under public/illustrations/characters/, but the app only assigns
// the ten faces the design officially ships — the polished set — so no rough
// extra character ever shows up on an agent.
const CHARACTERS = [
  'lia', 'mel', 'bruno', 'nina', 'teo', 'rafa', 'iris', 'caio', 'duda', 'noah',
] as const
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

// Fallback when the full agent list isn't available (single-id lookups before
// data loads): stable per id, but can repeat.
export function characterFor(id: string): string {
  return CHARACTERS[hash(id) % CHARACTERS.length]
}

export interface CharacterResolver {
  character: (id: string) => string
  portrait: (id: string) => string
}

// Round-robin assignment over the WHOLE team: sort the ids into a stable order,
// then hand out characters in sequence — so no face repeats until the cast runs
// out, at which point the cycle starts over. Same team list → same result on
// every screen, so an agent keeps its face on the map, its card and its page.
export function buildCharacterResolver(ids: string[]): CharacterResolver {
  const order = [...new Set(ids)].sort()
  const byId = new Map<string, string>()
  order.forEach((id, i) => byId.set(id, CHARACTERS[i % CHARACTERS.length]))
  const character = (id: string) => byId.get(id) ?? characterFor(id)
  return {
    character,
    portrait: (id: string) => characterSrc(character(id), 'retrato'),
  }
}

export function accentFor(id: string): string {
  // Offset so the accent isn't perfectly correlated with the character.
  return ACCENTS[(hash(id) + 2) % ACCENTS.length]
}

export function portraitFor(id: string): string {
  return characterSrc(characterFor(id), 'retrato')
}

export function statusFor(id: string): AgentStatus {
  return STATUSES[hash(id) % STATUSES.length]
}

export interface AgentStat {
  label: string
  value: string
}
