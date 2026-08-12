import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useDialogA11y } from '../ui/useDialogA11y'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
}

export function Modal({ open, onClose, title, children, wide }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogA11y(open, onClose, panelRef)
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      style={{ padding: 'max(env(safe-area-inset-top,0px), 16px) 16px max(env(safe-area-inset-bottom,0px), 16px)' }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={`flex w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90dvh] flex-col overflow-hidden rounded-xl border border-(--border-subtle) bg-(--surface-card) outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-(--border-subtle) px-6 py-4">
          <h3 className="min-w-0 truncate font-medium text-(--text-heading)">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="grid shrink-0 place-items-center rounded-md text-(--text-muted) transition hover:text-(--text-heading)"
            style={{ width: 'var(--hit-min)', height: 'var(--hit-min)', marginRight: -8 }}
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  )
}
