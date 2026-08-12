// Central configuration for the office simulation: feature flags plus every
// timing / scale / collision constant. Nothing here is hard-coded inside the
// components, so the whole feel can be tuned in one place.

function readFlag(name: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  try {
    const v = new URLSearchParams(window.location.search).get(name)
    if (v === '1' || v === 'true') return true
    if (v === '0' || v === 'false') return false
  } catch {
    /* ignore */
  }
  return fallback
}

export const OFFICE_FEATURES = {
  // The walking simulation. Can be turned off entirely with ?officeSim=0.
  simulation: readFlag('officeSim', true),
  // Deterministic room decoration (Phase 7). Off with ?officeDecor=0.
  decoration: readFlag('officeDecor', true),
  // Debug overlay — off by default even in dev; on with ?officeDebug=1.
  debug: readFlag('officeDebug', false),
}

function readNum(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  try {
    const v = new URLSearchParams(window.location.search).get(name)
    if (v != null && Number.isFinite(Number(v))) return Number(v)
  } catch {
    /* ignore */
  }
  return fallback
}

// Speed multiplier for the simulation clock — 1 = calm real-time. `?officeSpeed=6`
// fast-forwards it (handy for QA / previewing the walk cycle).
export const TIME_SCALE = Math.min(20, Math.max(0.25, readNum('officeSpeed', 1)))

// QA-only: run the simulation even under prefers-reduced-motion (?officeForceMotion=1).
export const IGNORE_REDUCED_MOTION = readFlag('officeForceMotion', false)

// Navigation grid resolution, in tiles. Matches the layout cell size.
export const NAV_RES = 0.5

// Collision: the walking footprint (feet) is a small box, not the whole sprite.
export const FOOT_RADIUS = 0.55 // tiles — obstacles are inflated by this

// Simulation timing (milliseconds unless noted). Ranges are [min, max].
export const OFFICE_TIMING = {
  seatedPause: [20000, 70000] as [number, number], // idle at desk before standing
  destinationPause: [4000, 14000] as [number, number], // pause at a destination
  midwayPauseChance: 0.12, // rare pause while walking
  midwayPause: [1000, 4000] as [number, number],
  maxVisitsPerTrip: 2,
  standUpMs: 520, // seated → exit point tween
  sitDownMs: 520, // exit point → seated tween
  stepMs: 340, // time to cross one grid cell while walking
  walkFrameMs: 190, // walk-frame swap cadence
  reservationMs: 1400, // how long a claimed next cell stays reserved
  waitRetry: [400, 1100] as [number, number], // jittered retry after a conflict
  maxPathAttempts: 4,
  staggerMs: [0, 9000] as [number, number], // start offset to avoid sync
  socialTalk: [5000, 11000] as [number, number], // how long a conversation lasts
  socialApproachMs: 9000, // give up walking to a conversation slot after this
}

// Deterministic conversations: how often a new pair is attempted and the max
// fraction of the office talking at once.
export const SOCIAL_ATTEMPT_MS = 4000
export const SOCIAL_MAX_RATIO = 0.25

// At most this share of agents move at once (with a practical minimum of 1).
export const MAX_CONCURRENT_RATIO = 0.25

// Sprite scale (matches MapAgent).
export const AGENT_SCALE = 1.25
