import type { CSSProperties } from 'react'
import { Icon } from './Icon'

interface CheckboxProps {
  checked?: boolean
  label?: string
  onChange?: (checked: boolean) => void
  disabled?: boolean
  style?: CSSProperties
}

// A real (visually-hidden) native checkbox drives state, so it's keyboard-operable
// and announced by screen readers; the styled box is the visual stand-in and shows
// a focus ring when the input is focused via keyboard.
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
      <input
        type="checkbox"
        className="peer sr-only"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="peer-focus-visible:ring-2 peer-focus-visible:ring-(--intent-brand) peer-focus-visible:ring-offset-1"
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
