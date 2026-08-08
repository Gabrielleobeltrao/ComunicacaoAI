import type { CSSProperties } from 'react'

export type AgentStatus = 'working' | 'thinking' | 'idle' | 'break' | 'blocked' | 'calling'

const MAP: Record<AgentStatus, [string, string, string]> = {
  working: ['Trabalhando', 'var(--status-working)', 'var(--mint-50)'],
  thinking: ['Pensando', 'var(--status-thinking)', 'var(--mango-50)'],
  idle: ['Ocioso', 'var(--status-idle)', 'var(--surface-sunken)'],
  break: ['Em pausa', 'var(--status-break)', 'var(--sky-50)'],
  blocked: ['Bloqueado', 'var(--status-blocked)', 'var(--coral-50)'],
  calling: ['Em ligação', 'var(--status-working)', 'var(--mint-50)'],
}

interface StatusPillProps {
  status?: AgentStatus
  label?: string
  pulse?: boolean
  style?: CSSProperties
}

export function StatusPill({ status = 'idle', label, pulse = true, style }: StatusPillProps) {
  const [text, color, bg] = MAP[status]
  const live = status === 'working' || status === 'thinking' || status === 'calling'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        height: 26,
        padding: '0 11px',
        borderRadius: 'var(--radius-full)',
        background: bg,
        color,
        fontFamily: 'var(--font-ui)',
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 'var(--radius-full)',
          background: color,
          animation: pulse && live ? 'ds-pulse var(--dur-ambient) var(--ease-standard) infinite' : 'none',
        }}
      />
      {label || text}
    </span>
  )
}
