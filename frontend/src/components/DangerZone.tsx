import { useEffect, useRef, useState } from 'react'
import { Button, Dialog } from '../ui'

// The destructive-action panel, and the confirmation that stands in front of it.
//
// Deleting is not a click. It opens a dialog that names the thing being deleted and
// only enables the destructive button once the owner has typed that name exactly.
// Cancel is the safe default and the focused control; the destructive button is never
// primary and never receives focus automatically. A failure keeps the owner on the
// page with a readable message — it never navigates away from a delete that did not
// happen.

export function DangerZone({
  title,
  description,
  buttonLabel,
  // The exact text the owner must type. When absent, the dialog only asks to confirm.
  confirmName,
  consequences,
  onDelete,
  deleting,
  deleteError,
}: {
  title: string
  description: string
  buttonLabel: string
  confirmName?: string
  consequences?: string[]
  onDelete: () => void
  deleting: boolean
  deleteError: string | null
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)
  const wasDeleting = useRef(false)

  useEffect(() => {
    if (!open) return
    setTyped('')
    // Focus lands on the safe option, never on the destructive one.
    const timer = setTimeout(() => cancelRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  // A failed delete keeps the dialog open with the error; a successful one unmounts
  // with the page, so there is nothing to close.
  useEffect(() => {
    if (wasDeleting.current && !deleting && deleteError) setTyped('')
    wasDeleting.current = deleting
  }, [deleting, deleteError])

  const matches = !confirmName || typed.trim() === confirmName
  const canDelete = matches && !deleting

  return (
    <section data-testid="danger-zone">
      <h3 className="mb-3 text-sm font-medium text-(--text-muted)">Zona de perigo</h3>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-(--coral-500) bg-(--coral-50) p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-(--text-muted)">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={deleting}
          data-testid="danger-open"
          className="shrink-0 rounded-lg border border-(--coral-500) px-3 py-1.5 text-sm text-(--coral-600) transition hover:bg-(--coral-50) disabled:opacity-50"
        >
          {deleting ? 'Excluindo...' : buttonLabel}
        </button>
      </div>
      {deleteError && !open && <p className="mt-2 text-sm text-(--coral-600)">{deleteError}</p>}

      <Dialog open={open} onClose={() => (deleting ? undefined : setOpen(false))} title={title} width={520}>
        <div style={{ display: 'grid', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>{description}</p>
          {consequences && consequences.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              {consequences.map((c) => (
                <li key={c} style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                  {c}
                </li>
              ))}
            </ul>
          ) : null}

          {confirmName ? (
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Para confirmar, digite <strong style={{ color: 'var(--text-heading)' }}>{confirmName}</strong>
              </span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                aria-label={`Digite ${confirmName} para confirmar`}
                data-testid="danger-confirm-name"
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              />
            </label>
          ) : null}

          {deleteError ? (
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--coral-600, #d92d20)' }} data-testid="danger-error">
              {deleteError}
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button ref={cancelRef} variant="secondary" onClick={() => setOpen(false)} disabled={deleting} data-testid="danger-cancel">
              Cancelar
            </Button>
            <button
              type="button"
              onClick={onDelete}
              disabled={!canDelete}
              data-testid="danger-confirm"
              className="rounded-lg border border-(--coral-500) px-3 py-2 text-sm text-(--coral-600) transition hover:bg-(--coral-50) disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? 'Excluindo...' : buttonLabel}
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  )
}
