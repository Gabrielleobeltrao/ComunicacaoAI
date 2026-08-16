import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { accentFor, buildCharacterResolver, statusFor } from '../lib/agentAvatar'
import { objectSrc } from '../lib/officeAssets'
import type { AgentSummary, SectorSummary } from '../lib/types'
import { cozinha, lounge, reuniao } from './cenarios'
import type { Cenario } from './cenarios'
import { buildOfficeLayout, hash32, mulberry32 } from './buildOfficeLayout'
import { buildNavigationGrid } from './buildNavigationGrid'
import { buildActivityEnvelope } from './buildActivityEnvelope'
import type { AgentVisualMode, OfficeDirection, OfficeSeat } from './officeTypes'
import { IGNORE_REDUCED_MOTION, OFFICE_FEATURES } from './officeConfig'
import { EMPTY_DECOR, placeOfficeDecor } from './placeOfficeDecor'
import { preloadAgentSprites } from './officeSprites'
import { OfficeDebugOverlay } from './OfficeDebugOverlay'
import { useOfficeSimulation } from './useOfficeSimulation'
import { MapAgent } from './MapAgent'
import { MapObject } from './MapObject'
import { NamePill } from './NamePill'
import { OfficeMap } from './OfficeMap'
import { SimAgent } from './SimAgent'
import { roundedPath, traceOutline } from './roomShape'
import { featureFlags } from '../featureFlags'
import { useAgentStates } from '../lib/useAgentStates'

const VIEWPORT_H = 560 // reference map height (px) used as the aspect fallback
// Responsive map height: never tiny on a phone, never taller than the reference,
// and a comfortable share of the dynamic viewport in between.
const MAP_HEIGHT = 'clamp(340px, 60dvh, 560px)'

const AMENITIES: Cenario[] = [reuniao, cozinha, lounge]
const AMEN_TINT: Record<string, string> = { reuniao: '#38B6F0', cozinha: '#FFB53D', lounge: '#8B5CF6' }
const DECOR = ['planta-grande-1.5x2', 'samambaia-1.5x1.5', 'estante-2x1', 'prateleira-pe-1.5x1.3', 'planta-1x1', 'vaso-1x1']

// Visual mode from the agent's decorative status: working / thinking / calling
// use the phone set; idle / break / blocked use the normal set.
function modeFor(id: string): AgentVisualMode {
  const s = statusFor(id)
  return s === 'working' || s === 'thinking' || s === 'calling' ? 'phone' : 'normal'
}
const facingSvg = (d: OfficeDirection): 'frente' | 'costas' => (d === 'back' ? 'costas' : 'frente')

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

