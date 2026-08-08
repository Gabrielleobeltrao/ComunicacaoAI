import type { CSSProperties } from 'react'
import { Icon } from '../ui'
import type { AgentStatus } from '../ui'

const STATUS: Record<string, string> = {
  working: 'var(--status-working)',
  thinking: 'var(--status-thinking)',
  idle: 'var(--status-idle)',
  break: 'var(--status-break)',
  blocked: 'var(--status-blocked)',
  calling: 'var(--status-working)',
}

interface NamePillProps {
  name: string
  status?: AgentStatus
  icon?: string
  tone?: 'dark' | 'light'
  style?: CSSProperties
}

export function NamePill({ name, status = 'idle', icon, tone = 'dark', style }: NamePillProps) {
  const dark = tone === 'dark'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 26,
        padding: '0 11px',
        borderRadius: 'var(--radius-full)',
        background: dark ? 'var(--ink-1)' : 'rgba(255,255,255,.86)',
        color: dark ? '#fff' : 'var(--text-body)',
        boxShadow: dark ? '0 3px 8px rgba(22,24,31,.28)' : '0 2px 6px rgba(22,24,31,.14)',
        fontFamily: 'var(--font-ui)',
        fontSize: 12.5,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        backdropFilter: dark ? undefined : 'blur(6px)',
        ...style,
      }}
    >
      {icon ? (
        <Icon name={icon} size={13} />
      ) : (
        <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-full)', background: STATUS[status] ?? STATUS.idle }} />
      )}
      {name}
    </span>
  )
}
