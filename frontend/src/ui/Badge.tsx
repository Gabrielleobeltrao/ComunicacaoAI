import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { Icon } from './Icon'

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'creative'
const tones: Record<Tone, [string, string]> = {
  neutral: ['var(--surface-sunken)', 'var(--text-body)'],
  brand: ['var(--intent-brand-soft)', 'var(--cobalt-700)'],
  success: ['var(--intent-success-soft)', 'var(--mint-600)'],
  warning: ['var(--intent-warning-soft)', 'var(--mango-600)'],
  danger: ['var(--intent-danger-soft)', 'var(--coral-600)'],
  creative: ['var(--intent-creative-soft)', 'var(--grape-600)'],
}

interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'style'> {
  children?: ReactNode
  tone?: Tone
  icon?: string
  solid?: boolean
  style?: CSSProperties
}

export function Badge({ children, tone = 'neutral', icon, solid, style, ...rest }: BadgeProps) {
  const [bg, fg] = tones[tone]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 24,
        padding: '0 10px',
        borderRadius: 'var(--radius-full)',
        background: solid ? fg : bg,
        color: solid ? '#fff' : fg,
        fontFamily: 'var(--font-ui)',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '-.005em',
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  )
}
