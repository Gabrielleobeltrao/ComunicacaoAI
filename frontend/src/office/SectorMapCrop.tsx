import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { accentFor, buildCharacterResolver, statusFor } from '../lib/agentAvatar'
import { objectSrc } from '../lib/officeAssets'
import { DESK_DEPTH, DESK_W } from './buildOfficeLayout'
import type { BuiltOfficeLayout } from './buildOfficeLayout'
import type { OfficeDecorResult } from './placeOfficeDecor'
import type { OfficeSeat } from './officeTypes'
import { MapAgent } from './MapAgent'
import { MapObject } from './MapObject'
import { roundedPath, traceOutline } from './roomShape'

type Chars = ReturnType<typeof buildCharacterResolver>
const TILE = 44 // base tile px inside the crop; the whole thing is scaled to fit
const PAD = 1.0 // tiles of floor kept around the room

const facingSvg = (d: OfficeSeat['facing']): 'frente' | 'costas' => (d === 'back' ? 'costas' : 'frente')

// A real crop of the office map for one sector. It renders with the SAME
// components the live "Visão do andar" map uses (MapObject / MapAgent), so the
// furniture and characters land in exactly the same spots — just clipped to this
// sector's room and scaled to fit the card. Static (no simulation), click-through.
export function SectorMapCrop({ layout, decor, sectorId, color, chars }: { layout: BuiltOfficeLayout; decor: OfficeDecorResult; sectorId: string; color: string; chars: Chars }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const room = layout.rooms.find((r) => r.kind === 'sector' && r.key === sectorId)
  const [scale, setScale] = useState(0)

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

  if (!room) return <div style={{ width: '100%', height: '100%', background: `color-mix(in oklab, ${color} 14%, var(--surface-sunken, #f2efe9))` }} />

  const lx = (n: number) => n - room.x
  const ly = (n: number) => n - room.y
  const path = roundedPath(traceOutline(room.cells), 0, 0, 0.45)
  const desks = layout.desks.filter((d) => d.roomKey === sectorId)
  const sectorDecor = layout.decor.filter((dc) => dc.roomKey === sectorId)
  const seats = layout.seats.filter((s) => s.sectorId === sectorId)
  const farSeats = seats.filter((s) => !s.chair.near)
  const nearSeats = seats.filter((s) => s.chair.near)
  // Only room-anchored decoration is drawn: the ambient wall piece (top wall) and
  // the sector's own plant. The themed *floor* objects (shelves/cactus/…) are
  // placed by the map in the CORRIDOR between rooms — their spot depends on the
  // whole floor's packing, so they can't be pinned in a single-room crop; drawing
  // them would put them in a different place than "Visão do andar". So we skip them.
  const ambient = decor.ambient.filter((a) => a.key === `wall-${sectorId}`)
  const fill = `color-mix(in oklab, ${color} 15%, var(--paper-0, #fff))`

  const seated = (s: OfficeSeat, zIndex: number) => (
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

  // The scaled stage is sized to the padded room and centred in the box.
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

  // The floor grid fills the WHOLE card (like the map ground), at the on-screen
  // tile size (TILE·scale); the room's tinted fill covers it inside the room.
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
          {/* Room shape (tetris outline, tinted + wall stroke), like the map */}
          <svg
            viewBox={`0 0 ${room.w} ${room.h}`}
            preserveAspectRatio="none"
            style={{ position: 'absolute', left: 0, top: 0, width: `calc(var(--tile) * ${room.w})`, height: `calc(var(--tile) * ${room.h})`, overflow: 'visible' }}
          >
            <path d={path} fill={fill} stroke="var(--map-wall)" strokeWidth={4.5} vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 2px 6px var(--map-shadow))' }} />
            <path d={path} fill="none" stroke="var(--map-wall-edge)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </svg>

          {/* Ambient wall art (top wall) — drawn below agents, like the map */}
          {ambient.map((a) => (
            <MapObject key={a.key} x={lx(a.x)} y={ly(a.y)} w={a.w} h={a.h} art={objectSrc(a.art)} label="" shadow={false} style={{ zIndex: 1, pointerEvents: 'none' }} />
          ))}
          {/* Furniture + agents in the map's layer order */}
          {farSeats.map((s) => (
            <MapObject key={`fc-${s.agentId}`} x={lx(s.seatedPoint.x)} y={ly(s.seatedPoint.y) + 0.5} w={1} h={1} art={objectSrc('cadeira-longe-1x1')} label="" style={{ zIndex: 0, pointerEvents: 'none' }} />
          ))}
          {farSeats.map((s) => seated(s, 1))}
          {desks.map((d, i) => (
            <MapObject key={`dk-${i}`} x={lx(d.x)} y={ly(d.y)} w={DESK_W} h={DESK_DEPTH} art={objectSrc('mesa-4-3x3')} label="" style={{ zIndex: 2, pointerEvents: 'none' }} />
          ))}
          {sectorDecor.map((dc, i) => (
            <MapObject key={`de-${i}`} x={lx(dc.x) - 0.85} y={ly(dc.y) - 1.4} w={1.7} h={2} art={objectSrc(dc.art)} label="" style={{ zIndex: 2, pointerEvents: 'none' }} />
          ))}
          {nearSeats.map((s) => seated(s, 3))}
          {nearSeats.map((s) => (
            <MapObject key={`nc-${s.agentId}`} x={lx(s.seatedPoint.x) - 0.075} y={ly(s.seatedPoint.y) + 1} w={1.15} h={1.3} art={objectSrc('cadeira-perto-1x1.15')} label="" style={{ zIndex: 4, pointerEvents: 'none' }} />
          ))}
        </div>
      </div>
    </div>
  )
}
