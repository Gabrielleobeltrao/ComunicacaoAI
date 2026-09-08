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
        // Cinco abas não cabem em 390 px. Sem isto a última era CORTADA na borda e não
        // havia como chegar nela: `display: flex` sem `overflow` não rola, só transborda,
        // e o corte fica invisível para quem não sabe que existe uma sexta aba.
        overflowX: 'auto',
        // Num pai flex/grid o `min-width: auto` deixa a fileira empurrar a página inteira
        // em vez de rolar dentro de si.
        minWidth: 0,
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
            // `ds-hit` só vale sob ponteiro grosso, e `min-height` vence `height`: no
            // desktop a aba continua com 32, no celular vira alvo de 44.
            className="ds-hit"
            style={{
              height: 32,
              // `overflow-x` no pai não adianta se o filho ENCOLHE: sem estes dois o flex
              // espremia cada aba abaixo do próprio texto e "Histórico" virava "Histó" —
              // dentro da tela, sem rolagem nenhuma, e ilegível.
              whiteSpace: 'nowrap',
              flex: '0 0 auto',
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