export function OfficeFloor({ agents, sectors = [], floorId }: { agents: AgentSummary[]; sectors?: SectorSummary[]; floorId?: string }) {
  const navigate = useNavigate()
  const chars = useMemo(() => buildCharacterResolver(agents.map((a) => a._id)), [agents])

  const hostRef = useRef<HTMLDivElement>(null)
  const [hostW, setHostW] = useState(0)
  const [hostH, setHostH] = useState(VIEWPORT_H)
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(false)
  const [paused, setPaused] = useState(false)
  const [recall, setRecall] = useState(false)
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    // Measure both axes so the layout aspect tracks the actual (responsive) map box
    // — after a phone rotates, this recomputes fit without a destructive reset.
    const measure = () => {
      setHostW((w) => (w === el.clientWidth ? w : el.clientWidth))
      setHostH((h) => (h === el.clientHeight ? h : el.clientHeight))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Bias the layout toward a near-square footprint (rooms wrap into more rows)
  // instead of tracking a wide desktop panel 1:1, which read as "too horizontal".
  const aspect = Math.min(1.2, Math.max(1.05, (hostW || 1100) / (hostH || VIEWPORT_H)))

  const baseLayout = useMemo(
    () =>
      buildOfficeLayout({
        agents: agents.map((a) => ({ _id: a._id })),
        sectors: sectors.map((s) => ({ _id: s._id, name: s.name, color: s.color, members: s.members })),
        aspect,
        amenities: AMENITIES,
        amenityTint: AMEN_TINT,
        decorArts: DECOR,
      }),
    [agents, sectors, aspect],
  )
  const baseGrid = useMemo(() => buildNavigationGrid(baseLayout), [baseLayout])
  // Deterministic decoration (Phase 7) — placed against the base grid so it never
  // breaks a route, then folded back in so agents actually navigate around it.
  const decor = useMemo(() => (OFFICE_FEATURES.decoration ? placeOfficeDecor(baseLayout, baseGrid) : EMPTY_DECOR), [baseLayout, baseGrid])
  const layout = useMemo(() => (decor.obstacles.length ? { ...baseLayout, obstacles: [...baseLayout.obstacles, ...decor.obstacles] } : baseLayout), [baseLayout, decor])
  const grid = useMemo(() => (decor.obstacles.length ? buildNavigationGrid(layout) : baseGrid), [layout, baseGrid, decor.obstacles.length])

  // Invisible activity envelope (Phase 2): keeps destinations/feet near the cluster.
  const envelope = useMemo(() => buildActivityEnvelope(layout, grid), [layout, grid])

  const reducedMotion = useReducedMotion()
  // Live-map overlay (off unless the flag is on): read-only per-agent state.
  const opStates = useAgentStates(featureFlags.aiOfficeLiveStatus, floorId)
  const simOn = OFFICE_FEATURES.simulation && (!reducedMotion || IGNORE_REDUCED_MOTION)
  const sim = useOfficeSimulation(layout, grid, {
    modeFor,
    enabled: simOn,
    interactions: decor.interactionPoints,
    envelope,
    paused,
    recall,
    onRecallDone: () => {
      setPaused(true) // office goes static once everyone is back
      setRecall(false)
    },
  })

  // Preload the walk / idle frames for the faces actually in use.
  const usedCharacters = useMemo(() => Array.from(new Set(agents.map((a) => chars.character(a._id)))), [agents, chars])
  useEffect(() => {
    preloadAgentSprites(usedCharacters)
  }, [usedCharacters])

  const { rooms, seats, emptySeats, desks, amenityItems, loose, cols, rows } = layout
  const farEmpty = emptySeats.filter((e) => !e.near)
  const nearEmpty = emptySeats.filter((e) => e.near)
  const agentName = useMemo(() => new Map(agents.map((a) => [a._id, a.name])), [agents])
  const nameOf = useCallback((id: string) => (agentName.get(id) ?? '').split(' ')[0], [agentName])
  const farSeats = seats.filter((s) => !s.chair.near)
  const nearSeats = seats.filter((s) => s.chair.near)

  // Static (simulation off / reduced motion) seated + loose agents.
  const staticSeatedEl = (s: OfficeSeat, zIndex: number) => (
    <MapAgent
      key={s.agentId}
      x={s.seatedPoint.x}
      y={s.seatedPoint.y}
      name={nameOf(s.agentId)}
      status={statusFor(s.agentId)}
      agent={chars.character(s.agentId)}
      facing={facingSvg(s.facing)}
      pose={modeFor(s.agentId) === 'phone' ? 'ligacao' : 'parado'}
      opState={opStates[s.agentId]?.state}
      opDetail={opStates[s.agentId]?.safeDetail}
      seated
      department={accentFor(s.agentId)}
      hoverLift={false}
      style={{ zIndex }}
      onOpen={() => navigate(`/agents/${s.agentId}`)}
    />
  )

  return (
    <div ref={hostRef}>
      <OfficeMap
        cols={cols}
        rows={rows}
        tile={42}
        fitToView
        labelsShown={showLabels}
        onToggleLabels={() => setShowLabels((v) => !v)}
        paused={paused}
        onTogglePause={simOn ? () => setPaused((v) => !v) : undefined}
        recallActive={recall}
        onRecall={
          simOn
            ? () => {
                setRecall((v) => !v) // toggle: send everyone home, or release them again
                setPaused(false) // keep the office live either way
              }
            : undefined
        }
        style={{ height: MAP_HEIGHT }}
      >
        {/* Room shapes — tetris outlines, drawn behind everything */}
        <svg
          viewBox={`0 0 ${cols} ${rows}`}
          preserveAspectRatio="none"
          style={{ position: 'absolute', left: 0, top: 0, width: `calc(var(--tile) * ${cols})`, height: `calc(var(--tile) * ${rows})`, overflow: 'visible', pointerEvents: 'none' }}
        >
          {rooms.flatMap((r) => {
            const d = roundedPath(traceOutline(r.cells), r.x, r.y, 0.45)
            const pct = r.kind === 'sector' ? 17 : 15
            const fill = `color-mix(in oklab, ${r.color ?? '#888'} ${pct}%, var(--paper-0))`
            return [
              <path key={`${r.key}-fill`} d={d} fill={fill} stroke="var(--map-wall)" strokeWidth={4.5} vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 2px 6px var(--map-shadow))' }} />,
              <path key={`${r.key}-edge`} d={d} fill="none" stroke="var(--map-wall-edge)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />,
            ]
          })}
        </svg>

        {/* Per-room hover zones — reveal the label only while the mouse is over the room. */}
        {rooms.map((r) => (
          <div
            key={`hover-${r.key}`}
            onMouseEnter={() => setHoveredRoom(r.key)}
            onMouseLeave={() => setHoveredRoom((h) => (h === r.key ? null : h))}
            style={{ position: 'absolute', left: `calc(var(--tile) * ${r.x})`, top: `calc(var(--tile) * ${r.y})`, width: `calc(var(--tile) * ${r.w})`, height: `calc(var(--tile) * ${r.h})`, zIndex: 1 }}
          />
        ))}

        {/* Amenity furniture */}
        {amenityItems.map((it) => (
          <MapObject key={`${it.roomKey}-obj-${it.index}`} x={it.x} y={it.y} w={it.w} h={it.h} art={objectSrc(it.art)} label={it.label} shadow={it.shadow} style={{ zIndex: 2, pointerEvents: 'none' }} />
        ))}

        {/* Sector décor (in the annex) */}
        {layout.decor.map((dc) => (
          <MapObject key={`decor-${dc.roomKey}`} x={dc.x - 0.85} y={dc.y - 1.4} w={1.7} h={2} art={objectSrc(dc.art)} label="" style={{ zIndex: 2, pointerEvents: 'none' }} />
        ))}

        {/* Deterministic room decoration (Phase 7) */}
        {decor.items.map((it) => (
          <MapObject key={`dec-${it.key}`} x={it.x} y={it.y} w={it.w} h={it.h} art={objectSrc(it.art)} label={it.label} style={{ zIndex: 2, pointerEvents: 'none' }} />
        ))}

        {/* Ambient wall detail (Phase 12) — non-blocking, drawn below agents */}
        {decor.ambient.map((it) => (
          <MapObject key={`amb-${it.key}`} x={it.x} y={it.y} w={it.w} h={it.h} art={objectSrc(it.art)} label="" style={{ zIndex: 1, pointerEvents: 'none' }} />
        ))}

        {/* Labels — the hovered room always, or every room when toggled on */}
        {rooms
          .filter((r) => showLabels || r.key === hoveredRoom)
          .map((r) => (
            <NamePill
              key={`lbl-${r.key}`}
              name={r.name}
              tone="light"
              style={{ position: 'absolute', left: `calc(var(--tile) * ${r.x + r.w / 2})`, top: `calc(var(--tile) * ${r.y} - 3px)`, transform: 'translate(-50%, -100%)', zIndex: 900, whiteSpace: 'nowrap', pointerEvents: 'none' }}
            />
          ))}

        {/* Chairs + desks are always static furniture (empty seats keep their chair) */}
        {farSeats.map((s) => (
          <MapObject key={`fc-${s.agentId}`} x={s.seatedPoint.x} y={s.seatedPoint.y + 0.5} w={1} h={1} art={objectSrc('cadeira-longe-1x1')} label="Cadeira" style={{ zIndex: 0, pointerEvents: 'none' }} />
        ))}
        {farEmpty.map((e, i) => (
          <MapObject key={`fce-${i}`} x={e.x} y={e.y + 0.5} w={1} h={1} art={objectSrc('cadeira-longe-1x1')} label="" style={{ zIndex: 0, pointerEvents: 'none' }} />
        ))}
        {desks.map((d, i) => (
          <MapObject key={`desk-${d.roomKey}-${i}`} x={d.x} y={d.y} w={d.w} h={d.h} art={objectSrc(d.art)} label="Mesa" style={{ zIndex: 2, pointerEvents: 'none' }} />
        ))}
        {nearSeats.map((s) => (
          <MapObject key={`nc-${s.agentId}`} x={s.seatedPoint.x - 0.075} y={s.seatedPoint.y + 1} w={1.15} h={1.3} art={objectSrc('cadeira-perto-1x1.15')} label="Cadeira" style={{ zIndex: 4, pointerEvents: 'none' }} />
        ))}
        {nearEmpty.map((e, i) => (
          <MapObject key={`nce-${i}`} x={e.x - 0.075} y={e.y + 1} w={1.15} h={1.3} art={objectSrc('cadeira-perto-1x1.15')} label="" style={{ zIndex: 4, pointerEvents: 'none' }} />
        ))}

        {/* Agents — simulated (walking) or static, depending on the flag / reduced-motion */}
        {simOn
          ? [...seats.map((s) => ({ id: s.agentId, x: s.seatedPoint.x, y: s.seatedPoint.y })), ...loose.map((o) => ({ id: o.agentId, x: o.point.x, y: o.point.y }))].map((a) => (
              <SimAgent
                key={a.id}
                agentId={a.id}
                name={nameOf(a.id)}
                character={chars.character(a.id)}
                status={statusFor(a.id)}
                view={sim.viewOf(a.id)}
                initialX={a.x}
                initialY={a.y}
                register={sim.register}
                setHovered={sim.setHovered}
                opState={opStates[a.id]?.state}
                opDetail={opStates[a.id]?.safeDetail}
                onOpen={() => navigate(`/agents/${a.id}`)}
              />
            ))
          : [
              ...farSeats.map((s) => staticSeatedEl(s, 1)),
              ...nearSeats.map((s) => staticSeatedEl(s, 3)),
              ...loose.map((o) => {
                const facing = mulberry32(hash32(`${o.agentId}:facing`))() < 0.4 ? 'costas' : 'frente'
                return (
                  <MapAgent
                    key={o.agentId}
                    x={o.point.x}
                    y={o.point.y}
                    name={nameOf(o.agentId)}
                    status={statusFor(o.agentId)}
                    agent={chars.character(o.agentId)}
                    facing={facing}
                    pose={modeFor(o.agentId) === 'phone' ? 'ligacao' : 'parado'}
                    opState={opStates[o.agentId]?.state}
                    opDetail={opStates[o.agentId]?.safeDetail}
                    department={accentFor(o.agentId)}
                    hoverLift={false}
                    style={{ zIndex: 3 }}
                    onOpen={() => navigate(`/agents/${o.agentId}`)}
                  />
                )
              }),
            ]}

        {OFFICE_FEATURES.debug && <OfficeDebugOverlay grid={grid} layout={layout} envelope={envelope} interactions={decor.interactionPoints} debug={sim.debug} live={simOn} />}
      </OfficeMap>
    </div>
  )
}
