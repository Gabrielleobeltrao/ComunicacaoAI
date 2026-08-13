import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { accentFor, buildCharacterResolver, statusFor } from '../lib/agentAvatar'
import { objectSrc } from '../lib/officeAssets'
import type { AgentSummary, SectorSummary } from '../lib/types'
import { DESK_DEPTH, DESK_W, buildOfficeLayout } from './buildOfficeLayout'
import { buildNavigationGrid } from './buildNavigationGrid'
import { buildActivityEnvelope } from './buildActivityEnvelope'
import { placeOfficeDecor } from './placeOfficeDecor'
import { IGNORE_REDUCED_MOTION, OFFICE_FEATURES } from './officeConfig'
import type { AgentVisualMode, OfficeSeat } from './officeTypes'
import { MapAgent } from './MapAgent'
import { MapObject } from './MapObject'
import { SimAgent } from './SimAgent'
import { useOfficeSimulation } from './useOfficeSimulation'
import { roundedPath, traceOutline } from './roomShape'

type Chars = ReturnType<typeof buildCharacterResolver>
const TILE = 44 // base tile px inside the crop; the whole thing is scaled to fit
const PAD = 1.0 // tiles of floor kept around the room
const DECOR = ['planta-grande-1.5x2', 'samambaia-1.5x1.5', 'estante-2x1', 'prateleira-pe-1.5x1.3', 'planta-1x1', 'vaso-1x1']

const facingSvg = (d: OfficeSeat['facing']): 'frente' | 'costas' => (d === 'back' ? 'costas' : 'frente')
const modeFor = (id: string): AgentVisualMode => {
  const s = statusFor(id)
  return s === 'working' || s === 'thinking' || s === 'calling' ? 'phone' : 'normal'
}

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

