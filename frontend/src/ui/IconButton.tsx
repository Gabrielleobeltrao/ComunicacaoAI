import { useState } from 'react'
import type { ButtonHTMLAttributes, CSSProperties } from 'react'
import { Icon } from './Icon'

type Size = 'sm' | 'md' | 'lg'
type Variant = 'ghost' | 'soft' | 'card'
const sizes: Record<Size, number> = { sm: 32, md: 40, lg: 48 }
const bgFor: Record<Variant, string> = {
  ghost: 'transparent',
  soft: 'var(--surface-sunken)',
  card: 'var(--surface-card)',
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  icon: string
  size?: Size
  variant?: Variant
  label?: string
  style?: CSSProperties
}

export function IconButton({ icon, size = 'md', variant = 'ghost', label, style, ...rest }: IconButtonProps) {
  const d = sizes[size]
  const bg = bgFor[variant]
  const [hover, setHover] = useState(false)
  return (
    <button
      aria-label={label}
      title={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: d,
        height: d,
        borderRadius: 'var(--radius-sm)',
        background: hover ? 'var(--surface-sunken)' : bg,
        border: variant === 'card' ? '1px solid var(--border-subtle)' : '1px solid transparent',
        color: hover ? 'var(--text-heading)' : 'var(--text-muted)',
        cursor: 'pointer',
        transition: 'background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)',
        ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={d < 36 ? 16 : 18} />
    </button>
  )
}
