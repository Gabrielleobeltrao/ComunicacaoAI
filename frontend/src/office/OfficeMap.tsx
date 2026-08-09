import { useRef } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'

interface OfficeMapProps {
  cols?: number
  rows?: number
  tile?: number
  zoom?: number
  children?: ReactNode
  style?: CSSProperties
}

// The office viewport: a fixed-size window onto a larger floor. The grid fills
// at least the whole window (both axes) and you drag to pan around — so the
// office can grow with more sectors/agents without the block growing on screen.
export function OfficeMap({ cols = 26, rows = 16, tile = 56, zoom = 1, children, style }: OfficeMapProps) {
  const t = tile * zoom
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef({ x: 0, y: 0, sl: 0, st: 0, active: false, moved: false })

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const el = ref.current
    if (!el) return
    drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, active: true, moved: false }
    el.style.cursor = 'grabbing'
    el.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d.active) return
    const el = ref.current
    if (!el) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true
    el.scrollLeft = d.sl - dx
    el.scrollTop = d.st - dy
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current.active = false
    const el = ref.current
    if (el) {
      el.style.cursor = 'grab'
      el.releasePointerCapture?.(e.pointerId)
    }
  }
  // Swallow the click that ends a pan so agents don't navigate after dragging.
  const onClickCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current.moved) {
      e.stopPropagation()
      e.preventDefault()
      drag.current.moved = false
    }
  }

  const inner: CSSProperties = {
    position: 'relative',
    width: `max(${cols * tile}px, 100%)`,
    height: `max(${rows * tile}px, 100%)`,
    background: 'var(--map-floor)',
    backgroundImage:
      'repeating-linear-gradient(90deg, transparent 0 calc(var(--tile) - 1px), var(--map-floor-line) calc(var(--tile) - 1px) var(--tile)), repeating-linear-gradient(0deg, transparent 0 calc(var(--tile) - 1px), var(--map-floor-line) calc(var(--tile) - 1px) var(--tile))',
  }
  ;(inner as Record<string, string>)['--tile'] = `${t}px`

  return (
    <div
      ref={ref}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onClickCapture={onClickCapture}
      style={{
        position: 'relative',
        overflow: 'auto',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
        background: 'var(--map-floor)',
        borderRadius: 'var(--radius-panel)',
        ...style,
      }}
    >
      <div style={inner}>{children}</div>
    </div>
  )
}
