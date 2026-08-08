import type { CSSProperties } from 'react'

interface SwitchProps {
  checked?: boolean
  onChange?: (checked: boolean) => void
  label?: string
  disabled?: boolean
  style?: CSSProperties
}

export function Switch({ checked, onChange, label, disabled, style }: SwitchProps) {
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
          position: 'relative',
          width: 42,
          height: 24,
          borderRadius: 'var(--radius-full)',
          background: checked ? 'var(--intent-success)' : 'var(--paper-3)',
          transition: 'background var(--dur-base) var(--ease-standard)',
          flex: '0 0 auto',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 21 : 3,
            width: 18,
            height: 18,
            borderRadius: 'var(--radius-full)',
            background: '#fff',
            boxShadow: 'var(--shadow-card)',
            transition: 'left var(--dur-base) var(--ease-bounce)',
          }}
        />
      </span>
      {label ? <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-body)' }}>{label}</span> : null}
    </label>
  )
}
