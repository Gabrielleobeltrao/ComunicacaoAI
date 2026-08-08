import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

interface TooltipProps {
  label: ReactNode
  children: ReactNode
  placement?: 'top' | 'bottom'
  style?: CSSProperties
}

export function Tooltip({ label, children, placement = 'top', style }: TooltipProps) {
  const [show, setShow] = useState(false)
  const pos: CSSProperties =
    placement === 'top'
      ? { bottom: '100%', left: '50%', transform: 'translate(-50%,-8px)' }
      : { top: '100%', left: '50%', transform: 'translate(-50%,8px)' }
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', ...style }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show ? (
        <span
          style={{
            position: 'absolute',
            ...pos,
            zIndex: 50,
            padding: '6px 10px',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--ink-1)',
            color: '#fff',
            fontFamily: 'var(--font-ui)',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow-raised)',
            pointerEvents: 'none',
          }}
        >
          {label}
        </span>
      ) : null}
    </span>
  )
}
