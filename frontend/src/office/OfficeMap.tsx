import type { CSSProperties, ReactNode } from 'react'

interface OfficeMapProps {
  cols?: number
  rows?: number
  tile?: number
  zoom?: number
  children?: ReactNode
  style?: CSSProperties
}

export function OfficeMap({ cols = 26, rows = 16, tile = 56, zoom = 1, children, style }: OfficeMapProps) {
  const inner: CSSProperties = {
    position: 'relative',
    width: `calc(var(--tile) * ${cols})`,
    height: `calc(var(--tile) * ${rows})`,
  }
  ;(inner as Record<string, string>)['--tile'] = `${tile * zoom}px`
  return (
    <div style={{ position: 'relative', overflow: 'auto', background: 'var(--map-outdoor)', borderRadius: 'var(--radius-panel)', ...style }}>
      <div style={inner}>{children}</div>
    </div>
  )
}
