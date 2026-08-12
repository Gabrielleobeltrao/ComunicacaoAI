import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useBuildingContext } from '../contexts/BuildingContext'
import { Icon } from '../ui'

// Building header + floor popover (UX reorg §6.2/§6.3). Represents the workspace
// (not the logged-in account, which lives in the footer). Accessible: keyboard,
// Escape and click-outside close.
export function BuildingSwitcher() {
  const { building, floors, activeFloor, selectFloor } = useBuildingContext()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const name = building?.name?.trim() || 'Meu prédio'
  const active = floors.filter((f) => f.status === 'active')

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const go = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Prédio e andares" style={headerBtn}>
        <span style={avatar}>{name.charAt(0).toUpperCase()}</span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, textAlign: 'left', flex: 1 }}>
          <strong style={truncate}>{name}</strong>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {activeFloor ? activeFloor.name : 'Nenhum andar'} · {active.length} andar(es)
          </span>
        </span>
        <Icon name="chevrons-up-down" size={14} />
      </button>

      {open && (
        <div role="menu" style={popover}>
          <button role="menuitem" style={menuItem} onClick={go(() => navigate('/dashboard'))}>
            Visão geral
          </button>
          <div style={sectionLabel}>ANDAR ATUAL</div>
          {activeFloor ? (
            <div style={{ ...menuItem, fontWeight: 600, cursor: 'default' }}>
              <Dot color={activeFloor.color} /> {activeFloor.name}
            </div>
          ) : (
            <div style={{ ...menuItem, color: 'var(--text-muted)', cursor: 'default' }}>—</div>
          )}
          {active.some((f) => f.id !== activeFloor?.id) && <div style={sectionLabel}>OUTROS ANDARES</div>}
          {active
            .filter((f) => f.id !== activeFloor?.id)
            .map((f) => (
              <button key={f.id} role="menuitem" style={menuItem} onClick={go(() => selectFloor(f.id, { preserveSection: true }))}>
                <Dot color={f.color} /> {f.name}
              </button>
            ))}
          <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '6px 0' }} />
          <button role="menuitem" style={menuItem} onClick={go(() => navigate('/dashboard'))}>
            + Criar andar
          </button>
          <button role="menuitem" style={menuItem} onClick={go(() => navigate('/settings'))}>
            Configurações do prédio
          </button>
        </div>
      )}
    </div>
  )
}

function Dot({ color }: { color: string | null }) {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color ?? 'var(--text-muted)', display: 'inline-block', marginRight: 6 }} />
}

const truncate: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }
const headerBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 8px',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-sunken)',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
}
const avatar: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 8,
  background: 'var(--intent-brand, #2e5bff)',
  color: '#fff',
  display: 'grid',
  placeItems: 'center',
  fontSize: 13,
  fontWeight: 700,
  flexShrink: 0,
}
const popover: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: 0,
  right: 0,
  zIndex: 50,
  background: 'var(--paper-0, #fff)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  boxShadow: '0 16px 40px rgba(22,24,31,.16)',
  padding: 6,
  maxHeight: 360,
  overflowY: 'auto',
}
const menuItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: '7px 8px',
  borderRadius: 8,
  border: 0,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13,
  textAlign: 'left',
}
const sectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-muted)', padding: '8px 8px 2px' }
