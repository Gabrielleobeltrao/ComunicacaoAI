import type { CSSProperties } from 'react'
import type { Floor } from '../lib/floors'

// Accessible floor selector ("elevador"). A native <select> gives keyboard and
// screen-reader support for free and collapses naturally on mobile — navigation
// never depends on animation (plan §14.4).
interface ElevatorProps {
  floors: Floor[]
  activeFloorId: string | null
  onSelect: (floorId: string) => void
  style?: CSSProperties
}

export function Elevator({ floors, activeFloorId, onSelect, style }: ElevatorProps) {
  if (floors.length === 0) return null
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 14,
        color: 'var(--text-1, inherit)',
        ...style,
      }}
    >
      <span style={{ fontWeight: 600 }}>Andar</span>
      <select
        aria-label="Selecionar andar"
        value={activeFloorId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        style={{
          padding: '6px 10px',
          borderRadius: 'var(--radius-field, 8px)',
          border: '1px solid var(--border-1, #d0d5dd)',
          background: 'var(--paper-0, #fff)',
          color: 'inherit',
          font: 'inherit',
          maxWidth: 220,
        }}
      >
        {floors.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
            {f.status === 'archived' ? ' (arquivado)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
