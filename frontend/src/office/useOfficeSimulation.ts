import { useEffect, useReducer, useRef } from 'react'
import type { BuiltOfficeLayout } from './buildOfficeLayout'
import type { NavGrid } from './buildNavigationGrid'
import { REF_DY, createContext, createModels, recallComplete, setRecall, settleStartPositions, stepAgent, tickConversations, warmStart } from './officeSimCore'
import type { AgentModel, SimContext } from './officeSimCore'
import type { ActivityEnvelope } from './buildActivityEnvelope'
import { OFFICE_FEATURES, TIME_SCALE, WARM_START_MS } from './officeConfig'
import type { AgentMotionState, AgentVisualMode, InteractionPoint, OfficeDirection } from './officeTypes'

// Per-agent semantic view — the only thing that re-renders React. Continuous
// position is written to each node's CSS vars imperatively (see `register`).
export interface SimView {
  motion: AgentMotionState
  direction: OfficeDirection
  mode: AgentVisualMode
  frame: number
}

export interface SimOptions {
  modeFor: (agentId: string) => AgentVisualMode
  enabled: boolean
  interactions?: InteractionPoint[]
  envelope?: ActivityEnvelope
  paused?: boolean // freeze the whole simulation (Phase 9)
  recall?: boolean // send everyone back to their desks (Phase 10)
  onRecallDone?: () => void // fired once when every agent is home
}

// Thin React wrapper around the pure simulation core: it owns the rAF loop, the
// DOM nodes and the semantic-view state, delegating every transition to stepAgent.
export function useOfficeSimulation(layout: BuiltOfficeLayout, grid: NavGrid, opts: SimOptions) {
  const [, bump] = useReducer((x: number) => (x + 1) % 1_000_000, 0)
  const models = useRef(new Map<string, AgentModel>())
  const views = useRef(new Map<string, SimView>())
  const nodes = useRef(new Map<string, HTMLElement | null>())
  const ctxRef = useRef<SimContext | null>(null)
  const hovered = useRef<string | null>(null)
  const rafRef = useRef(0)
  const lastTs = useRef(0)
  const simNow = useRef(0) // monotonic sim clock (ms), continuous across warm-start
  const recallDone = useRef(false)
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    const m = createModels(layout, optsRef.current.modeFor)
    const ctx = createContext(layout, grid, m.size, optsRef.current.interactions ?? [], optsRef.current.envelope)
    models.current = m
    ctxRef.current = ctx
    // Warm-start: pre-roll the sim so the office opens already alive; the render
    // loop then continues from the same sim clock (so reservations/timers line up).
    simNow.current = OFFICE_FEATURES.warmStart ? warmStart(ctx, m, WARM_START_MS) : (settleStartPositions(ctx, m), 0)
    const v = new Map<string, SimView>()
    for (const a of m.values()) v.set(a.id, { motion: a.motion, direction: a.direction, mode: a.mode, frame: a.frame })
    views.current = v
    bump()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, grid])

  useEffect(() => {
    if (!opts.enabled) return
    const tick = (ts: number) => {
      const ctx = ctxRef.current
      // Paused: hold everything exactly where it is. Keep lastTs current so resume
      // doesn't apply a huge delta, and don't advance the sim clock.
      if (ctx && optsRef.current.paused) {
        lastTs.current = ts
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      if (ctx) {
        // Reconcile recall mode with the control.
        const wantRecall = !!optsRef.current.recall
        if (ctx.recall !== wantRecall) {
          setRecall(ctx, models.current, wantRecall)
          recallDone.current = false
        }
        const dt = Math.min(80, ts - (lastTs.current || ts)) * TIME_SCALE
        lastTs.current = ts
        simNow.current += dt
        const now = simNow.current
        for (const [k, r] of ctx.reservations) if (r.until <= now) ctx.reservations.delete(k)
        tickConversations(ctx, models.current, now) // advance/start conversations
        let changed = false
        for (const m of models.current.values()) {
          stepAgent(m, dt, now, ctx)
          // conversing agents show the normal pose facing their partner, not phone
          m.mode = m.social ? 'normal' : optsRef.current.modeFor(m.id)
          // compare against the last rendered view so social/motion changes made by
          // tickConversations are picked up too
          const pv = views.current.get(m.id)
          if (!pv || m.motion !== pv.motion || m.direction !== pv.direction || m.frame !== pv.frame || m.mode !== pv.mode) {
            views.current.set(m.id, { motion: m.motion, direction: m.direction, mode: m.mode, frame: m.frame })
            changed = true
          }
          const node = nodes.current.get(m.id)
          if (node) {
            node.style.setProperty('--ax', String(m.pos.x))
            node.style.setProperty('--ay', String(m.pos.y))
            const baseZ = m.motion === 'seated' && m.home ? (m.home.facing === 'back' ? 3 : 1) : 20 + Math.round((m.pos.y + REF_DY) * 2)
            node.style.zIndex = String(hovered.current === m.id ? 999 : baseZ)
          }
        }
        if (changed) bump()
        // Notify once the "return to desks" run has fully completed.
        if (ctx.recall && !recallDone.current && recallComplete(ctx, models.current)) {
          recallDone.current = true
          optsRef.current.onRecallDone?.()
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        lastTs.current = 0
        if (!rafRef.current) rafRef.current = requestAnimationFrame(tick)
      } else if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    lastTs.current = 0
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, layout, grid])

  const register = (agentId: string, el: HTMLElement | null) => {
    nodes.current.set(agentId, el)
    const m = models.current.get(agentId)
    if (el && m) {
      el.style.setProperty('--ax', String(m.pos.x))
      el.style.setProperty('--ay', String(m.pos.y))
    }
  }
  const viewOf = (agentId: string): SimView => views.current.get(agentId) ?? { motion: 'seated', direction: 'front', mode: 'normal', frame: 0 }
  const setHovered = (agentId: string | null) => {
    hovered.current = agentId
  }
  // Live read of the simulation for the debug overlay (never triggers a render).
  const debug = { models: () => models.current, context: () => ctxRef.current }

  return { register, viewOf, setHovered, debug }
}
