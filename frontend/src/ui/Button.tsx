import { useState } from 'react'
import type { ButtonHTMLAttributes, CSSProperties } from 'react'
import { Icon } from './Icon'

type Variant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const sizes: Record<Size, { height: number; padding: string; font: number; gap: number; radius: string }> = {
  sm: { height: 34, padding: '0 14px', font: 13, gap: 6, radius: 'var(--radius-sm)' },
  md: { height: 42, padding: '0 18px', font: 14.5, gap: 8, radius: 'var(--radius-control)' },
  lg: { height: 52, padding: '0 26px', font: 16, gap: 10, radius: 'var(--radius-md)' },
}

const variants: Record<Variant, CSSProperties> = {
  primary: { background: 'var(--intent-brand)', color: 'var(--text-on-brand)', border: '1px solid transparent', boxShadow: 'var(--shadow-brand)' },
  secondary: { background: 'var(--surface-card)', color: 'var(--text-heading)', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-flat)' },
  ghost: { background: 'transparent', color: 'var(--text-body)', border: '1px solid transparent', boxShadow: 'none' },
  soft: { background: 'var(--intent-brand-soft)', color: 'var(--cobalt-700)', border: '1px solid transparent', boxShadow: 'none' },
  danger: { background: 'var(--intent-danger)', color: '#fff', border: '1px solid transparent', boxShadow: '0 8px 20px -8px rgba(255,106,91,.55)' },
}

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  variant?: Variant
  size?: Size
  icon?: string
  iconRight?: string
  block?: boolean
  style?: CSSProperties
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  block,
  disabled,
  style,
  className,
  ...rest
}: ButtonProps) {
  const s = sizes[size]
  const [pressed, setPressed] = useState(false)
  const iconSize = size === 'sm' ? 15 : 17
  return (
    <button
      disabled={disabled}
      onMouseDown={() => !disabled && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        display: block ? 'flex' : 'inline-flex',
        width: block ? '100%' : undefined,
        alignItems: 'center',
        justifyContent: 'center',
        gap: s.gap,
        height: s.height,
        padding: s.padding,
        borderRadius: s.radius,
        fontFamily: 'var(--font-ui)',
        fontSize: s.font,
        fontWeight: 700,
        letterSpacing: '-.01em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transform: pressed ? 'scale(var(--press-scale))' : 'none',
        transition:
          'transform var(--dur-fast) var(--ease-bounce), background var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard)',
        ...variants[variant],
        ...style,
      }}
      className={['ds-hit', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={iconSize} /> : null}
    </button>
  )
}
