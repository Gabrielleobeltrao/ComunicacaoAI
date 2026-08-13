import { featureFlags } from '../featureFlags'
import type { FeatureFlags } from '../featureFlags'

// Single scope-aware navigation source (UX reorg §15.1). Desktop sidebar, mobile
// drawer and bottom bar all derive from this — never a raw NAV.map per surface.
export type NavScope = 'general' | 'floor' | 'communication'

export interface NavItemDef {
  key: string
  label: string
  icon: string
  scope: NavScope
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
  // The floor home is also the building home (the general overview was merged into
  // it) — exact match so it doesn't stay active on the floor's sub-pages.
  { key: 'floor', label: 'Visão do andar', icon: 'building-2', scope: 'floor', path: (f) => floorPath(f, '', '/dashboard'), activePrefixes: (f) => (f ? [`/floors/${f}`] : ['/dashboard']), exact: true, mobilePrimary: true },
  { key: 'automations', label: 'Automações', icon: 'workflow', scope: 'floor', path: (f) => floorPath(f, '/automations', '/automations'), activePrefixes: (f) => [floorPath(f, '/automations', '/automations')], mobilePrimary: true, featureFlag: 'aiAutomations' },
  { key: 'agents', label: 'Agentes', icon: 'users-round', scope: 'floor', path: (f) => floorPath(f, '/agents', '/agents'), activePrefixes: (f) => [floorPath(f, '/agents', '/agents')], mobilePrimary: true },
  { key: 'sectors', label: 'Setores', icon: 'network', scope: 'floor', path: (f) => floorPath(f, '/sectors', '/setores'), activePrefixes: (f) => [floorPath(f, '/sectors', '/setores')] },
  { key: 'runs', label: 'Execuções', icon: 'history', scope: 'floor', path: (f) => floorPath(f, '/runs', '/runs'), activePrefixes: (f) => [floorPath(f, '/runs', '/runs')], featureFlag: 'aiAutomations' },
  { key: 'channels', label: 'Canais', icon: 'share-2', scope: 'communication', path: () => '/widgets', activePrefixes: () => ['/widgets'] },
  { key: 'conversations', label: 'Conversas', icon: 'message-circle', scope: 'communication', path: () => '/chats', activePrefixes: () => ['/chats'] },
]

export function navItemsFor(_floorId: string | null): NavItemDef[] {
  return NAV_V2.filter((i) => !i.featureFlag || featureFlags[i.featureFlag])
}

export const SCOPE_LABEL: Record<NavScope, string> = {
  general: 'GERAL',
  floor: 'ANDAR',
  communication: 'COMUNICAÇÃO',
}

// True when the current pathname matches one of an item's active prefixes.
export function isNavActive(item: NavItemDef, floorId: string | null, pathname: string): boolean {
  return item.activePrefixes(floorId).some((p) => (item.exact ? pathname === p : pathname === p || pathname.startsWith(p + '/')))
}
