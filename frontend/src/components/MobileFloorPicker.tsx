import { useEffect, useMemo, useRef, useState } from 'react'
import { useBuildingContext } from '../contexts/BuildingContext'
import { Icon } from '../ui'

// Touch-first floor switcher (mobile parity plan §6.2). A bottom sheet — NOT the
// desktop popover reused inside a drawer — so switching floors is one tap from the
// topbar trigger. Accessible: role=dialog, focus trap, Escape, overlay-close, body
// scroll lock, safe-area padding. Reads the single BuildingProvider (no refetch).
export function MobileFloorPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { building, floors, activeFloorId, loading, error, selectFloor, reloadFloors } = useBuildingContext()
  const sheetRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const [query, setQuery] = useState('')

  const active = useMemo(() => floors.filter((f) => f.status === 'active'), [floors])
  const showSearch = active.length > 8
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? active.filter((f) => `${f.name} ${f.mission ?? ''}`.toLowerCase().includes(q)) : active
  }, [active, query])

  // Body scroll lock + focus management while the sheet is open.
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Move focus into the sheet.
    const t = setTimeout(() => sheetRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Tab') {
        // Simple focus trap over the sheet's tabbable elements.
        const nodes = sheetRef.current?.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')
        if (!nodes || nodes.length === 0) return
        const list = Array.from(nodes).filter((n) => !n.hasAttribute('disabled'))
        const first = list[0]
        const last = list[list.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      restoreFocusRef.current?.focus?.()
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  if (!open) return null

  const pick = (floorId: string) => {
    onClose()
    selectFloor(floorId, { preserveSection: true })
  }

  return (
    <div role="presentation" onClick={onClose} style={overlay}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Trocar de andar"
        onClick={(e) => e.stopPropagation()}
        style={sheet}
      >
        <div style={grip} aria-hidden />
        <div style={header}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: 'var(--text-heading)' }}>Trocar de andar</p>
            {building?.name ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{building.name}</p> : null}
          </div>
          <button data-autofocus onClick={onClose} aria-label="Fechar" style={iconBtn}>
            <Icon name="x" size={20} />
          </button>
        </div>

        {showSearch && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar andar"
            aria-label="Buscar andar"
            style={search}
          />
        )}

        <div style={list}>
          {loading && active.length === 0 ? (
            <p style={muted}>Carregando andares…</p>
          ) : error ? (
            <div style={{ padding: '8px 4px' }}>
              <p style={{ margin: '0 0 8px', color: 'var(--coral-600, #d92d20)', fontSize: 14 }}>Não foi possível carregar os andares.</p>
              <button onClick={() => void reloadFloors()} style={retryBtn}>
                Tentar novamente
              </button>
            </div>
          ) : active.length === 0 ? (
            <p style={muted}>Nenhum andar ativo ainda.</p>
          ) : filtered.length === 0 ? (
            <p style={muted}>Nenhum andar encontrado.</p>
          ) : (
            filtered.map((f) => {
              const current = f.id === activeFloorId
              return (
                <button key={f.id} onClick={() => pick(f.id)} aria-current={current ? 'true' : undefined} style={row(current)}>
                  <span style={{ width: 12, height: 12, borderRadius: 4, background: f.color ?? 'var(--accent, #6b5cff)', flexShrink: 0 }} />
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, textAlign: 'left' }}>
                    <span style={{ fontSize: 15, fontWeight: current ? 800 : 600, color: 'var(--text-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    {f.mission ? <span style={{ fontSize: 12.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.mission}</span> : null}
                  </span>
                  {current ? <Icon name="check" size={18} color="var(--intent-brand, #2e5bff)" /> : null}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 60,
  background: 'rgba(16,18,27,.45)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
}
const sheet: React.CSSProperties = {
  width: '100%',
  maxWidth: 560,
  maxHeight: '80dvh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--paper-0, #fff)',
  borderTopLeftRadius: 20,
  borderTopRightRadius: 20,
  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
  boxShadow: '0 -12px 40px rgba(16,18,27,.24)',
}
const grip: React.CSSProperties = { width: 40, height: 4, borderRadius: 999, background: 'var(--border-strong, #d0d5dd)', margin: '10px auto 4px' }
const header: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 16px 10px' }
const iconBtn: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 44, height: 44, marginRight: -8, borderRadius: 10, border: 0, background: 'transparent', color: 'var(--text-heading)', cursor: 'pointer', flexShrink: 0 }
const search: React.CSSProperties = { margin: '0 16px 8px', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-strong,#d0d5dd)', font: 'inherit', background: 'var(--surface-card,#fff)', color: 'inherit' }
const list: React.CSSProperties = { overflowY: 'auto', padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }
const muted: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 14, padding: '8px 8px 12px' }
const retryBtn: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-strong,#d0d5dd)', background: 'var(--surface-card,#fff)', font: 'inherit', cursor: 'pointer' }
const row = (current: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  minHeight: 52,
  padding: '8px 12px',
  borderRadius: 12,
  border: 0,
  background: current ? 'var(--intent-brand-soft, #eef2ff)' : 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
})
