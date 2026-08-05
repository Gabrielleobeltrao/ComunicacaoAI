import { useEffect, useState } from 'react'
import { API_URL } from '../lib/api'
import type { AgentBuiltinTool, BuiltinAppCatalog } from '../lib/types'
import { Modal } from './Modal'

const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500'

const APP_EMOJI: Record<string, string> = {
  google_calendar: '📅',
  google_sheets: '📊',
  slack: '💬',
  mercadopago: '💳',
  rdstation: '📇',
  hubspot: '🧡',
  stripe: '💳',
  nuvemshop: '🛍️',
}

// Brand tiles: the app's logo (white) on its brand-color square. Logos from
// simple-icons; RD Station has no official simple-icon, so it uses a generic
// contact glyph in its brand color.
const BRAND: Record<string, { color: string; path: string }> = {
  slack: {
    color: '#4A154B',
    path: 'M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z',
  },
  google_calendar: {
    color: '#4285F4',
    path: 'M18.316 5.684H24v12.632h-5.684V5.684zM5.684 24h12.632v-5.684H5.684V24zM18.316 5.684V0H1.895A1.894 1.894 0 0 0 0 1.895v16.421h5.684V5.684h12.632zm-7.207 6.25v-.065c.272-.144.5-.349.687-.617s.279-.595.279-.982c0-.379-.099-.72-.3-1.025a2.05 2.05 0 0 0-.832-.714 2.703 2.703 0 0 0-1.197-.257c-.6 0-1.094.156-1.481.467-.386.311-.65.671-.793 1.078l1.085.452c.086-.249.224-.461.413-.633.189-.172.445-.257.767-.257.33 0 .602.088.816.264a.86.86 0 0 1 .322.703c0 .33-.12.589-.36.778-.24.19-.535.284-.886.284h-.567v1.085h.633c.407 0 .748.109 1.02.327.272.218.407.499.407.843 0 .336-.129.614-.387.832s-.565.327-.924.327c-.351 0-.651-.103-.897-.311-.248-.208-.422-.502-.521-.881l-1.096.452c.178.616.505 1.082.977 1.401.472.319.984.478 1.538.477a2.84 2.84 0 0 0 1.293-.291c.382-.193.684-.458.902-.794.218-.336.327-.72.327-1.149 0-.429-.115-.797-.344-1.105a2.067 2.067 0 0 0-.881-.689zm2.093-1.931l.602.913L15 10.045v5.744h1.187V8.446h-.827l-2.158 1.557zM22.105 0h-3.289v5.184H24V1.895A1.894 1.894 0 0 0 22.105 0zm-3.289 23.5l4.684-4.684h-4.684V23.5zM0 22.105C0 23.152.848 24 1.895 24h3.289v-5.184H0v3.289z',
  },
  google_sheets: {
    color: '#34A853',
    path: 'M11.318 12.545H7.91v-1.909h3.41v1.91zM14.728 0v6h6l-6-6zm1.363 10.636h-3.41v1.91h3.41v-1.91zm0 3.273h-3.41v1.91h3.41v-1.91zM20.727 6.5v15.864c0 .904-.732 1.636-1.636 1.636H4.909a1.636 1.636 0 0 1-1.636-1.636V1.636C3.273.732 4.005 0 4.909 0h9.318v6.5h6.5zm-3.273 2.773H6.545v7.909h10.91v-7.91zm-6.136 4.636H7.91v1.91h3.41v-1.91z',
  },
  mercadopago: {
    color: '#00B1EA',
    path: 'M11.115 16.479a.93.927 0 0 1-.939-.886c-.002-.042-.006-.155-.103-.155-.04 0-.074.023-.113.059-.112.103-.254.206-.46.206a.816.814 0 0 1-.305-.066c-.535-.214-.542-.578-.521-.725.006-.038.007-.08-.02-.11l-.032-.03h-.034c-.027 0-.055.012-.093.039a.788.786 0 0 1-.454.16.7.699 0 0 1-.253-.05c-.708-.27-.65-.928-.617-1.126.005-.041-.005-.072-.03-.092l-.05-.04-.047.043a.728.726 0 0 1-.505.203.73.728 0 0 1-.732-.725c0-.4.328-.722.732-.722.364 0 .675.27.721.63l.026.195.11-.165c.01-.018.307-.46.852-.46.102 0 .21.016.316.05.434.13.508.52.519.68.008.094.075.1.09.1.037 0 .064-.024.083-.045a.746.744 0 0 1 .54-.225c.128 0 .263.03.402.09.69.293.379 1.158.374 1.167-.058.144-.061.207-.005.244l.027.013h.02c.03 0 .07-.014.134-.035.093-.032.235-.08.367-.08a.944.942 0 0 1 .94.93.936.934 0 0 1-.94.928zm7.302-4.171c-1.138-.98-3.768-3.24-4.481-3.77-.406-.302-.685-.462-.928-.533a1.559 1.554 0 0 0-.456-.07c-.182 0-.376.032-.58.095-.46.145-.918.505-1.362.854l-.023.018c-.414.324-.84.66-1.164.73a1.986 1.98 0 0 1-.43.049c-.362 0-.687-.104-.81-.258-.02-.025-.007-.066.04-.125l.008-.008 1-1.067c.783-.774 1.525-1.506 3.23-1.545h.085c1.062 0 2.12.469 2.24.524a7.03 7.03 0 0 0 3.056.724c1.076 0 2.188-.263 3.354-.795a9.135 9.11 0 0 0-.405-.317c-1.025.44-2.003.66-2.946.66-.962 0-1.925-.229-2.858-.68-.05-.022-1.22-.567-2.44-.57-.032 0-.065 0-.096.002-1.434.033-2.24.536-2.782.976-.528.013-.982.138-1.388.25-.361.1-.673.186-.979.185-.125 0-.35-.01-.37-.012-.35-.01-2.115-.437-3.518-.962-.143.1-.28.203-.415.31 1.466.593 3.25 1.053 3.812 1.089.157.01.323.027.491.027.372 0 .744-.103 1.104-.203.213-.059.446-.123.692-.17l-.196.194-1.017 1.087c-.08.08-.254.294-.14.557a.705.703 0 0 0 .268.292c.243.162.677.27 1.08.271.152 0 .297-.015.43-.044.427-.095.874-.448 1.349-.82.377-.296.913-.672 1.323-.782a1.494 1.49 0 0 1 .37-.05.611.61 0 0 1 .095.005c.27.034.533.125 1.003.472.835.62 4.531 3.815 4.566 3.846.002.002.238.203.22.537-.007.186-.11.352-.294.466a.902.9 0 0 1-.484.15.804.802 0 0 1-.428-.124c-.014-.01-1.28-1.157-1.746-1.543-.074-.06-.146-.115-.22-.115a.122.122 0 0 0-.096.045c-.073.09.01.212.105.294l1.48 1.47c.002 0 .184.17.204.395.012.244-.106.447-.35.606a.957.955 0 0 1-.526.171.766.764 0 0 1-.42-.127l-.214-.206a21.035 20.978 0 0 0-1.08-1.009c-.072-.058-.148-.112-.221-.112a.127.127 0 0 0-.094.038c-.033.037-.056.103.028.212a.698.696 0 0 0 .075.083l1.078 1.198c.01.01.222.26.024.511l-.038.048a1.18 1.178 0 0 1-.1.096c-.184.15-.43.164-.527.164a.8.798 0 0 1-.147-.012c-.106-.018-.178-.048-.212-.089l-.013-.013c-.06-.06-.602-.609-1.054-.98-.059-.05-.133-.11-.21-.11a.128.128 0 0 0-.096.042c-.09.096.044.24.1.293l.92 1.003a.204.204 0 0 1-.033.062c-.033.044-.144.155-.479.196a.91.907 0 0 1-.122.007c-.345 0-.712-.164-.902-.264a1.343 1.34 0 0 0 .13-.576 1.368 1.365 0 0 0-1.42-1.357c.024-.342-.025-.99-.697-1.274a1.455 1.452 0 0 0-.575-.125c-.146 0-.287.025-.42.075a1.153 1.15 0 0 0-.671-.564 1.52 1.515 0 0 0-.494-.085c-.28 0-.537.08-.767.242a1.168 1.165 0 0 0-.903-.43 1.173 1.17 0 0 0-.82.335c-.287-.217-1.425-.93-4.467-1.613a17.39 17.344 0 0 1-.692-.189 4.822 4.82 0 0 0-.077.494l.67.157c3.108.682 4.136 1.391 4.309 1.525a1.145 1.142 0 0 0-.09.442 1.16 1.158 0 0 0 1.378 1.132c.096.467.406.821.879 1.003a1.165 1.162 0 0 0 .415.08c.09 0 .179-.012.266-.034.086.22.282.493.722.668a1.233 1.23 0 0 0 .457.094c.122 0 .241-.022.355-.063a1.373 1.37 0 0 0 1.269.841c.37.002.726-.147.985-.41.221.121.688.341 1.163.341.06 0 .118-.002.175-.01.47-.059.689-.24.789-.382a.571.57 0 0 0 .048-.078c.11.032.234.058.373.058.255 0 .501-.086.75-.265.244-.174.418-.424.444-.637v-.01c.083.017.167.026.251.026.265 0 .527-.082.773-.242.48-.31.562-.715.554-.98a1.28 1.279 0 0 0 .978-.194 1.04 1.04 0 0 0 .502-.808 1.088 1.085 0 0 0-.16-.653c.804-.342 2.636-1.003 4.795-1.483a4.734 4.721 0 0 0-.067-.492 27.742 27.667 0 0 0-5.049 1.62zm5.123-.763c0 4.027-5.166 7.293-11.537 7.293-6.372 0-11.538-3.266-11.538-7.293 0-4.028 5.165-7.293 11.539-7.293 6.371 0 11.537 3.265 11.537 7.293zm.46.004c0-4.272-5.374-7.755-12-7.755S.002 7.277.002 11.55L0 12.004c0 4.533 4.695 8.203 11.999 8.203 7.347 0 12-3.67 12-8.204z',
  },
  rdstation: {
    color: '#19C1A0',
    path: 'M12 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 12c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6z',
  },
  hubspot: {
    color: '#FF7A59',
    path: 'M18.164 7.93V5.084a2.198 2.198 0 001.267-1.978v-.067A2.2 2.2 0 0017.238.845h-.067a2.2 2.2 0 00-2.193 2.193v.067a2.196 2.196 0 001.252 1.973l.013.006v2.852a6.22 6.22 0 00-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 104.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 00-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 00-.58-.095h-.002a2.033 2.033 0 102.033 2.033 1.978 1.978 0 00-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 104.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 113.215-3.207v.002a3.206 3.206 0 01-3.207 3.207z',
  },
  stripe: {
    color: '#635BFF',
    path: 'M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z',
  },
  nuvemshop: {
    color: '#2C3357',
    path: 'M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z',
  },
}

