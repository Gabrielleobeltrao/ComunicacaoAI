import { buildCharacterResolver } from '../lib/agentAvatar'
import { characterSrc, objectSrc } from '../lib/officeAssets'
import { DESK_DEPTH, DESK_W } from './buildOfficeLayout'
import type { BuiltOfficeLayout } from './buildOfficeLayout'
import type { OfficeSeat } from './officeTypes'
import { roundedPath, traceOutline } from './roomShape'

type Chars = ReturnType<typeof buildCharacterResolver>

// A real crop of the office map for one sector — the same room shape, furniture
// (desks/chairs/plants) and seated character sprites the live "Visão do andar"
// map draws, just clipped to this sector's room. Rendered as a single self-scaling
// SVG (the illustrations are SVG files embedded via <image>), so it needs no
// simulation, no measuring and no sprite preload. Layer order mirrors the map:
// far chairs → far agents → desks/decor → near agents → near chairs.
export function SectorMapCrop({ layout, sectorId, color, chars }: { layout: BuiltOfficeLayout; sectorId: string; color: string; chars: Chars }) {
  const room = layout.rooms.find((r) => r.kind === 'sector' && r.key === sectorId)
  if (!room) return <div style={{ width: '100%', height: '100%', background: `color-mix(in oklab, ${color} 14%, var(--surface-sunken, #f2efe9))` }} />

  const lx = (n: number) => n - room.x
  const ly = (n: number) => n - room.y
  const path = roundedPath(traceOutline(room.cells), 0, 0, 0.45)
  const desks = layout.desks.filter((d) => d.roomKey === sectorId)
  const decor = layout.decor.filter((dc) => dc.roomKey === sectorId)
  const seats = layout.seats.filter((s) => s.sectorId === sectorId)
  const farSeats = seats.filter((s) => !s.chair.near)
  const nearSeats = seats.filter((s) => s.chair.near)

  const pad = 1.4
  const vb = { x: -pad, y: -pad, w: room.w + pad * 2, h: room.h + pad * 2 }
  const fill = `color-mix(in oklab, ${color} 16%, var(--paper-0, #fff))`
  const gid = `sc-grid-${sectorId}`
  const sid = `sc-shadow-${sectorId}`

  // Seated character sprite — same box maths as MapAgent (bottom-anchored).
  const agentImg = (s: OfficeSeat) => {
    const view = s.facing === 'back' ? 'costas' : 'frente'
    const scale = 1.25
    const w = scale
    const h = 1.5 * scale
    return (
      <image
        key={s.agentId}
        href={characterSrc(chars.character(s.agentId), `${view}-sentado`)}
        x={lx(s.seatedPoint.x) - (w - 1) / 2}
        y={ly(s.seatedPoint.y) - (h - 1.5)}
        width={w}
        height={h}
        preserveAspectRatio="xMidYMax meet"
        filter={`url(#${sid})`}
      />
    )
  }

  return (
    <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }} role="img" aria-label="Recorte do mapa do setor">
      <defs>
        <pattern id={gid} width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M1 0V1M0 1H1" fill="none" stroke="var(--map-floor-line, rgba(0,0,0,.05))" strokeWidth={0.03} />
        </pattern>
        <filter id={sid} x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="0.06" stdDeviation="0.05" floodColor="#000" floodOpacity="0.22" />
        </filter>
      </defs>

      {/* Floor + grid, exactly like the map ground */}
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="var(--map-floor, #f3ecdc)" />
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={`url(#${gid})`} />

      {/* Room shape (tinted + wall stroke, matching the live map) */}
      <path d={path} fill={fill} stroke="var(--map-wall, #cbb79a)" strokeWidth={0.14} strokeLinejoin="round" />

      {/* Far chairs (behind the desks) */}
      {farSeats.map((s, i) => (
        <image key={`fc-${i}`} href={objectSrc('cadeira-longe-1x1')} x={lx(s.seatedPoint.x)} y={ly(s.seatedPoint.y) + 0.5} width={1} height={1} preserveAspectRatio="xMidYMid meet" />
      ))}
      {/* Far agents sit behind their desk */}
      {farSeats.map(agentImg)}
      {/* Desks + sector décor */}
      {desks.map((d, i) => (
        <image key={`dk-${i}`} href={objectSrc('mesa-4-3x3')} x={lx(d.x)} y={ly(d.y)} width={DESK_W} height={DESK_DEPTH} preserveAspectRatio="xMidYMid meet" filter={`url(#${sid})`} />
      ))}
      {decor.map((dc, i) => (
        <image key={`de-${i}`} href={objectSrc(dc.art)} x={lx(dc.x) - 0.85} y={ly(dc.y) - 1.4} width={1.7} height={2} preserveAspectRatio="xMidYMax meet" filter={`url(#${sid})`} />
      ))}
      {/* Near agents, then the near chair drawn in front of them */}
      {nearSeats.map(agentImg)}
      {nearSeats.map((s, i) => (
        <image key={`nc-${i}`} href={objectSrc('cadeira-perto-1x1.15')} x={lx(s.seatedPoint.x) - 0.075} y={ly(s.seatedPoint.y) + 1} width={1.15} height={1.3} preserveAspectRatio="xMidYMid meet" />
      ))}
    </svg>
  )
}
