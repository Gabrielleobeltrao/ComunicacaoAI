import type { CSSProperties, ReactNode } from 'react'

interface TopbarProps {
  title?: ReactNode
  subtitle?: ReactNode
  children?: ReactNode
  style?: CSSProperties
}

export function Topbar({ title, subtitle, children, style }: TopbarProps) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        height: 'var(--topbar-height)',
        padding: '0 var(--gutter-screen)',
        background: 'rgba(255,255,255,.82)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-subtle)',
        position: 'sticky',
        top: 0,
        zIndex: 20,
        ...style,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: '-.015em',
            color: 'var(--text-heading)',
          }}
        >
          {title}
        </span>
        {subtitle ? <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{subtitle}</span> : null}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{children}</div>
    </header>
  )
}

// Lettermark: the wordmark's own capital T in the display face, knocked out of a
// cobalt tile — no drawn symbol. Pass mark={false} for the type alone.
export function Brand({ size = 20, mark = true, style }: { size?: number; mark?: boolean; style?: CSSProperties }) {
  const box = Math.round(size * 1.6)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: mark ? Math.round(size * 0.42) : 0, ...style }}>
      {mark ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: box,
            height: box,
            borderRadius: '26%',
            background: 'var(--intent-brand)',
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            fontSize: Math.round(box * 0.68),
            lineHeight: 1,
            color: '#fff',
            flex: '0 0 auto',
          }}
        >
          T
        </span>
      ) : null}
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 900,
          fontSize: size,
          letterSpacing: '-.03em',
          color: 'var(--text-heading)',
        }}
      >
        Tavorium
      </span>
    </span>
  )
}
