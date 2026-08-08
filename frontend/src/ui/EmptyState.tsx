import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './Icon'

interface EmptyStateProps {
  icon?: string
  title?: ReactNode
  body?: ReactNode
  action?: ReactNode
  style?: CSSProperties
}

// The design also supports an illustration slot (slotId/art via <Illustration>);
// that arrives with the office illustration set in Phase 4. Icon fallback for now.
export function EmptyState({ icon = 'coffee', title, body, action, style }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        padding: '40px 24px',
        textAlign: 'center',
        borderRadius: 'var(--radius-card)',
        border: '2px dashed var(--border-strong)',
        background: 'var(--surface-card)',
        ...style,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 52,
          height: 52,
          borderRadius: 'var(--radius-full)',
          background: 'var(--intent-brand-soft)',
        }}
      >
        <Icon name={icon} size={24} color="var(--intent-brand)" />
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: 'var(--text-heading)' }}>
        {title}
      </span>
      {body ? <span style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 380 }}>{body}</span> : null}
      {action ? <span style={{ marginTop: 6 }}>{action}</span> : null}
    </div>
  )
}
