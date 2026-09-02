import { featureFlags } from '../featureFlags'
import type { FeatureFlags } from '../featureFlags'

// Single scope-aware navigation source (UX reorg §15.1). Desktop sidebar, mobile
// drawer and bottom bar all derive from this — never a raw NAV.map per surface.
export type NavScope = 'general' | 'floor' | 'communication'
// Visual grouping in the rail/drawer (finer than scope). Automation is NOT a group:
// scheduled work is CREATED inside each agent as Rotinas/Gatilhos, never in a
// standalone builder. 'control' is the opposite direction — one building-wide place
// to SEE that work: what is scheduled, armed, running and done.
export type NavGroup = 'operation' | 'resources' | 'communication' | 'control' | 'community'

export interface NavItemDef {
  key: string
  label: string
  // Compact label for the mobile bottom bar (falls back to `label`).
  shortLabel?: string
  icon: string
  scope: NavScope
  group: NavGroup
  path: (floorId: string | null) => string
  // Route prefixes that keep this item active (details keep the parent active).
  activePrefixes: (floorId: string | null) => string[]
  // Active only on an exact path match (the floor home must not stay lit on its
  // own sub-pages like /agents).
  exact?: boolean
  mobilePrimary?: boolean
  featureFlag?: keyof FeatureFlags
}

const floorPath = (floorId: string | null, suffix: string, legacy: string) => (floorId ? `/floors/${floorId}${suffix}` : legacy)

export const NAV_V2: NavItemDef[] = [
  // Operation surfaces: the floor overview + the teams that staff it (kept together).
  // The floor home is also the building home — exact match so it doesn't stay active
  // on the floor's sub-pages.
  { key: 'floor', label: 'Visão do andar', shortLabel: 'Andar', icon: 'building-2', scope: 'floor', group: 'operation', path: (f) => floorPath(f, '', '/dashboard'), activePrefixes: (f) => (f ? [`/floors/${f}`] : ['/dashboard']), exact: true, mobilePrimary: true },
  { key: 'sectors', label: 'Setores', icon: 'network', scope: 'floor', group: 'operation', path: (f) => floorPath(f, '/sectors', '/setores'), activePrefixes: (f) => [floorPath(f, '/sectors', '/setores')] },
  { key: 'agents', label: 'Agentes', icon: 'users-round', scope: 'floor', group: 'operation', path: (f) => floorPath(f, '/agents', '/agents'), activePrefixes: (f) => [floorPath(f, '/agents', '/agents')], mobilePrimary: true },
  // Canais and Conversas are no longer static entries: they are pages of the Chat Web
  // and WhatsApp Apps, and appear under "Apps fixados" when the user pins them
  // (see PinnedAppsNav). They stay reachable from /apps whether pinned or not.
  // Building-wide observability over the agents' automatic work. It is a control
  // surface, not an editor: every row links back to the agent that owns the work.
  // What the account can reach: connected once here, granted per agent.
  // "Montar operação" NÃO está aqui de propósito: ela cria e reutiliza andares, então
  // mora no menu de andares — `BuildingSwitcher` no desktop, `MobileFloorPicker` no
  // celular —, logo abaixo de criar um à mão. O endereço `/architect` não mudou.
  /**
   * RECURSOS: o que o escritório possui. Apps já era isto e estava em CONTROLE, ao lado
   * de telas de observação — o que misturava "o que existe" com "o que aconteceu".
   */
  { key: 'resources', label: 'Recursos', icon: 'layers', scope: 'general', group: 'resources', path: () => '/resources', activePrefixes: () => ['/resources'] },
  { key: 'apps', label: 'Apps', icon: 'blocks', scope: 'general', group: 'resources', path: () => '/apps', activePrefixes: () => ['/apps'] },
  // Históricos: o que a conta guarda ao longo do tempo. Fica em CONTROLE porque é uma
  // superfície de observação — quem entra aqui vem consultar, não construir.
  { key: 'databases', label: 'Databases', icon: 'database', scope: 'general', group: 'resources', path: () => '/databases', activePrefixes: () => ['/databases'] },
  // Históricos continua no lugar de sempre: ele é a REGRA de gravação, e Databases é o
  // recurso que a expõe. Mover a rota agora quebraria bookmark por uma reorganização
  // que ainda não terminou.
  { key: 'data-history', label: 'Históricos', icon: 'clock', scope: 'general', group: 'resources', path: () => '/historicos', activePrefixes: () => ['/historicos'] },
  // O plantão: o que o escritório vigia. Fica em OPERAÇÕES porque é observação — quem
  // entra aqui vem ver o que está armado, não construir um agente.
  // A ATIVIDADE: o que aconteceu, correlacionado do começo ao fim. Fica ao lado de
  // Execuções porque as duas respondem à mesma pergunta em níveis diferentes — aqui a
  // cadeia inteira, lá a execução da automação.
  { key: 'activity', label: 'Atividade', icon: 'activity', scope: 'general', group: 'control', path: () => '/activity', activePrefixes: () => ['/activity'] },
  { key: 'monitors', label: 'Monitores', icon: 'radar', scope: 'general', group: 'control', path: () => '/monitors', activePrefixes: () => ['/monitors'] },
  { key: 'executions', label: 'Execuções', icon: 'activity', scope: 'general', group: 'control', path: () => '/executions', activePrefixes: () => ['/executions'], mobilePrimary: true },
  // COMUNIDADE: o que dá para instalar, o que é seu e o que já está aqui. Entrou quando o
  // Marketplace passou a existir de verdade — um item de menu que leva a uma tela vazia
  // promete e não entrega. Fica no fim da lista porque fica no fim dos grupos: uma
  // declaração fora de ordem faria a trilha do teclado discordar da tela.
  { key: 'community', label: 'Comunidade', icon: 'store', scope: 'general', group: 'community', path: () => '/community', activePrefixes: () => ['/community'] },
]

