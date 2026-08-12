import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { IconButton } from '../ui'

interface OfficeMapProps {
  cols?: number
  rows?: number
  tile?: number
  zoom?: number
  fitToView?: boolean
  labelsShown?: boolean
  onToggleLabels?: () => void
  paused?: boolean
  onTogglePause?: () => void
  recallActive?: boolean
  onRecall?: () => void
  children?: ReactNode
  style?: CSSProperties
}

const ABS_MIN_ZOOM = 0.3
const MAX_ZOOM = 2
const ZOOM_STEP = 0.15
const round2 = (z: number) => Math.round(z * 100) / 100

// The office viewport: a fixed-size window onto the floor. Drag to pan (no
// scrollbars/wheel-scroll), and zoom with the +/-/reset controls or Ctrl/Cmd +
// wheel. The floor grid always fills the whole window; zooming out stops once
// the entire office fits, so it never shrinks into a corner leaving empty space.
export function OfficeMap({ cols = 26, rows = 16, tile = 56, zoom: initialZoom = 1, fitToView = false, labelsShown = false, onToggleLabels, paused = false, onTogglePause, recallActive = false, onRecall, children, style }: OfficeMapProps) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef({ x: 0, y: 0, sl: 0, st: 0, active: false, moved: false })
  const userZoomed = useRef(false)
  const [zoom, setZoom] = useState(initialZoom)
  const t = tile * zoom
  const cw = cols * t
  const ch = rows * t

  // Measure the viewport so the zoom-out floor can track the office's real size.
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      setViewport((v) => (v.w === w && v.h === h ? v : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Lowest zoom that still shows the WHOLE office (contain-fit): the office's
  // max width/height is the zoom-out limit, so you never zoom past it into a
  // mostly-empty screen. Capped at 1 (never force a zoom-in as the minimum).
  const baseW = cols * tile
  const baseH = rows * tile
  const fitZoom = viewport.w > 0 && viewport.h > 0 ? Math.min(viewport.w / baseW, viewport.h / baseH) : ABS_MIN_ZOOM
  const minZoom = Math.min(1, Math.max(ABS_MIN_ZOOM, round2(fitZoom)))
  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(minZoom, round2(z)))

  // Until the user zooms manually, keep the whole office fitted to the viewport
  // (so the default view fills it with no dead space). After they zoom, only
  // re-clamp so the zoom never drops below the fit limit.
  useEffect(() => {
    if (viewport.w === 0) return
    if (fitToView && !userZoomed.current) setZoom(minZoom)
    else setZoom((z) => Math.min(MAX_ZOOM, Math.max(minZoom, z)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minZoom, fitToView])

  // Keep the viewport centre stable across a zoom change.
  const pendingAnchor = useRef<{ fx: number; fy: number } | null>(null)
  const zoomBy = (delta: number) => {
    userZoomed.current = true
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

  // Fullscreen for the whole viewport.
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [isFull, setIsFull] = useState(false)
  useEffect(() => {
    const onFs = () => setIsFull(document.fullscreenElement === wrapperRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])
  const toggleFull = () => {
    const el = wrapperRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen()
    else el.requestFullscreen?.()
  }

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

  // Centre the office when it's smaller than the viewport, pin it to the corner
  // (offset 0) when it's larger and pans. The grid follows the same offset so it
  // fills the whole window AND stays aligned with the rooms.
  const offX = `max(0px, calc((100% - ${cw}px) / 2))`
  const offY = `max(0px, calc((100% - ${ch}px) / 2))`

  const inner: CSSProperties = {
    position: 'relative',
    width: `max(${cw}px, 100%)`,
    height: `max(${ch}px, 100%)`,
    background: 'var(--map-floor)',
    backgroundImage:
      'repeating-linear-gradient(90deg, transparent 0 calc(var(--tile) - 1px), var(--map-floor-line) calc(var(--tile) - 1px) var(--tile)), repeating-linear-gradient(0deg, transparent 0 calc(var(--tile) - 1px), var(--map-floor-line) calc(var(--tile) - 1px) var(--tile))',
    backgroundPosition: `${offX} ${offY}`,
  }
  ;(inner as Record<string, string>)['--tile'] = `${t}px`

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--map-floor)',
        borderRadius: 'var(--radius-panel)',
        ...style,
        ...(isFull ? { width: '100%', height: '100%', borderRadius: 0 } : null),
      }}
    >
      <div
        ref={ref}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onClickCapture={onClickCapture}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
      >
        <div style={inner}>
          {/* Content layer — centred within the floor when the office is small. */}
          <div style={{ position: 'absolute', left: offX, top: offY, width: `${cw}px`, height: `${ch}px` }}>{children}</div>
        </div>
      </div>

      {/* Zoom + fullscreen controls — fixed in the corner, above the panning floor. */}
      <div style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 30, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {onTogglePause ? (
          <IconButton
            icon={paused ? 'play' : 'pause'}
            variant="card"
            size="sm"
            label={paused ? 'Retomar a simulação' : 'Pausar a simulação'}
            aria-pressed={paused}
            onClick={onTogglePause}
            style={paused ? { color: 'var(--text-on-brand)', background: 'var(--intent-brand)', borderColor: 'var(--intent-brand)' } : undefined}
          />
        ) : null}
        {onRecall ? (
          <IconButton
            icon="armchair"
            variant="card"
            size="sm"
            label={recallActive ? 'Voltando às mesas…' : 'Retornar às mesas'}
            aria-pressed={recallActive}
            onClick={onRecall}
            style={recallActive ? { color: 'var(--text-on-brand)', background: 'var(--intent-brand)', borderColor: 'var(--intent-brand)' } : undefined}
          />
        ) : null}
        {onToggleLabels ? (
          <IconButton
            icon="tag"
            variant="card"
            size="sm"
            label={labelsShown ? 'Ocultar nomes dos setores' : 'Mostrar nomes dos setores'}
            aria-pressed={labelsShown}
            onClick={onToggleLabels}
            style={labelsShown ? { color: 'var(--text-on-brand)', background: 'var(--intent-brand)', borderColor: 'var(--intent-brand)' } : undefined}
          />
        ) : null}
        <IconButton icon={isFull ? 'shrink' : 'expand'} variant="card" size="sm" label={isFull ? 'Sair da tela cheia' : 'Tela cheia'} onClick={toggleFull} />
        <IconButton icon="plus" variant="card" size="sm" label="Aproximar" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} />
        <IconButton icon="minus" variant="card" size="sm" label="Afastar" onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= minZoom} />
        <IconButton
          icon="maximize"
          variant="card"
          size="sm"
          label="Ajustar à tela"
          onClick={() => {
            userZoomed.current = false
            pendingAnchor.current = null
            setZoom(minZoom)
          }}
          disabled={round2(zoom) <= minZoom}
        />
      </div>
    </div>
  )
}
