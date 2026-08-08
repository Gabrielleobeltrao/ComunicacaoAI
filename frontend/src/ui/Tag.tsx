import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { Icon } from './Icon'

interface TagProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'style' | 'color'> {
  children?: ReactNode
  color?: string
  icon?: string
  onRemove?: () => void
  style?: CSSProperties
}

export function Tag({ children, color = 'var(--text-muted)', icon, onRemove, style, ...rest }: TagProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 28,
        padding: onRemove ? '0 6px 0 10px' : '0 10px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-body)',
        fontFamily: 'var(--font-ui)',
        fontSize: 12.5,
        fontWeight: 600,
        ...style,
      }}
      {...rest}
    >
      <span style={{ width: 6, height: 6, borderRadius: 'var(--radius-full)', background: color, flex: '0 0 auto' }} />
      {icon ? <Icon name={icon} size={13} color="var(--text-muted)" /> : null}
      {children}
      {onRemove ? (
        <button
          onClick={onRemove}
          aria-label="Remover"
          style={{ display: 'inline-flex', border: 0, background: 'transparent', padding: 4, cursor: 'pointer', color: 'var(--text-faint)' }}
        >
          <Icon name="x" size={12} />
        </button>
      ) : null}
    </span>
  )
}
