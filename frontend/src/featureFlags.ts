// Public UX feature flags for the AI operational-building pivot. These gate only
// presentation — real authorization/capability is always validated on the
// backend. All default OFF (a VITE_* var must be exactly "true" to enable), so
// incomplete screens never appear until their phase ships.
const on = (v: unknown): boolean => String(v ?? '').trim().toLowerCase() === 'true'

// Só o que ALGUÉM lê. `VITE_AI_FLOORS_ENABLED`, `VITE_AI_SCHEDULER_ENABLED` e
// `VITE_AI_DELIVERIES_ENABLED` estavam declaradas aqui e não eram consultadas em
// lugar nenhum — o exemplo de produção chegava a combinar `BUILDING=true` com
// `FLOORS=false`, uma contradição aparente que na prática não desligava nada.
// Uma chave que não abre porta nenhuma promete um controle que não existe.
// `featureFlags.test.ts` impede que uma volte a existir sem consumidor.
export const featureFlags = {
  aiBuilding: on(import.meta.env.VITE_AI_BUILDING_ENABLED),
  aiAutomations: on(import.meta.env.VITE_AI_AUTOMATIONS_ENABLED),
  aiOfficeLiveStatus: on(import.meta.env.VITE_AI_OFFICE_LIVE_STATUS_ENABLED),
} as const

export type FeatureFlags = typeof featureFlags
