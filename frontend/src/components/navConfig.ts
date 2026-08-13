import { featureFlags } from '../featureFlags'
import type { FeatureFlags } from '../featureFlags'

// Single scope-aware navigation source (UX reorg §15.1). Desktop sidebar, mobile
// drawer and bottom bar all derive from this — never a raw NAV.map per surface.
export type NavScope = 'general' | 'floor' | 'communication'
// Visual grouping in the rail/drawer (finer than scope): the floor scope is split
// into the operation surfaces and the automation surfaces.
export type NavGroup = 'operation' | 'automation' | 'communication'

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
  // Automation surfaces: the workflows and their runs.
  { key: 'automations', label: 'Automações', icon: 'workflow', scope: 'floor', group: 'automation', path: (f) => floorPath(f, '/automations', '/automations'), activePrefixes: (f) => [floorPath(f, '/automations', '/automations')], mobilePrimary: true, featureFlag: 'aiAutomations' },
  { key: 'runs', label: 'Execuções', icon: 'history', scope: 'floor', group: 'automation', path: (f) => floorPath(f, '/runs', '/runs'), activePrefixes: (f) => [floorPath(f, '/runs', '/runs')], featureFlag: 'aiAutomations' },
  { key: 'channels', label: 'Canais', icon: 'share-2', scope: 'communication', group: 'communication', path: () => '/widgets', activePrefixes: () => ['/widgets'] },
  { key: 'conversations', label: 'Conversas', icon: 'message-circle', scope: 'communication', group: 'communication', path: () => '/chats', activePrefixes: () => ['/chats'] },
]

export function navItemsFor(_floorId: string | null): NavItemDef[] {
  return NAV_V2.filter((i) => !i.featureFlag || featureFlags[i.featureFlag])
}

const NAV_GROUP_ORDER: NavGroup[] = ['operation', 'automation', 'communication']
const NAV_GROUP_LABEL: Record<NavGroup, string> = {
  operation: 'ANDAR',
  automation: 'AUTOMAÇÃO',
  communication: 'COMUNICAÇÃO',
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