export function navItemsFor(_floorId: string | null): NavItemDef[] {
  return NAV_V2.filter((i) => !i.featureFlag || featureFlags[i.featureFlag])
}

/**
 * A ordem das camadas: quem existe, o que o escritório possui, o que acontece, e o que dá
 * para trazer de fora.
 *
 * COMUNIDADE fica por último de propósito: ela é a única que traz coisa de terceiro para
 * dentro, e essa distância na lista é a mesma distância que a cabeça de quem usa faz.
 */
const NAV_GROUP_ORDER: NavGroup[] = ['operation', 'resources', 'communication', 'control', 'community']
const NAV_GROUP_LABEL: Record<NavGroup, string> = {
  operation: 'ESCRITÓRIO',
  resources: 'RECURSOS',
  communication: 'COMUNICAÇÃO',
  control: 'OPERAÇÕES',
  community: 'COMUNIDADE',
}

// Ordered, non-empty nav groups for the rail/drawer. The operation group shows the
// active floor's name; feature-flagged items are already filtered out.
export function navGroupsFor(floorId: string | null, activeFloorName?: string): { group: NavGroup; label: string; items: NavItemDef[] }[] {
  const all = navItemsFor(floorId)
  const groups: { group: NavGroup; label: string; items: NavItemDef[] }[] = []
  for (const group of NAV_GROUP_ORDER) {
    const items = all.filter((i) => i.group === group)
    if (!items.length) continue
    const label = group === 'operation' && activeFloorName ? `ESCRITÓRIO · ${activeFloorName.toUpperCase()}` : NAV_GROUP_LABEL[group]
    groups.push({ group, label, items })
  }
  return groups
}

// True when the current pathname matches one of an item's active prefixes.
export function isNavActive(item: NavItemDef, floorId: string | null, pathname: string): boolean {
  return item.activePrefixes(floorId).some((p) => (item.exact ? pathname === p : pathname === p || pathname.startsWith(p + '/')))
}
