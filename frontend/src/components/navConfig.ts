import { featureFlags } from '../featureFlags'
import type { FeatureFlags } from '../featureFlags'

// Single scope-aware navigation source (UX reorg §15.1). Desktop sidebar, mobile
// drawer and bottom bar all derive from this — never a raw NAV.map per surface.
export type NavScope = 'general' | 'floor' | 'communication'
// Visual grouping in the rail/drawer (finer than scope). Automation is NOT a group:
// scheduled work is CREATED inside each agent as Rotinas/Gatilhos, never in a
// standalone builder. 'control' is the opposite direction — one building-wide place
// to SEE that work: what is scheduled, armed, running and done.
export type NavGroup = 'operation' | 'communication' | 'control'

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
  { key: 'apps', label: 'Apps', icon: 'blocks', scope: 'general', group: 'control', path: () => '/apps', activePrefixes: () => ['/apps'] },
  { key: 'executions', label: 'Execuções', icon: 'activity', scope: 'general', group: 'control', path: () => '/executions', activePrefixes: () => ['/executions'], mobilePrimary: true },
]

export function navItemsFor(_floorId: string | null): NavItemDef[] {
  return NAV_V2.filter((i) => !i.featureFlag || featureFlags[i.featureFlag])
}

const NAV_GROUP_ORDER: NavGroup[] = ['operation', 'communication', 'control']
const NAV_GROUP_LABEL: Record<NavGroup, string> = {
  operation: 'ANDAR',
  communication: 'COMUNICAÇÃO',
  control: 'CONTROLE',
}

// Ordered, non-empty nav groups for the rail/drawer. The operation group shows the
// active floor's name; feature-flagged items are already filtered out.
export function navGroupsFor(floorId: string | null, activeFloorName?: string): { group: NavGroup; label: string; items: NavItemDef[] }[] {
  const all = navItemsFor(floorId)
  const groups: { group: NavGroup; label: string; items: NavItemDef[] }[] = []
  for (const group of NAV_GROUP_ORDER) {
    const items = all.filter((i) => i.group === group)
    if (!items.length) continue
    const label = group === 'operation' && activeFloorName ? `ANDAR · ${activeFloorName.toUpperCase()}` : NAV_GROUP_LABEL[group]
    groups.push({ group, label, items })
  }
  return groups
}

// True when the current pathname matches one of an item's active prefixes.
export function isNavActive(item: NavItemDef, floorId: string | null, pathname: string): boolean {
  return item.activePrefixes(floorId).some((p) => (item.exact ? pathname === p : pathname === p || pathname.startsWith(p + '/')))
}
