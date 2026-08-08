import { useState } from 'react'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

type Tone = 'default' | 'sunken' | 'outline'

const tones: Record<Tone, CSSProperties> = {
  default: { background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' },
  sunken: { background: 'var(--surface-sunken)', border: '1px solid transparent' },
  outline: { background: 'transparent', border: '1px dashed var(--border-strong)' },
}

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style'> {
  children?: ReactNode
  padding?: string
  tone?: Tone
  interactive?: boolean
  accent?: string
  style?: CSSProperties
}

export function Card({
  children,
  padding = 'var(--gutter-card)',
  tone = 'default',
  interactive,
  accent,
  style,
  ...rest
}: CardProps) {
  const [hover, setHover] = useState(false)
  const lifted = interactive && hover
  return (
    <div
      onMouseEnter={interactive ? () => setHover(true) : undefined}
      onMouseLeave={interactive ? () => setHover(false) : undefined}
      style={{
        borderRadius: 'var(--radius-card)',
        padding,
        boxShadow: tone !== 'default' ? 'none' : lifted ? 'var(--shadow-raised)' : 'var(--shadow-card)',
        borderTop: accent ? `3px solid ${accent}` : undefined,
        transform: lifted ? 'translateY(var(--hover-lift))' : 'none',
        transition:
          'transform var(--dur-base) var(--ease-out-soft), box-shadow var(--dur-base) var(--ease-out-soft)',
        cursor: interactive ? 'pointer' : undefined,
        ...tones[tone],
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  )
}
