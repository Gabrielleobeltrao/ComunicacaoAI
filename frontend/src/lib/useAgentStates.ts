import { useEffect, useRef, useState } from 'react'
import { getAgentLiveStates, listFloors } from './floors'
import type { AgentLiveVisualState } from './floors'
import { DEBOUNCE_MS, MIN_VISIBLE_MS, TRANSIENT_MS, bubbleAssetFor } from './agentActivityAssets'

// Live-map overlay data source. The BACKEND is the source of truth: this only
// reflects what the runtime reported, and an agent with no execution simply has no
// entry — a scheduled routine or an armed trigger produces nothing here.
//
// Everything below exists to stop the map from flickering. A step that lasts 80ms
// must not paint a bubble nobody can read, and a bubble that did paint must stay long
// enough to be read. So each agent's visible state trails the server's by a debounce
// and a minimum dwell, and a terminal outcome is dropped after its display window.

export interface AgentOpState {
  state: string
  safeDetail?: { appKey?: string; actionLabel?: string; targetType?: string }
  concurrent: number
}

const POLL_MS = 2000
const ERROR_POLL_MS = 5000

interface Pending {
  state: string
  since: number
}

export function useAgentStates(enabled: boolean, explicitFloorId?: string | null): Record<string, AgentOpState> {
  const [states, setStates] = useState<Record<string, AgentOpState>>({})
  // Per agent: when the currently SHOWN state was painted, and what the server is
  // proposing that has not been accepted yet.
  const shownAt = useRef<Record<string, number>>({})
  const pending = useRef<Record<string, Pending>>({})

  useEffect(() => {
    if (!enabled) {
      setStates({})
      return
    }
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let floorId: string | null = explicitFloorId ?? null

    async function tick() {
      let delay = POLL_MS
      try {
        if (!floorId) {
          const floors = await listFloors()
          floorId = floors.find((f) => f.status === 'active')?.id ?? null
        }
        if (floorId && alive) {
          const body = await getAgentLiveStates(floorId)
          // A response without `states` is treated as "nothing running", not as an
          // error: the map degrades to no bubbles instead of throwing every tick.
          const rows = Array.isArray(body?.states) ? body.states : []
          if (alive) {
            setStates((current) => {
              const next = reconcile(current, rows, shownAt.current, pending.current)
              // The office polls every couple of seconds. Re-rendering the whole map
              // when nothing changed would restart hover, focus and any in-flight
              // interaction — so an unchanged tick keeps the SAME object.
              return sameStates(current, next) ? current : next
            })
          }
        }
      } catch {
        // Transient: retry more slowly; polling reconciles whatever was missed.
        delay = ERROR_POLL_MS
      }
      if (alive) timer = setTimeout(tick, delay)
    }
    void tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [enabled, explicitFloorId])

  return states
}

// Cheap structural comparison: this runs once per poll, over a handful of agents.
export function sameStates(a: Record<string, AgentOpState>, b: Record<string, AgentOpState>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => {
    const x = a[k]
    const y = b[k]
    return (
      y !== undefined &&
      x.state === y.state &&
      x.concurrent === y.concurrent &&
      x.safeDetail?.appKey === y.safeDetail?.appKey &&
      x.safeDetail?.actionLabel === y.safeDetail?.actionLabel &&
      x.safeDetail?.targetType === y.safeDetail?.targetType
    )
  })
}

// Pure, so the anti-flicker rules are testable without a clock or a network.
export function reconcile(
  current: Record<string, AgentOpState>,
  incoming: AgentLiveVisualState[],
  shownAt: Record<string, number>,
  pending: Record<string, Pending>,
  now: number = Date.now(),
): Record<string, AgentOpState> {
  const next: Record<string, AgentOpState> = {}
  const seen = new Set<string>()

  for (const row of incoming) {
    seen.add(row.agentId)
    const asset = bubbleAssetFor(row.state)
    // An unknown state draws nothing rather than a fallback that would claim work is
    // happening.
    if (!asset) continue

    const shown = current[row.agentId]
    const entry: AgentOpState = { state: row.state, safeDetail: row.safeDetail, concurrent: row.concurrent }

    // A terminal outcome is shown for its window and then removed — it is an outcome,
    // not a state, so it must never stay on the map.
    if (asset.tier === 'transient') {
      const started = shown?.state === row.state ? (shownAt[row.agentId] ?? now) : now
      if (now - started >= TRANSIENT_MS) {
        delete shownAt[row.agentId]
        delete pending[row.agentId]
        continue
      }
      if (shown?.state !== row.state) shownAt[row.agentId] = now
      next[row.agentId] = entry
      continue
    }

    if (!shown) {
      shownAt[row.agentId] = now
      delete pending[row.agentId]
      next[row.agentId] = entry
      continue
    }

    if (shown.state === row.state) {
      delete pending[row.agentId]
      next[row.agentId] = entry
      continue
    }

    // The state changed. Two guards before repainting: the new one must have been
    // stable for the debounce, and the old one must have been visible long enough.
    const proposal = pending[row.agentId]
    if (!proposal || proposal.state !== row.state) {
      pending[row.agentId] = { state: row.state, since: now }
      next[row.agentId] = shown
      continue
    }
    const stableEnough = now - proposal.since >= DEBOUNCE_MS
    const readEnough = now - (shownAt[row.agentId] ?? 0) >= MIN_VISIBLE_MS
    if (stableEnough && readEnough) {
      shownAt[row.agentId] = now
      delete pending[row.agentId]
      next[row.agentId] = entry
    } else {
      next[row.agentId] = shown
    }
  }

  // Gone from the server = the execution ended or its TTL passed. Nothing lingers.
  for (const agentId of Object.keys(current)) {
    if (!seen.has(agentId)) {
      delete shownAt[agentId]
      delete pending[agentId]
    }
  }
  return next
}
