import type { CSSProperties, ReactNode } from 'react'

interface ProgressBarProps {
  value?: number
  color?: string
  height?: number
  label?: ReactNode
  hint?: ReactNode
  style?: CSSProperties
}

export function ProgressBar({ value = 0, color = 'var(--intent-brand)', height = 8, label, hint, style }: ProgressBarProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label || hint ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ fontWeight: 700, color: 'var(--text-heading)' }}>{label}</span>
          <span style={{ color: 'var(--text-muted)' }}>{hint}</span>
        </div>
      ) : null}
      <div style={{ height, borderRadius: 'var(--radius-full)', background: 'var(--surface-sunken)', overflow: 'hidden' }}>
        <div
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            height: '100%',
            borderRadius: 'var(--radius-full)',
            background: color,
            transition: 'width var(--dur-slow) var(--ease-out-soft)',
          }}
        />
      </div>
    </div>
  )
}
