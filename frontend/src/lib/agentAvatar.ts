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

/**
 * QUEM A ARTE MOSTRA — lido dos retratos, não do nome do arquivo.
 *
 * A face saía do id e mais nada, então uma agente chamada Marina aparecia com o retrato do
 * Bruno na metade das vezes. Quem olha a tela lê a imagem antes do nome, e os dois se
 * contradiziam. `mel` fica de fora dos dois grupos de propósito: o retrato não marca, e
 * inventar uma marca que a arte não tem seria repetir o erro do outro lado.
 */
const APRESENTACAO: Record<string, 'f' | 'm'> = {
  lia: 'f', nina: 'f', iris: 'f', duda: 'f', noah: 'f',
  bruno: 'm', teo: 'm', rafa: 'm', caio: 'm',
}

/**
 * O gênero que um nome apresenta em português — quando ele apresenta algum.
 *
 * Só decide onde a língua é clara, e devolve `null` no resto. Um palpite errado aqui
 * custa mais do que não escolher: quem não é reconhecido é uma pessoa, e a saída
 * neutra (o elenco inteiro) nunca contradiz ninguém.
 */
const MASCULINO_EM_A = new Set(['luca', 'dante', 'nicola', 'juca', 'jonatha', 'josua'])

export function generoDoNome(nome: string): 'f' | 'm' | null {
  const n = nome.trim().toLowerCase().split(/\s+/)[0] ?? ''
  if (!n) return null
  if (MASCULINO_EM_A.has(n)) return 'm'
  if (/(a|ana|ina|ete|ice|elle)$/.test(n)) return 'f'
  if (/(o|os|or|el|il|ur|son|ton|ael|iel)$/.test(n)) return 'm'
  return null
}

/** As faces que combinam com o nome. Sem nome, ou sem certeza, o elenco inteiro. */
export function elencoPara(nome?: string): readonly string[] {
  const g = nome ? generoDoNome(nome) : null
  if (!g) return CHARACTERS
  const casam = CHARACTERS.filter((c) => APRESENTACAO[c] === g)
  return casam.length ? casam : CHARACTERS
}
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
export function characterFor(id: string, name?: string): string {
  const elenco = elencoPara(name)
  return elenco[hash(id) % elenco.length]
}

export interface CharacterResolver {
  character: (id: string) => string
  portrait: (id: string) => string
}

// Stable, low-repeat character assignment. Existing agents keep the face they
// were given (from the `prior` map); each new agent takes the least-used face,
// tie-broken deterministically by id. So adding one agent never reshuffles the
// others, and faces don't repeat until the cast runs out. Pure and testable.
export interface AgentFace {
  id: string
  name?: string
}

export function assignCharacters(quem: AgentFace[], prior?: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>()
  const count = new Map<string, number>(CHARACTERS.map((c) => [c, 0]))
  const nomeDe = new Map(quem.map((a) => [a.id, a.name]))
  const ids = quem.map((a) => a.id)
  if (prior)
    for (const id of ids) {
      const c = prior.get(id)
      // Uma face guardada que contradiz o nome NÃO é preservada: continuar respeitando a
      // escolha antiga manteria o erro para sempre em quem já existe.
      if (c && elencoPara(nomeDe.get(id)).includes(c) && !out.has(id)) {
        out.set(id, c)
        count.set(c, (count.get(c) ?? 0) + 1)
      }
    }
  for (const id of [...new Set(ids)].filter((id) => !out.has(id)).sort()) {
    const elenco = elencoPara(nomeDe.get(id))
    const min = Math.min(...elenco.map((c) => count.get(c) ?? 0))
    const cands = elenco.filter((c) => (count.get(c) ?? 0) === min)
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
export function buildCharacterResolver(quem: AgentFace[]): CharacterResolver {
  const byId = assignCharacters(quem, loadCharmap())
  saveCharmap(byId)
  const nomeDe = new Map(quem.map((a) => [a.id, a.name]))
  const character = (id: string) => byId.get(id) ?? characterFor(id, nomeDe.get(id))
  return {
    character,
    portrait: (id: string) => characterSrc(character(id), 'retrato'),
  }
}

export function accentFor(id: string): string {
  // Offset so the accent isn't perfectly correlated with the character.
  return ACCENTS[(hash(id) + 2) % ACCENTS.length]
}

export function portraitFor(id: string, name?: string): string {
  return characterSrc(characterFor(id, name), 'retrato')
}

export function statusFor(id: string): AgentStatus {
  return STATUSES[hash(id) % STATUSES.length]
}

export interface AgentStat {
  // Compact label shown on the card (must fit a narrow mobile column).
  label: string
  value: string
  // Full label/definition, surfaced as the tooltip.
  title?: string
}
