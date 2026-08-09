import type { CSSProperties } from 'react'
import type { AgentStatus } from './StatusPill'

const STATUS: Record<string, string> = {
  working: 'var(--status-working)',
  thinking: 'var(--status-thinking)',
  idle: 'var(--status-idle)',
  break: 'var(--status-break)',
  blocked: 'var(--status-blocked)',
  calling: 'var(--status-working)',
}
const SIZES = { xs: 24, sm: 32, md: 44, lg: 64, xl: 96 } as const
type Size = keyof typeof SIZES

interface AgentAvatarProps {
  name?: string
  src?: string
  color?: string
  size?: Size
  status?: AgentStatus
  style?: CSSProperties
}

// A round agent avatar: the character portrait (or initials) in a coloured ring,
// with an optional status dot. Mirrors the design's AgentAvatar.
export function AgentAvatar({ name = '', src, color = 'var(--dept-dev)', size = 'md', status, style }: AgentAvatarProps) {
  const d = SIZES[size] ?? SIZES.md
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  const dot = d >= 44 ? 13 : 10
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: d, height: d, flex: '0 0 auto', ...style }}>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: d,
          height: d,
          borderRadius: 'var(--radius-avatar)',
          overflow: 'hidden',
          background: src ? 'var(--surface-sunken)' : `color-mix(in oklab, ${color} 18%, white)`,
          border: `2px solid ${color}`,
          color,
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: d * 0.36,
          letterSpacing: '-.02em',
        }}
      >
        {src ? (
          <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 15%' }} />
        ) : (
          initials
        )}
      </span>
      {status ? (
        <span
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: dot,
            height: dot,
            borderRadius: 'var(--radius-full)',
            background: STATUS[status] ?? STATUS.idle,
            border: '2px solid var(--surface-card)',
          }}
        />
      ) : null}
    </span>
  )
}
