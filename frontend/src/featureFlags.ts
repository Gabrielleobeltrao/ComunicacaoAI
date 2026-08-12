// Public UX feature flags for the AI operational-building pivot. These gate only
// presentation — real authorization/capability is always validated on the
// backend. All default OFF (a VITE_* var must be exactly "true" to enable), so
// incomplete screens never appear until their phase ships.
const on = (v: unknown): boolean => String(v ?? '').trim().toLowerCase() === 'true'

export const featureFlags = {
  aiBuilding: on(import.meta.env.VITE_AI_BUILDING_ENABLED),
  aiFloors: on(import.meta.env.VITE_AI_FLOORS_ENABLED),
  aiAutomations: on(import.meta.env.VITE_AI_AUTOMATIONS_ENABLED),
  aiScheduler: on(import.meta.env.VITE_AI_SCHEDULER_ENABLED),
  aiDeliveries: on(import.meta.env.VITE_AI_DELIVERIES_ENABLED),
  aiOfficeLiveStatus: on(import.meta.env.VITE_AI_OFFICE_LIVE_STATUS_ENABLED),
} as const

export type FeatureFlags = typeof featureFlags
