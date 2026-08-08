import type { CSSProperties, ReactNode } from 'react'

interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  htmlFor?: string
  children?: ReactNode
  style?: CSSProperties
}

export function Field({ label, hint, error, htmlFor, children, style }: FieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label ? (
        <label
          htmlFor={htmlFor}
          style={{ fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 700, color: 'var(--text-heading)', letterSpacing: '-.005em' }}
        >
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--coral-600)' }}>{error}</span>
      ) : hint ? (
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{hint}</span>
      ) : null}
    </div>
  )
}
