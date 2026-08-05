import { useEffect, useState } from 'react'
import { API_URL } from '../lib/api'
import type { AgentBuiltinTool, BuiltinAppCatalog } from '../lib/types'
import { Modal } from './Modal'

const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500'

const APP_EMOJI: Record<string, string> = {
  google_calendar: '📅',
  google_sheets: '📊',
}

// Gallery of built-in integrations ("apps") the owner connects to the agent.
// Clicking Conectar/Configurar opens a popup with the app's per-agent config.
export function AgentAppsEditor({
  value,
  onChange,
}: {
  value: AgentBuiltinTool[]
  onChange: (tools: AgentBuiltinTool[]) => void
}) {
  const [apps, setApps] = useState<BuiltinAppCatalog[]>([])
  const [googleConnected, setGoogleConnected] = useState(false)
  const [loading, setLoading] = useState(true)

  const [configuring, setConfiguring] = useState<BuiltinAppCatalog | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/api/integrations`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body) return
        setApps(body.apps ?? [])
        setGoogleConnected(Boolean(body.google?.connected))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function openConfig(app: BuiltinAppCatalog) {
    setDraft({ ...(value.find((v) => v.key === app.key)?.config ?? {}) })
    setConfiguring(app)
  }

  function saveConfig() {
    if (!configuring) return
    const key = configuring.key
    const exists = value.some((v) => v.key === key)
    onChange(
      exists
        ? value.map((v) => (v.key === key ? { ...v, config: draft } : v))
        : [...value, { key, config: draft }],
    )
    setConfiguring(null)
  }

  if (loading) return <p className="text-sm text-slate-400">Carregando integrações...</p>
  if (apps.length === 0) return <p className="text-sm text-slate-500">Nenhuma integração disponível.</p>

  const canSave =
    !configuring ||
    configuring.configFields.every((f) => !f.required || (draft[f.key] ?? '').trim().length > 0)

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {apps.map((app) => {
        const enabled = value.some((v) => v.key === app.key)
        const needsGoogle = app.connection === 'google' && !googleConnected
        return (
          <div
            key={app.key}
            className={`flex flex-col rounded-xl border p-4 transition ${
              enabled ? 'border-slate-600 bg-slate-900' : 'border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 text-xl">
                {APP_EMOJI[app.key] ?? '🔌'}
              </div>
              {enabled && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                  Conectado
                </span>
              )}
            </div>
            <p className="mt-3 font-medium">{app.label}</p>
            <p className="mt-1 text-sm text-slate-400">{app.description}</p>
            {needsGoogle && (
              <p className="mt-1 text-xs text-slate-500">
                Conecte sua conta Google em Configurações → Integrações para usar.
              </p>
            )}

            <div className="mt-auto pt-4">
              {enabled ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openConfig(app)}
                    className="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-sm transition hover:bg-slate-800"
                  >
                    Configurar
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((v) => v.key !== app.key))}
                    className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-400 transition hover:bg-red-500/10"
                  >
                    Remover
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openConfig(app)}
                  className="w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                >
                  Conectar
                </button>
              )}
            </div>
          </div>
        )
      })}

      <Modal
        open={configuring !== null}
        onClose={() => setConfiguring(null)}
        title={configuring ? `Configurar ${configuring.label}` : 'Configurar'}
      >
        {configuring && (
          <div className="space-y-3">
            {configuring.connection === 'google' && !googleConnected && (
              <p className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-400">
                Esta integração só funciona depois de conectar sua conta Google em Configurações →
                Integrações.
              </p>
            )}
            {configuring.configFields.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhuma configuração necessária.</p>
            ) : (
              configuring.configFields.map((field) => (
                <div key={field.key}>
                  <label className="mb-1 block text-sm text-slate-400">
                    {field.label}
                    {field.required && <span className="text-red-400"> *</span>}
                  </label>
                  <input
                    value={draft[field.key] ?? ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className={inputClass}
                  />
                </div>
              ))
            )}
            <button
              type="button"
              onClick={saveConfig}
              disabled={!canSave}
              className="w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
            >
              {value.some((v) => v.key === configuring.key) ? 'Salvar' : 'Conectar'}
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
