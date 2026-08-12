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

// Stable, low-repeat character assignment. Existing agents keep the face they
// were given (from the `prior` map); each new agent takes the least-used face,
// tie-broken deterministically by id. So adding one agent never reshuffles the
// others, and faces don't repeat until the cast runs out. Pure and testable.
export function assignCharacters(ids: string[], prior?: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>()
  const count = new Map<string, number>(CHARACTERS.map((c) => [c, 0]))
  const valid = new Set<string>(CHARACTERS)
  if (prior)
    for (const id of ids) {
      const c = prior.get(id)
      if (c && valid.has(c) && !out.has(id)) {
        out.set(id, c)
        count.set(c, (count.get(c) ?? 0) + 1)
      }
    }
  for (const id of [...new Set(ids)].filter((id) => !out.has(id)).sort()) {
    const min = Math.min(...CHARACTERS.map((c) => count.get(c)!))
    const cands = CHARACTERS.filter((c) => count.get(c) === min)
    const pick = cands[hash(id) % cands.length]
    out.set(id, pick)
    count.set(pick, min + 1)
  }
  return out
}

const CHARMAP_KEY = 'office:charmap:v1'
function loadCharmap(): Map<string, string> | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined
    const raw = localStorage.getItem(CHARMAP_KEY)
    return raw ? new Map(Object.entries(JSON.parse(raw) as Record<string, string>)) : undefined
  } catch {
    return undefined
  }
}
function saveCharmap(map: Map<string, string>) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CHARMAP_KEY, JSON.stringify(Object.fromEntries(map)))
  } catch {
    /* ignore */
  }
}

// Same team → same faces on every screen. A locally-persisted map keeps each
// agent's face stable across additions/reloads (no backend); without storage it
// falls back to the deterministic assignment above.
export function buildCharacterResolver(ids: string[]): CharacterResolver {
  const byId = assignCharacters(ids, loadCharmap())
  saveCharmap(byId)
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
