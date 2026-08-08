import type { CSSProperties } from 'react'

type Tab = string | { value: string; label: string }

interface TabsProps {
  tabs?: Tab[]
  value?: string
  onChange?: (value: string) => void
  style?: CSSProperties
}

export function Tabs({ tabs = [], value, onChange, style }: TabsProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: 4,
        borderRadius: 'var(--radius-control)',
        background: 'var(--surface-sunken)',
        ...style,
      }}
    >
      {tabs.map((t) => {
        const key = typeof t === 'string' ? t : t.value
        const label = typeof t === 'string' ? t : t.label
        const active = key === value
        return (
          <button
            key={key}
            onClick={() => onChange?.(key)}
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 'var(--radius-xs)',
              border: 0,
              background: active ? 'var(--surface-card)' : 'transparent',
              boxShadow: active ? 'var(--shadow-flat)' : 'none',
              color: active ? 'var(--text-heading)' : 'var(--text-muted)',
              fontFamily: 'var(--font-ui)',
              fontSize: 13.5,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all var(--dur-fast) var(--ease-standard)',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
