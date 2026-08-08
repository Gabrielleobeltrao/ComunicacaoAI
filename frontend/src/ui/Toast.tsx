import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './Icon'

type Tone = 'success' | 'info' | 'warning' | 'danger'
const TONES: Record<Tone, [string, string]> = {
  success: ['circle-check', 'var(--mint-600)'],
  info: ['info', 'var(--cobalt-600)'],
  warning: ['triangle-alert', 'var(--mango-600)'],
  danger: ['circle-alert', 'var(--coral-600)'],
}

interface ToastProps {
  tone?: Tone
  title?: ReactNode
  body?: ReactNode
  onDismiss?: () => void
  style?: CSSProperties
}

export function Toast({ tone = 'info', title, body, onDismiss, style }: ToastProps) {
  const [icon, color] = TONES[tone]
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 11,
        width: 340,
        padding: 14,
        borderRadius: 'var(--radius-md)',
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-pop)',
        ...style,
      }}
    >
      <Icon name={icon} size={19} color={color} style={{ marginTop: 1 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700, color: 'var(--text-heading)' }}>
          {title}
        </span>
        {body ? <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{body}</span> : null}
      </div>
      {onDismiss ? (
        <button
          onClick={onDismiss}
          aria-label="Fechar"
          style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-faint)', padding: 2 }}
        >
          <Icon name="x" size={15} />
        </button>
      ) : null}
    </div>
  )
}
