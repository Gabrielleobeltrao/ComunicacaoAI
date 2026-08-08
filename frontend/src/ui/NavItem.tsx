import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './Icon'

interface NavItemProps {
  icon?: string
  label: ReactNode
  active?: boolean
  count?: number | null
  accent?: string
  onClick?: () => void
  style?: CSSProperties
}

export function NavItem({ icon, label, active, count, accent, onClick, style }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--surface-sunken)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        height: 40,
        padding: '0 12px',
        borderRadius: 'var(--radius-control)',
        border: 0,
        background: active ? 'var(--intent-brand-soft)' : 'transparent',
        color: active ? 'var(--cobalt-700)' : 'var(--text-body)',
        fontFamily: 'var(--font-ui)',
        fontSize: 14,
        fontWeight: active ? 700 : 600,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background var(--dur-fast) var(--ease-standard)',
        ...style,
      }}
    >
      {accent ? (
        <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-full)', background: accent, flex: '0 0 auto' }} />
      ) : icon ? (
        <Icon name={icon} size={17} />
      ) : null}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {count != null ? <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-faint)' }}>{count}</span> : null}
    </button>
  )
}
