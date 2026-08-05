import { useEffect, useState } from 'react'
import { API_URL } from '../lib/api'
import type { AgentSummary, TeamSummary, WhatsAppChannel, WhatsAppProviderCatalog } from '../lib/types'
import { Modal } from './Modal'

const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500'

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 truncate rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300">
        {value}
      </code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className="shrink-0 rounded-lg border border-slate-700 px-3 text-xs transition hover:bg-slate-800"
      >
        {copied ? 'Copiado ✓' : 'Copiar'}
      </button>
    </div>
  )
}

// The WhatsApp channels manager — a tab on the Canais page. Lists connected
// numbers and drives the connect flow (provider choice → config → webhook).
export function WhatsAppManager({
  agents,
  teams,
}: {
  agents: AgentSummary[]
  teams: TeamSummary[]
}) {
  const [providers, setProviders] = useState<WhatsAppProviderCatalog[]>([])
  const [channels, setChannels] = useState<WhatsAppChannel[]>([])
  const [loading, setLoading] = useState(true)

  const [connecting, setConnecting] = useState(false)
  const [provider, setProvider] = useState<WhatsAppProviderCatalog | null>(null)
  const [name, setName] = useState('')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [link, setLink] = useState('') // "agent:<id>" | "team:<id>"
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<WhatsAppChannel | null>(null)

  async function loadChannels() {
    const res = await fetch(`${API_URL}/api/whatsapp/channels`, { credentials: 'include' })
    if (res.ok) setChannels(await res.json())
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API_URL}/api/whatsapp/providers`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_URL}/api/whatsapp/channels`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([p, c]) => {
        if (cancelled) return
        setProviders(p)
        setChannels(c)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  function openConnect() {
    setProvider(null)
    setName('')
    setDraft({})
    setLink('')
    setError(null)
    setCreated(null)
    setConnecting(true)
  }

  const canSave =
    provider !== null &&
    name.trim().length > 0 &&
    link !== '' &&
    provider.fields.every((f) => !f.required || (draft[f.key] ?? '').trim().length > 0)

  async function handleSave() {
    if (!provider || !canSave) return
    setError(null)
    setSaving(true)
    const [linkType, linkId] = link.split(':')
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/channels`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          provider: provider.key,
          config: draft,
          agentId: linkType === 'agent' ? linkId : null,
          teamId: linkType === 'team' ? linkId : null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error ?? 'Não foi possível conectar.')
        return
      }
      const channel: WhatsAppChannel = await res.json()
      setCreated(channel)
      await loadChannels()
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove(channel: WhatsAppChannel) {
    if (!window.confirm(`Remover o canal "${channel.name}"? As conversas dele serão apagadas.`)) return
    const res = await fetch(`${API_URL}/api/whatsapp/channels/${channel._id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) await loadChannels()
  }

  function linkLabel(channel: WhatsAppChannel) {
    if (channel.agentId) return agents.find((a) => a._id === channel.agentId)?.name ?? 'Agente'
    if (channel.teamId) return teams.find((t) => t._id === channel.teamId)?.name ?? 'Equipe'
    return 'Sem vínculo'
  }

  const providerLabel = (key: string | null) => providers.find((p) => p.key === key)?.label ?? key ?? '—'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-400">
          Conecte um número de WhatsApp a um agente ou equipe. As conversas aparecem em Chats como
          qualquer outra, com atendimento humano incluso.
        </p>
        <button
          type="button"
          onClick={openConnect}
          className="shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
        >
          Conectar WhatsApp
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : channels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center">
          <p className="text-sm text-slate-400">Nenhum número conectado ainda.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {channels.map((channel) => (
            <li key={channel._id} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{channel.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {providerLabel(channel.provider)} · {linkLabel(channel)}
                    {channel.number ? ` · ${channel.number}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(channel)}
                  className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-500/10"
                >
                  Remover
                </button>
              </div>
              {channel.webhookUrl && (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Webhook</p>
                  <CopyField value={channel.webhookUrl} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal wide open={connecting} onClose={() => setConnecting(false)} title="Conectar WhatsApp">
        {created ? (
          <div className="space-y-4">
            <p className="text-sm">
              Canal <span className="font-medium">{created.name}</span> criado. Falta um passo:
            </p>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <p className="mb-2 text-sm text-slate-300">
                Cole este endereço como <strong>webhook</strong> na configuração do seu provedor (evento de
                mensagens recebidas):
              </p>
              {created.webhookUrl && <CopyField value={created.webhookUrl} />}
            </div>
            <button
              type="button"
              onClick={() => setConnecting(false)}
              className="w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
            >
              Concluir
            </button>
          </div>
        ) : !provider ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">Escolha o provedor de WhatsApp:</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {providers.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  disabled={!p.available}
                  onClick={() => p.available && setProvider(p)}
                  className={`rounded-xl border p-4 text-left transition ${
                    p.available
                      ? 'border-slate-800 hover:border-slate-600'
                      : 'cursor-not-allowed border-slate-800 opacity-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{p.label}</p>
                    {!p.available && (
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500">
                        Em breve
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{p.description}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setProvider(null)}
              className="text-xs text-slate-400 transition hover:text-white"
            >
              ← Trocar provedor ({provider.label})
            </button>

            <div>
              <label className="mb-1 block text-sm text-slate-400">Nome do canal</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: WhatsApp do restaurante"
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-slate-400">Responder com</label>
              <select value={link} onChange={(e) => setLink(e.target.value)} className={inputClass}>
                <option value="">Selecione um agente ou equipe</option>
                {agents.length > 0 && (
                  <optgroup label="Agentes">
                    {agents.map((a) => (
                      <option key={a._id} value={`agent:${a._id}`}>
                        {a.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {teams.length > 0 && (
                  <optgroup label="Equipes">
                    {teams.map((t) => (
                      <option key={t._id} value={`team:${t._id}`}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {provider.fields.map((field) => (
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
            ))}

            {provider.webhookNote && <p className="text-xs text-slate-500">{provider.webhookNote}</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving}
              className="w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
            >
              {saving ? 'Conectando...' : 'Conectar'}
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
