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
          // `outline: none` sem nada no lugar era foco invisível: com o teclado não dava
          // para saber onde se está, e com o mouse o campo não reagia ao clique. O
          // tratamento é o mesmo do Input — o sistema já tem anel de foco.
          outline: 'none',
          cursor: 'pointer',
          transition: 'border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard)',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-focus)'
          e.currentTarget.style.boxShadow = 'var(--ring-focus)'
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-subtle)'
          e.currentTarget.style.boxShadow = 'none'
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
