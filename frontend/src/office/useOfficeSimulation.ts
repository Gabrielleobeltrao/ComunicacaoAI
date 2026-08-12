import { useEffect, useReducer, useRef } from 'react'
import type { BuiltOfficeLayout } from './buildOfficeLayout'
import type { NavGrid } from './buildNavigationGrid'
import { REF_DY, createContext, createModels, settleStartPositions, stepAgent, tickConversations } from './officeSimCore'
import type { AgentModel, SimContext } from './officeSimCore'
import type { ActivityEnvelope } from './buildActivityEnvelope'
import { TIME_SCALE } from './officeConfig'
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
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    const m = createModels(layout, optsRef.current.modeFor)
    const v = new Map<string, SimView>()
    for (const a of m.values()) v.set(a.id, { motion: a.motion, direction: a.direction, mode: a.mode, frame: a.frame })
    models.current = m
    views.current = v
    ctxRef.current = createContext(layout, grid, m.size, optsRef.current.interactions ?? [], optsRef.current.envelope)
    settleStartPositions(ctxRef.current, m)
    bump()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, grid])

  useEffect(() => {
    if (!opts.enabled) return
    const tick = (ts: number) => {
      const ctx = ctxRef.current
      if (ctx) {
        const dt = Math.min(80, ts - (lastTs.current || ts)) * TIME_SCALE
        lastTs.current = ts
        for (const [k, r] of ctx.reservations) if (r.until <= ts) ctx.reservations.delete(k)
        tickConversations(ctx, models.current, ts) // advance/start conversations
        let changed = false
        for (const m of models.current.values()) {
          stepAgent(m, dt, ts, ctx)
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
