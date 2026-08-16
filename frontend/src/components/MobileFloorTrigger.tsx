import { useLocation } from 'react-router'
import { useOptionalBuildingContext } from '../contexts/BuildingContext'
import { parseFloorPath } from '../lib/floorRoutes'
import { Icon } from '../ui'

// Compact topbar trigger that shows the current floor and opens the mobile floor
// picker in one tap (plan §6.1). Only on floor routes; desktop uses the sidebar
// switcher, so this is mobile-only (the caller wraps it in `lg:hidden`).
export function MobileFloorTrigger({ onOpen }: { onOpen: () => void }) {
  const ctx = useOptionalBuildingContext()
  const { pathname } = useLocation()
  const floor = ctx?.activeFloor
  if (!ctx || !parseFloorPath(pathname).floorId || !floor) return null
  return (
    <button
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`Trocar andar. Andar atual: ${floor.name}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        // Alvo de toque: este controle é EXCLUSIVO do celular, onde o dedo é o
        // único ponteiro. Tinha 28px de altura — abaixo do mínimo, e num botão que
        // o usuário aperta o tempo todo para trocar de andar. O visual não muda: o
        // rótulo continua compacto, é a área tocável que cresce.
        minHeight: 'var(--hit-min, 44px)',
        maxWidth: '100%',
        padding: '2px 8px 2px 4px',
        marginLeft: -4,
        borderRadius: 999,
        border: 0,
        background: 'transparent',
        color: 'var(--text-muted)',
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: 3, background: floor.color ?? 'var(--accent, #6b5cff)', flexShrink: 0 }} />
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{floor.name}</span>
      <Icon name="chevron-down" size={14} color="currentColor" />
    </button>
  )
}
