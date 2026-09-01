import { useEffect, useState } from 'react'
import { getAgentLiveStates, listFloors } from './floors'
import type { AgentLiveVisualState } from './floors'
import { DEBOUNCE_MS, MIN_VISIBLE_MS, TRANSIENT_MS, bubbleAssetFor, isBubbleState } from './agentActivityAssets'
import type { AgentBubbleState } from './agentActivityAssets'

// Live-map overlay data source. The BACKEND is the source of truth: this only
// reflects what the runtime reported, and an agent with no execution simply has no
// entry — a scheduled routine or an armed trigger produces nothing here.
//
// Everything below exists to stop the map from flickering. A step that lasts 80ms
// must not paint a bubble nobody can read, and a bubble that did paint must stay long
// enough to be read. So each agent's visible state trails the server's by a debounce
// and a minimum dwell, and a terminal outcome is dropped after its display window.

export interface AgentOpState {
  // The runtime enum, not a free string: an unknown state is a bug, and the
  // compiler is the cheapest place to catch it.
  state: AgentBubbleState
  safeDetail?: { appKey?: string; actionLabel?: string; targetType?: string }
  concurrent: number
}

const POLL_MS = 2000
const ERROR_POLL_MS = 5000

interface Pending {
  state: AgentBubbleState
  since: number
}

// UMA sondagem por andar, compartilhada por quem estiver olhando.
//
// O mapa do andar, os cartões da lista de setores e o mapa dentro do setor pedem os
// mesmos dados. Com estado por componente, dez cartões abriam dez sondagens do mesmo
// andar a cada dois segundos. Aqui existe uma por andar, e todos leem o mesmo
// instantâneo — inclusive a suavização (debounce, permanência mínima, janela do
// desfecho), que precisa ser única para dois mapas não piscarem em tempos diferentes.
interface FloorFeed {
  snapshot: Record<string, AgentOpState>
  listeners: Set<() => void>
  shownAt: Record<string, number>
  pending: Record<string, Pending>
  stop?: () => void
}

const feeds = new Map<string, FloorFeed>()
const EMPTY: Record<string, AgentOpState> = {}

function feedFor(floorId: string): FloorFeed {
  let feed = feeds.get(floorId)
  if (feed) return feed
  feed = { snapshot: EMPTY, listeners: new Set(), shownAt: {}, pending: {} }
  feeds.set(floorId, feed)
  return feed
}

function startPolling(floorId: string, feed: FloorFeed): void {
  let alive = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let etag: string | null = null
  let rows: AgentLiveVisualState[] = []
  const controller = new AbortController()

  const publish = (next: Record<string, AgentOpState>) => {
    if (sameStates(feed.snapshot, next)) return
    feed.snapshot = next
    for (const l of feed.listeners) l()
  }

  async function tick() {
    let delay = POLL_MS
    try {
      const body = await getAgentLiveStates(floorId, { etag, signal: controller.signal })
      // `null` é um 304: nada mudou, então as linhas anteriores continuam valendo.
      // Ainda assim são reconciliadas, porque um balão pode expirar ou completar a
      // permanência mínima sem o servidor dizer nada novo.
      if (body) {
        rows = Array.isArray(body.states) ? body.states : []
        etag = body.etag
      }
      if (alive) publish(reconcile(feed.snapshot, rows, feed.shownAt, feed.pending))
    } catch {
      // Cancelado no desmonte não é falha. Qualquer outra coisa é transitória:
      // tenta de novo mais devagar, e a sondagem reconcilia o que passou.
      delay = ERROR_POLL_MS
    }
    if (alive) timer = setTimeout(tick, delay)
  }

  void tick()
  feed.stop = () => {
    alive = false
    if (timer) clearTimeout(timer)
    controller.abort()
  }
}

export function useAgentStates(enabled: boolean, explicitFloorId?: string | null): Record<string, AgentOpState> {
  // Sem andar explícito, resolve o primeiro ativo — é o que o mapa do andar fazia.
  const [resolvedFloorId, setResolvedFloorId] = useState<string | null>(explicitFloorId ?? null)
  useEffect(() => {
    /**
     * Desligado é desligado: nem a descoberta do andar acontece.
     *
     * Faltava esta linha. Com `enabled: false` a sondagem não começava, mas a busca do
     * andar ativo saía assim mesmo — `GET /api/floors` a cada montagem, para escolher um
     * andar que ninguém ia consultar. Na prévia do Arquiteto isso é pior que desperdício:
     * ela desenha um rascunho, e um rascunho não tem andar no banco para descobrir.
     */
    if (!enabled) return
    if (explicitFloorId) {
      setResolvedFloorId(explicitFloorId)
      return
    }
    let alive = true
    void listFloors()
      .then((floors) => {
        if (alive) setResolvedFloorId(floors.find((f) => f.status === 'active')?.id ?? null)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [enabled, explicitFloorId])

  const floorId = enabled ? resolvedFloorId : null
  const [, force] = useState(0)

  useEffect(() => {
    if (!floorId) return
    const feed = feedFor(floorId)
    const listener = () => force((n) => n + 1)
    feed.listeners.add(listener)
    // O primeiro assinante liga a sondagem; o último a desliga.
    if (feed.listeners.size === 1) startPolling(floorId, feed)
    return () => {
      feed.listeners.delete(listener)
      if (feed.listeners.size === 0) {
        feed.stop?.()
        feeds.delete(floorId)
      }
    }
  }, [floorId])

  return floorId ? (feeds.get(floorId)?.snapshot ?? EMPTY) : EMPTY
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
    // An unknown state draws nothing rather than a fallback that would claim work is
    // happening — and it is narrowed here, so nothing downstream handles a string.
    if (!isBubbleState(row.state)) continue
    const state = row.state
    const asset = bubbleAssetFor(state)
    if (!asset) continue

    const shown = current[row.agentId]
    const entry: AgentOpState = { state, safeDetail: row.safeDetail, concurrent: row.concurrent }

    // A terminal outcome is shown for its window and then removed — it is an outcome,
    // not a state, so it must never stay on the map.
    if (asset.tier === 'transient') {
      const started = shown?.state === state ? (shownAt[row.agentId] ?? now) : now
      if (now - started >= TRANSIENT_MS) {
        delete shownAt[row.agentId]
        delete pending[row.agentId]
        continue
      }
      if (shown?.state !== state) shownAt[row.agentId] = now
      next[row.agentId] = entry
      continue
    }

    if (!shown) {
      shownAt[row.agentId] = now
      delete pending[row.agentId]
      next[row.agentId] = entry
      continue
    }

    if (shown.state === state) {
      delete pending[row.agentId]
      next[row.agentId] = entry
      continue
    }

    // The state changed. Two guards before repainting: the new one must have been
    // stable for the debounce, and the old one must have been visible long enough.
    const proposal = pending[row.agentId]
    if (!proposal || proposal.state !== state) {
      pending[row.agentId] = { state, since: now }
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