// A real crop of the office map for one sector, built as a standalone single-room
// office. Renders the same room shape, furniture and characters the live "Visão do
// andar" map draws (via MapObject / MapAgent), and runs the SAME simulation engine
// so the agents walk exactly like the map — just confined to the sector: the room
// is the only place there is and the activity envelope (margin 0) keeps every foot
// inside the room's cells, so no one ever steps out of the sector's area.
export function SectorMapCrop({ sector, agents, chars }: { sector: SectorSummary; agents: AgentSummary[]; chars: Chars }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  const nameOf = useMemo(() => {
    const m = new Map(agents.map((a) => [a._id, a.name]))
    return (id: string) => (m.get(id) ?? '').split(' ')[0]
  }, [agents])

  const layout = useMemo(
    () =>
      buildOfficeLayout({
        agents: sector.members.map((m) => ({ _id: m.agentId })),
        sectors: [{ _id: sector._id, name: sector.name, color: sector.color, members: sector.members }],
        aspect: 1.4,
        amenities: [],
        amenityTint: {},
        decorArts: DECOR,
      }),
    [sector],
  )
  const grid = useMemo(() => buildNavigationGrid(layout), [layout])
  // Margin 0 = the envelope is exactly the room's own walkable cells, so agents
  // never leave the sector's area (the map uses a wider margin that spans corridors).
  const envelope = useMemo(() => buildActivityEnvelope(layout, grid, 0), [layout, grid])
  const ambient = useMemo(() => (OFFICE_FEATURES.decoration ? placeOfficeDecor(layout, grid).ambient : []), [layout, grid])

  // Same enable logic as the office map: on unless the sim is off or the user
  // prefers reduced motion. Warm-started like the map so it opens already alive.
  const reduced = useReducedMotion()
  const simOn = OFFICE_FEATURES.simulation && (!reduced || IGNORE_REDUCED_MOTION)
  const sim = useOfficeSimulation(layout, grid, { modeFor, enabled: simOn, warmStart: OFFICE_FEATURES.warmStart, envelope })

  const room = layout.rooms.find((r) => r.kind === 'sector')
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el || !room) return
    const fit = () => {
      const cw = (room.w + PAD * 2) * TILE
      const ch = (room.h + PAD * 2) * TILE
      setScale(Math.min(el.clientWidth / cw, el.clientHeight / ch))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [room])

  if (!room) return <div style={{ width: '100%', height: '100%', background: `color-mix(in oklab, ${sector.color} 14%, var(--surface-sunken, #f2efe9))` }} />

  const lx = (n: number) => n - room.x
  const ly = (n: number) => n - room.y
  const path = roundedPath(traceOutline(room.cells), 0, 0, 0.45)
  const desks = layout.desks.filter((d) => d.roomKey === sector._id)
  const sectorDecor = layout.decor.filter((dc) => dc.roomKey === sector._id)
  const seats = layout.seats.filter((s) => s.sectorId === sector._id)
  const farSeats = seats.filter((s) => !s.chair.near)
  const nearSeats = seats.filter((s) => s.chair.near)
  const wallArt = ambient.filter((a) => a.key === `wall-${sector._id}`)
  const fill = `color-mix(in oklab, ${sector.color} 15%, var(--paper-0, #fff))`

  const staticSeat = (s: OfficeSeat, zIndex: number) => (
    <MapAgent
      key={s.agentId}
      x={lx(s.seatedPoint.x)}
      y={ly(s.seatedPoint.y)}
      status={statusFor(s.agentId)}
      agent={chars.character(s.agentId)}
      facing={facingSvg(s.facing)}
      seated
      department={accentFor(s.agentId)}
      hoverLift={false}
      showName="never"
      style={{ zIndex }}
    />
  )

  const stage: CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: `translate(-50%, -50%) scale(${scale})`,
    transformOrigin: 'center',
    width: `calc(var(--tile) * ${room.w + PAD * 2})`,
    height: `calc(var(--tile) * ${room.h + PAD * 2})`,
  }
  ;(stage as Record<string, string>)['--tile'] = `${TILE}px`

  const box: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: 'var(--map-floor)',
    backgroundImage:
      scale > 0
        ? 'repeating-linear-gradient(90deg, transparent 0 calc(var(--tile) - 1px), var(--map-floor-line) calc(var(--tile) - 1px) var(--tile)), repeating-linear-gradient(0deg, transparent 0 calc(var(--tile) - 1px), var(--map-floor-line) calc(var(--tile) - 1px) var(--tile))'
        : undefined,
    pointerEvents: 'none',
  }
  ;(box as Record<string, string>)['--tile'] = `${TILE * scale}px`

  return (
    <div ref={boxRef} style={box}>
      <div style={stage}>
        {/* Room content, offset by PAD so the shape has floor around it */}
        <div style={{ position: 'absolute', left: `calc(var(--tile) * ${PAD})`, top: `calc(var(--tile) * ${PAD})`, width: `calc(var(--tile) * ${room.w})`, height: `calc(var(--tile) * ${room.h})` }}>
          <svg
            viewBox={`0 0 ${room.w} ${room.h}`}
            preserveAspectRatio="none"
            style={{ position: 'absolute', left: 0, top: 0, width: `calc(var(--tile) * ${room.w})`, height: `calc(var(--tile) * ${room.h})`, overflow: 'visible' }}
          >
            <path d={path} fill={fill} stroke="var(--map-wall)" strokeWidth={4.5} vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 2px 6px var(--map-shadow))' }} />
            <path d={path} fill="none" stroke="var(--map-wall-edge)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </svg>

          {wallArt.map((a) => (
            <MapObject key={a.key} x={lx(a.x)} y={ly(a.y)} w={a.w} h={a.h} art={objectSrc(a.art)} label="" shadow={false} style={{ zIndex: 1, pointerEvents: 'none' }} />
          ))}
          {farSeats.map((s) => (
            <MapObject key={`fc-${s.agentId}`} x={lx(s.seatedPoint.x)} y={ly(s.seatedPoint.y) + 0.5} w={1} h={1} art={objectSrc('cadeira-longe-1x1')} label="" style={{ zIndex: 0, pointerEvents: 'none' }} />
          ))}
          {desks.map((d, i) => (
            <MapObject key={`dk-${i}`} x={lx(d.x)} y={ly(d.y)} w={DESK_W} h={DESK_DEPTH} art={objectSrc('mesa-4-3x3')} label="" style={{ zIndex: 2, pointerEvents: 'none' }} />
          ))}
          {sectorDecor.map((dc, i) => (
            <MapObject key={`de-${i}`} x={lx(dc.x) - 0.85} y={ly(dc.y) - 1.4} w={1.7} h={2} art={objectSrc(dc.art)} label="" style={{ zIndex: 2, pointerEvents: 'none' }} />
          ))}
          {nearSeats.map((s) => (
            <MapObject key={`nc-${s.agentId}`} x={lx(s.seatedPoint.x) - 0.075} y={ly(s.seatedPoint.y) + 1} w={1.15} h={1.3} art={objectSrc('cadeira-perto-1x1.15')} label="" style={{ zIndex: 4, pointerEvents: 'none' }} />
          ))}

          {/* Agents: walking (sim) when live, else seated. The sim writes absolute
              layout coords, so its wrapper shifts to the room's local origin. */}
          {simOn ? (
            <div style={{ position: 'absolute', left: `calc(var(--tile) * ${-room.x})`, top: `calc(var(--tile) * ${-room.y})` }}>
              {seats.map((s) => (
                <SimAgent
                  key={s.agentId}
                  agentId={s.agentId}
                  name={nameOf(s.agentId)}
                  character={chars.character(s.agentId)}
                  status={statusFor(s.agentId)}
                  view={sim.viewOf(s.agentId)}
                  initialX={s.seatedPoint.x}
                  initialY={s.seatedPoint.y}
                  register={sim.register}
                  setHovered={sim.setHovered}
                  onOpen={() => {}}
                />
              ))}
            </div>
          ) : (
            <>
              {farSeats.map((s) => staticSeat(s, 1))}
              {nearSeats.map((s) => staticSeat(s, 3))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
