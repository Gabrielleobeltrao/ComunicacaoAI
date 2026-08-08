import type { CSSProperties, ReactNode, SelectHTMLAttributes } from 'react'
import { Icon } from './Icon'

type Option = string | { value: string; label: string }

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'style'> {
  // Either a flat options list (design API) or full <option>/<optgroup> children.
  options?: Option[]
  children?: ReactNode
  style?: CSSProperties
}

export function Select({ options = [], children, style, ...rest }: SelectProps) {
  return (
    <span style={{ position: 'relative', display: 'block', ...style }}>
      <select
        style={{
          width: '100%',
          height: 42,
          padding: '0 38px 0 14px',
          appearance: 'none',
          borderRadius: 'var(--radius-control)',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-ui)',
          fontSize: 14.5,
          color: 'var(--text-heading)',
          outline: 'none',
          cursor: 'pointer',
        }}
        {...rest}
      >
        {children ??
          options.map((o) => {
            const value = typeof o === 'string' ? o : o.value
            const label = typeof o === 'string' ? o : o.label
            return (
              <option key={value} value={value}>
                {label}
              </option>
            )
          })}
      </select>
      <Icon
        name="chevron-down"
        size={16}
        color="var(--text-muted)"
        style={{ position: 'absolute', right: 13, top: 13, pointerEvents: 'none' }}
      />
    </span>
  )
}