function AppIcon({ appKey }: { appKey: string }) {
  const brand = BRAND[appKey]
  if (!brand) {
    return (
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-800 text-2xl">
        {APP_EMOJI[appKey] ?? '🔌'}
      </div>
    )
  }
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: brand.color }}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="#fff" aria-hidden="true">
        <path d={brand.path} />
      </svg>
    </div>
  )
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

  const editingApp = configuring ? value.some((v) => v.key === configuring.key) : false

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {apps.map((app) => {
          const enabled = value.some((v) => v.key === app.key)
          return (
            <div
              key={app.key}
              className={`flex flex-col items-center rounded-xl border p-3 text-center transition ${
                enabled ? 'border-slate-600 bg-slate-900' : 'border-slate-800'
              }`}
            >
              <AppIcon appKey={app.key} />
              <p className="mt-2 text-sm font-medium">{app.label}</p>
              <span className={`mt-0.5 text-[11px] ${enabled ? 'text-emerald-400' : 'text-slate-600'}`}>
                {enabled ? '✓ Conectado' : 'Não conectado'}
              </span>
              <button
                type="button"
                onClick={() => openConfig(app)}
                className={`mt-3 w-full rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  enabled ? 'border border-slate-700 hover:bg-slate-800' : 'bg-white text-slate-950 hover:bg-slate-200'
                }`}
              >
                {enabled ? 'Configurar' : 'Conectar'}
              </button>
            </div>
          )
        })}
      </div>

      <Modal
        open={configuring !== null}
        onClose={() => setConfiguring(null)}
        title={configuring ? `${editingApp ? 'Configurar' : 'Conectar'} ${configuring.label}` : ''}
      >
        {configuring && (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">{configuring.description}</p>
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
                    type={field.type === 'password' ? 'password' : 'text'}
                    value={draft[field.key] ?? ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className={inputClass}
                  />
                </div>
              ))
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={saveConfig}
                disabled={!canSave}
                className="flex-1 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
              >
                {editingApp ? 'Salvar' : 'Conectar'}
              </button>
              {editingApp && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(value.filter((v) => v.key !== configuring.key))
                    setConfiguring(null)
                  }}
                  className="rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-400 transition hover:bg-red-500/10"
                >
                  Remover
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
