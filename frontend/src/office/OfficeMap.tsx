import type { CSSProperties, ReactNode } from 'react'

interface OfficeMapProps {
  cols?: number
  rows?: number
  tile?: number
  zoom?: number
  children?: ReactNode
  style?: CSSProperties
}

// The map floor: a common grid that fills the whole viewport (at least the
// container's width) and scrolls with the content, so rooms/agents sit on top of
// an unbroken floor no matter how wide the card is.
export function OfficeMap({ cols = 26, rows = 16, tile = 56, zoom = 1, children, style }: OfficeMapProps) {
  const t = tile * zoom
  const inner: CSSProperties = {
    position: 'relative',
    width: `max(${cols * tile}px, 100%)`,
    height: `calc(var(--tile) * ${rows})`,
    background: 'var(--map-floor)',
    backgroundImage:
      'repeating-linear-gradient(90deg, transparent 0 calc(var(--tile) - 1px), var(--map-floor-line) calc(var(--tile) - 1px) var(--tile)), repeating-linear-gradient(0deg, transparent 0 calc(var(--tile) - 1px), var(--map-floor-line) calc(var(--tile) - 1px) var(--tile))',
  }
  ;(inner as Record<string, string>)['--tile'] = `${t}px`
  return (
    <div style={{ position: 'relative', overflow: 'auto', background: 'var(--map-floor)', borderRadius: 'var(--radius-panel)', ...style }}>
      <div style={inner}>{children}</div>
    </div>
  )
}
