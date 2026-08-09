import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { IconButton } from '../ui'

interface OfficeMapProps {
  cols?: number
  rows?: number
  tile?: number
  zoom?: number
  children?: ReactNode
  style?: CSSProperties
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.15
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))

// The office viewport: a fixed-size window onto a larger floor. Drag to pan
// (no scrollbars/wheel-scroll), and zoom with the +/-/reset controls or
// Ctrl/Cmd + wheel. The grid always fills the whole window on both axes.
export function OfficeMap({ cols = 26, rows = 16, tile = 56, zoom: initialZoom = 1, children, style }: OfficeMapProps) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef({ x: 0, y: 0, sl: 0, st: 0, active: false, moved: false })
  const [zoom, setZoom] = useState(initialZoom)
  const t = tile * zoom

  // Keep the viewport centre stable across a zoom change.
  const pendingAnchor = useRef<{ fx: number; fy: number } | null>(null)
  const zoomBy = (delta: number) => {
    const el = ref.current
    if (el) {
      pendingAnchor.current = {
        fx: (el.scrollLeft + el.clientWidth / 2) / Math.max(1, el.scrollWidth),
        fy: (el.scrollTop + el.clientHeight / 2) / Math.max(1, el.scrollHeight),
      }
    }
    setZoom((z) => clampZoom(z + delta))
  }
  useLayoutEffect(() => {
    const el = ref.current
    const a = pendingAnchor.current
    if (el && a) {
      el.scrollLeft = a.fx * el.scrollWidth - el.clientWidth / 2
      el.scrollTop = a.fy * el.scrollHeight - el.clientHeight / 2
      pendingAnchor.current = null
    }
  }, [zoom])

  // Ctrl/Cmd + wheel zoom (native, non-passive so we can preventDefault).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    width: `max(${cols * t}px, 100%)`,
    height: `max(${rows * t}px, 100%)`,
    background: 'var(--map-floor)',
    backgroundImage:
      'repeating-linear-gradient(90deg, transparent 0 calc(var(--tile) - 1px), var(--map-floor-line) calc(var(--tile) - 1px) var(--tile)), repeating-linear-gradient(0deg, transparent 0 calc(var(--tile) - 1px), var(--map-floor-line) calc(var(--tile) - 1px) var(--tile))',
  }
  ;(inner as Record<string, string>)['--tile'] = `${t}px`

  return (
    <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--map-floor)', borderRadius: 'var(--radius-panel)', ...style }}>
      <div
        ref={ref}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onClickCapture={onClickCapture}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
      >
        <div style={inner}>{children}</div>
      </div>

      {/* Zoom controls — fixed in the corner, above the panning floor. */}
      <div style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 30, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <IconButton icon="plus" variant="card" size="sm" label="Aproximar" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} />
        <IconButton icon="minus" variant="card" size="sm" label="Afastar" onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} />
        <IconButton icon="maximize" variant="card" size="sm" label="Redefinir zoom" onClick={() => zoomBy(1 - zoom)} disabled={zoom === 1} />
      </div>
    </div>
  )
}
