import { useState } from 'react'
import type { ReactNode } from 'react'

// Um bloco que abre e fecha.
//
// Vivia dentro do AgentForm e servia só à aba Avançado. Saiu para cá porque a aba "Como
// trabalha" cresceu — competências, ferramentas, conhecimento, sites — e uma pilha de
// cartões sempre abertos obriga a rolar para descobrir o que existe. Fechado, o título
// vira índice; o `hint` é o que evita que fechar signifique esconder.

export function CollapsibleBlock({
  title,
  showHeader,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string
  showHeader: boolean
  /** Uma palavra ao lado do título — quantos, quais — para o estado fechado ainda informar. */
  hint?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!showHeader) return <>{children}</>
  return (
    <div className="border-t border-(--border-subtle) first:border-t-0" data-testid="collapsible-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        // O rótulo é o TÍTULO, sozinho. Sem ele, o nome acessível do botão inclui a
        // setinha e o resumo, e quem procura o cabeçalho pelo nome não o encontra.
        aria-label={title}
        className="flex w-full items-center justify-between gap-2 py-3 text-left text-(--text-body) transition hover:text-(--text-heading)"
      >
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{title}</span>
          {hint ? <span className="text-xs text-(--text-faint)">{hint}</span> : null}
        </span>
        <span className={`text-(--text-faint) transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      <div className={open ? 'space-y-3 pb-3' : 'hidden'}>{children}</div>
    </div>
  )
}
