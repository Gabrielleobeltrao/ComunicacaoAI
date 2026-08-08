import type { CSSProperties, ReactNode } from 'react'
import { IconButton } from './IconButton'

interface DialogProps {
  open?: boolean
  title?: ReactNode
  subtitle?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: number
  onClose?: () => void
  style?: CSSProperties
}

export function Dialog({ open = true, title, subtitle, children, footer, width = 480, onClose, style }: DialogProps) {
  if (!open) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface-overlay)',
        backdropFilter: 'blur(3px)',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          background: 'var(--surface-card)',
          borderRadius: 'var(--radius-panel)',
          boxShadow: 'var(--shadow-pop)',
          ...style,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '22px 22px 0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 20,
                fontWeight: 800,
                letterSpacing: '-.018em',
                color: 'var(--text-heading)',
              }}
            >
              {title}
            </span>
            {subtitle ? <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{subtitle}</span> : null}
          </div>
          {onClose ? <IconButton icon="x" label="Fechar" size="sm" onClick={onClose} /> : null}
        </div>
        <div style={{ padding: '18px 22px' }}>{children}</div>
        {footer ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
              padding: '16px 22px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--surface-app)',
              borderRadius: '0 0 var(--radius-panel) var(--radius-panel)',
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
