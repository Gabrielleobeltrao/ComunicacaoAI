// A destructive-action panel shown at the bottom of an entity's general
// settings (delete the agent/sector).
export function DangerZone({
  title,
  description,
  buttonLabel,
  onDelete,
  deleting,
  deleteError,
}: {
  title: string
  description: string
  buttonLabel: string
  onDelete: () => void
  deleting: boolean
  deleteError: string | null
}) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-medium text-(--text-muted)">Zona de perigo</h3>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-(--coral-500) bg-(--coral-50) p-4">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-(--text-muted)">{description}</p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="shrink-0 rounded-lg border border-(--coral-500) px-3 py-1.5 text-sm text-(--coral-600) transition hover:bg-(--coral-50) disabled:opacity-50"
        >
          {deleting ? 'Excluindo...' : buttonLabel}
        </button>
      </div>
      {deleteError && <p className="mt-2 text-sm text-(--coral-600)">{deleteError}</p>}
    </section>
  )
}
