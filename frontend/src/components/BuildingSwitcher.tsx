import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useBuildingContext } from '../contexts/BuildingContext'
import { COLLAPSE_FADE } from '../lib/sidebarStyles'
import { Icon } from '../ui'
import { BuildingSettingsDialog } from './BuildingSettingsDialog'

// Building header + floor popover (UX reorg §6.2/§6.3). Represents the workspace
// (not the logged-in account, which lives in the footer). Accessible: keyboard,
// Escape and click-outside close.
// `expanded` forces the full switcher (label + chevron) always visible — used in
// the mobile drawer, which has no hover-rail to reveal collapsed content.
export function BuildingSwitcher({ expanded = false }: { expanded?: boolean }) {
  const { building, floors, activeFloor, selectFloor } = useBuildingContext()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  // The dialog lives in the URL, so it survives a reload, closes with Back, and can
  // be linked to. `?buildingSettings=1`.
  const [params, setParams] = useSearchParams()
  const settingsOpen = params.get('buildingSettings') === '1'
  const setSettingsOpen = (next: boolean) => {
    const q = new URLSearchParams(params)
    if (next) q.set('buildingSettings', '1')
    else q.delete('buildingSettings')
    // Opening pushes (so Back closes it); closing replaces, so Back does not reopen.
    setParams(q, { replace: !next })
  }

  const name = building?.name?.trim() || 'Meu prédio'
  const active = floors.filter((f) => f.status === 'active')
  // When forced expanded, drop the rail collapse behaviour entirely.
  const fade = expanded ? '' : COLLAPSE_FADE

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // O rail do desktop encolhe sozinho quando o mouse sai (CSS `group-hover`).
    // Sem isto, o popover continuava aberto pendurado num rail de 64px, cobrindo o
    // conteúdo e sem alinhamento com nada.
    const rail = ref.current?.closest('[data-rail]')
    const onLeave = () => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    rail?.addEventListener('mouseleave', onLeave)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      rail?.removeEventListener('mouseleave', onLeave)
    }
  }, [open])

  const go = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Um controle só. A engrenagem solta ao lado duplicava o item "Configurações
          do prédio" que já existe dentro do próprio seletor. */}
      <div style={{ display: 'flex' }}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Prédio e andares"
          className={`flex min-w-0 flex-1 items-center gap-2 ${expanded ? 'justify-start' : 'justify-center gap-0 group-hover:justify-start group-hover:gap-2'}`}
          style={headerBtn}
          data-testid="building-switcher"
        >
          <span className={`flex min-w-0 flex-1 flex-col text-left ${fade}`}>
            <strong style={truncate}>{name}</strong>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeFloor ? activeFloor.name : 'Nenhum andar'} · {active.length} andar(es)
            </span>
          </span>
          <Icon name="chevrons-up-down" size={14} />
        </button>
      </div>

      {open && (
        <div role="menu" style={popover}>
          <button role="menuitem" style={menuItem} onClick={go(() => navigate('/dashboard'))}>
            Início
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
          <button role="menuitem" style={menuItem} onClick={go(() => setSettingsOpen(true))} data-testid="open-building-settings">
            Configurações do prédio
          </button>
        </div>
      )}

      {/* The building's own settings are a pop-up from here, not a page: they belong
          to the selector that represents the workspace. */}
      <BuildingSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        buildingName={name}
        floors={floors}
      />
    </div>
  )
}

function Dot({ color }: { color: string | null }) {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color ?? 'var(--text-muted)', display: 'inline-block', marginRight: 6 }} />
}

const truncate: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }
const headerBtn: React.CSSProperties = {
  padding: 6,
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-sunken)',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
}
const popover: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: 0,
  right: 0,
  zIndex: 50,
  minWidth: 220,
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
