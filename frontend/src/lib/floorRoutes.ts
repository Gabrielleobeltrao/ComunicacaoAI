// Canonical floor-scoped route helpers (mobile parity plan §7.2). Single source
// for every `/floors/:floorId/*` path so screens never hand-write route strings
// and floor switching behaves identically everywhere.

export const floorHome = (floorId: string) => `/floors/${floorId}`
export const floorAgents = (floorId: string) => `/floors/${floorId}/agents`
export const floorAgent = (floorId: string, agentId: string, section?: string) =>
  `/floors/${floorId}/agents/${agentId}${section ? `/${section}` : ''}`
export const floorSectors = (floorId: string) => `/floors/${floorId}/sectors`
export const floorSector = (floorId: string, sectorId: string, section?: string) =>
  `/floors/${floorId}/sectors/${sectorId}${section ? `/${section}` : ''}`
export const floorAutomations = (floorId: string) => `/floors/${floorId}/automations`
export const floorAutomation = (floorId: string, automationId: string) => `/floors/${floorId}/automations/${automationId}`
export const floorRuns = (floorId: string) => `/floors/${floorId}/runs`

// Module sections that survive a floor switch (detail ids never carry over).
export const FLOOR_SECTIONS = ['automations', 'agents', 'sectors', 'runs', 'artifacts'] as const

export function parseFloorPath(pathname: string): { floorId: string | null; section: string | null } {
  const m = pathname.match(/^\/floors\/([^/]+)(?:\/([^/]+))?/)
  return { floorId: m?.[1] ?? null, section: m?.[2] ?? null }
}

// The canonical destination when switching to `nextFloorId` from `pathname`:
// keep the current module (agents/sectors/automations/runs) but never a detail id,
// and land any non-floor route on the new floor's home. This is the ONE rule the
// UI (topbar picker, drawer, sidebar) must share so a switch is always predictable.
export function switchFloorPath(pathname: string, nextFloorId: string): string {
  const { section } = parseFloorPath(pathname)
  if (section && (FLOOR_SECTIONS as readonly string[]).includes(section)) return `/floors/${nextFloorId}/${section}`
  return floorHome(nextFloorId)
}
