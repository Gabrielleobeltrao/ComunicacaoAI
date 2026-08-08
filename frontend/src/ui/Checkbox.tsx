import type { CSSProperties } from 'react'
import { Icon } from './Icon'

interface CheckboxProps {
  checked?: boolean
  label?: string
  onChange?: (checked: boolean) => void
  disabled?: boolean
  style?: CSSProperties
}

export function Checkbox({ checked, label, onChange, disabled, style }: CheckboxProps) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      <span
        onClick={() => !disabled && onChange?.(!checked)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          borderRadius: 'var(--radius-xs)',
          background: checked ? 'var(--intent-brand)' : 'var(--surface-card)',
          border: `1px solid ${checked ? 'var(--intent-brand)' : 'var(--border-strong)'}`,
          transition: 'all var(--dur-fast) var(--ease-bounce)',
        }}
      >
        {checked ? <Icon name="check" size={13} color="#fff" /> : null}
      </span>
      {label ? <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-body)' }}>{label}</span> : null}
    </label>
  )
}
