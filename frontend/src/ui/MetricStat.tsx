import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './Icon'

interface MetricStatProps {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  delta?: ReactNode
  deltaTone?: 'success' | 'danger' | 'muted'
  icon?: string
  style?: CSSProperties
}

export function MetricStat({ label, value, unit, delta, deltaTone = 'success', icon, style }: MetricStatProps) {
  const tone =
    deltaTone === 'success' ? 'var(--mint-600)' : deltaTone === 'danger' ? 'var(--coral-600)' : 'var(--text-muted)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
        }}
      >
        {icon ? <Icon name={icon} size={13} /> : null}
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: '-.02em',
            color: 'var(--text-heading)',
          }}
        >
          {value}
        </span>
        {unit ? <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{unit}</span> : null}
        {delta ? <span style={{ fontSize: 12.5, fontWeight: 700, color: tone }}>{delta}</span> : null}
      </span>
    </div>
  )
}
