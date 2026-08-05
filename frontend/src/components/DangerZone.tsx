// A destructive-action panel shown at the bottom of an entity's general
// settings (delete the agent/team).
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
      <h3 className="mb-3 text-sm font-medium text-slate-400">Zona de perigo</h3>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-slate-400">{description}</p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="shrink-0 rounded-lg border border-red-500/40 px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
        >
          {deleting ? 'Excluindo...' : buttonLabel}
        </button>
      </div>
      {deleteError && <p className="mt-2 text-sm text-red-400">{deleteError}</p>}
    </section>
  )
}
