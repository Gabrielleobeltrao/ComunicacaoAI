import type { CSSProperties, InputHTMLAttributes } from 'react'
import { Icon } from './Icon'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'style'> {
  icon?: string
  invalid?: boolean
  // Applied to the wrapper (matches the design's Input API).
  style?: CSSProperties
}

export function Input({ icon, invalid, style, ...rest }: InputProps) {
  return (
    <span style={{ position: 'relative', display: 'block', ...style }}>
      {icon ? (
        <Icon name={icon} size={16} color="var(--text-faint)" style={{ position: 'absolute', left: 13, top: 13 }} />
      ) : null}
      <input
        style={{
          width: '100%',
          height: 42,
          padding: icon ? '0 14px 0 38px' : '0 14px',
          borderRadius: 'var(--radius-control)',
          background: 'var(--surface-card)',
          border: `1px solid ${invalid ? 'var(--intent-danger)' : 'var(--border-subtle)'}`,
          fontFamily: 'var(--font-ui)',
          fontSize: 14.5,
          color: 'var(--text-heading)',
          outline: 'none',
          transition: 'border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard)',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-focus)'
          e.currentTarget.style.boxShadow = 'var(--ring-focus)'
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = invalid ? 'var(--intent-danger)' : 'var(--border-subtle)'
          e.currentTarget.style.boxShadow = 'none'
        }}
        {...rest}
      />
    </span>
  )
}
