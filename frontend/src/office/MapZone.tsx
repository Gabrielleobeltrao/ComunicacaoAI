import type { CSSProperties, ReactNode } from 'react'
import { NamePill } from './NamePill'

const FLOORS: Record<string, string> = {
  hall: 'var(--map-floor)',
  room: 'var(--map-room-1)',
  meeting: 'var(--map-room-2)',
  rug: 'var(--map-rug)',
  outdoor: 'var(--map-outdoor)',
}

interface MapZoneProps {
  x: number
  y: number
  w: number
  h: number
  floor?: string
  tint?: string
  label?: string
  walls?: boolean
  children?: ReactNode
  style?: CSSProperties
}

export function MapZone({ x, y, w, h, floor = 'room', tint, label, walls = true, children, style }: MapZoneProps) {
  const bg = tint ? `color-mix(in oklab, ${tint} 16%, var(--paper-0))` : (FLOORS[floor] ?? FLOORS.room)
  return (
    <div
      style={{
        position: 'absolute',
        left: `calc(var(--tile) * ${x})`,
        top: `calc(var(--tile) * ${y})`,
        width: `calc(var(--tile) * ${w})`,
        height: `calc(var(--tile) * ${h})`,
        background: bg,
        backgroundImage:
          floor === 'hall'
            ? 'repeating-linear-gradient(90deg, transparent 0 calc(var(--tile) - 1px), var(--map-floor-line) calc(var(--tile) - 1px) var(--tile)), repeating-linear-gradient(0deg, transparent 0 calc(var(--tile) - 1px), var(--map-floor-line) calc(var(--tile) - 1px) var(--tile))'
            : undefined,
        border: walls ? '4px solid var(--map-wall)' : undefined,
        boxShadow: walls
          ? 'inset 0 0 0 1px var(--map-wall-edge), inset 0 6px 14px rgba(255,255,255,.5), 0 2px 6px var(--map-shadow)'
          : undefined,
        borderRadius: floor === 'rug' ? 10 : 4,
        ...style,
      }}
    >
      {label ? (
        <NamePill
          name={label}
          tone="light"
          style={{ position: 'absolute', left: '50%', top: 8, transform: 'translateX(-50%)', zIndex: 5 }}
        />
      ) : null}
      {children}
    </div>
  )
}
