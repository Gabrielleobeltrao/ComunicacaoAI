import { useMemo } from 'react'
import { accentFor } from '../lib/agentAvatar'
import { DESK_DEPTH, DESK_W } from './buildOfficeLayout'
import type { BuiltOfficeLayout } from './buildOfficeLayout'
import { roundedPath, traceOutline } from './roomShape'

// A static top-down "crop" of the office map showing exactly one sector's room:
// the room outline (tinted like the live map), its desks and the seated agents.
// Pure SVG — deterministic, theme-aware, no sprite loading. It reuses the very
// geometry the live map draws (buildOfficeLayout), clipped to the room's own box.
export function SectorThumbnail({ layout, sectorId, color }: { layout: BuiltOfficeLayout; sectorId: string; color: string }) {
  const room = useMemo(() => layout.rooms.find((r) => r.kind === 'sector' && r.key === sectorId), [layout, sectorId])
  const path = useMemo(() => (room ? roundedPath(traceOutline(room.cells), 0, 0, 0.45) : ''), [room])

  if (!room) return <div style={{ width: '100%', height: '100%', background: `color-mix(in oklab, ${color} 14%, var(--surface-sunken, #f2efe9))` }} />

  const desks = layout.desks.filter((d) => d.roomKey === sectorId)
  const seats = layout.seats.filter((s) => s.sectorId === sectorId)
  const fill = `color-mix(in oklab, ${color} 17%, var(--paper-0, #fff))`
  const pad = 0.7 // breathing room so the outline/shadow isn't clipped
  const gid = `grid-${sectorId}`

  return (
    <svg
      viewBox={`${-pad} ${-pad} ${room.w + pad * 2} ${room.h + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block' }}
      role="img"
      aria-label="Recorte do mapa do setor"
    >
      <defs>
        <pattern id={gid} width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M1 0V1M0 1H1" fill="none" stroke="var(--map-wall-edge, rgba(0,0,0,.06))" strokeWidth={0.02} />
        </pattern>
      </defs>
      {/* Floor grid, echoing the live map */}
      <rect x={-pad} y={-pad} width={room.w + pad * 2} height={room.h + pad * 2} fill={`url(#${gid})`} />
      {/* The room shape (same tint + wall stroke as the map) */}
      <path d={path} fill={fill} stroke="var(--map-wall, #cbb79a)" strokeWidth={0.09} strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0.06px 0.18px var(--map-shadow, rgba(0,0,0,.15)))' }} />
      {/* Desks */}
      {desks.map((d, i) => (
        <rect key={i} x={d.x - room.x} y={d.y - room.y} width={DESK_W} height={DESK_DEPTH} rx={0.35} fill="var(--map-desk, #d8c3a0)" stroke="var(--map-wall, #cbb79a)" strokeWidth={0.05} />
      ))}
      {/* Seated agents (dot coloured by department, like the map avatars) */}
      {seats.map((s) => (
        <circle key={s.agentId} cx={s.seatedPoint.x - room.x} cy={s.seatedPoint.y - room.y} r={0.6} fill={accentFor(s.agentId)} stroke="var(--paper-0, #fff)" strokeWidth={0.13} />
      ))}
    </svg>
  )
}
