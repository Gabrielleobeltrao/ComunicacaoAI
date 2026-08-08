import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { ProviderInfo } from '../lib/types'

type KeyStatus = Record<string, boolean>

function ProviderKeyField({
  provider,
  hasKey,
  onChange,
}: {
  provider: ProviderInfo
  hasKey: boolean
  onChange: () => void | Promise<void>
}) {
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)

    try {
      const res = await fetch(`${API_URL}/api/settings/${provider.id}/key`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })

      if (!res.ok) {
        setError('Não foi possível salvar a chave.')
        return
      }

      setApiKey('')
      await onChange()
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setError(null)
    setRemoving(true)

    try {
      const res = await fetch(`${API_URL}/api/settings/${provider.id}/key`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        await onChange()
      }
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-(--border-subtle) p-3">
      <div>
        <h4 className="font-medium">{provider.label}</h4>
        <p className="text-sm">
          Status:{' '}
          {hasKey ? (
            <span className="text-emerald-400">chave configurada</span>
          ) : (
            <span className="text-(--text-muted)">nenhuma chave configurada</span>
          )}
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={provider.id === 'openai' ? 'sk-...' : 'sk-ant-...'}
          required
          className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
        />
        {error && <p className="text-sm text-(--coral-600)">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-lg bg-(--intent-brand) px-4 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover) disabled:opacity-50"
          >
            {saving ? 'Salvando...' : hasKey ? 'Substituir chave' : 'Salvar chave'}
          </button>
          {hasKey && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              className="rounded-lg border border-(--border-strong) px-4 py-2 text-sm transition hover:bg-(--surface-sunken) disabled:opacity-50"
            >
              {removing ? 'Removendo...' : 'Remover'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

export function MonthlyCapField({ initialCap, onSaved }: { initialCap: number; onSaved: () => void | Promise<void> }) {
  const [cap, setCap] = useState(initialCap)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setCap(initialCap)
  }, [initialCap])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(`${API_URL}/api/settings/monthly-token-cap`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cap }),
      })
      if (res.ok) {
        setSaved(true)
        await onSaved()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-(--border-subtle) p-3">
      <h4 className="font-medium">Teto mensal de tokens</h4>
      <p className="text-sm text-(--text-muted)">
        Quando o total de tokens gastos no mês passar desse número, os agentes param de responder
        automaticamente (você ainda pode responder manualmente na página Chats). Use 0 para sem teto.
      </p>
      <div className="flex gap-2">
        <input
          type="number"
          min={0}
          value={cap}
          onChange={(e) => {
            setSaved(false)
            setCap(Math.max(0, Math.floor(Number(e.target.value) || 0)))
          }}
          className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="shrink-0 rounded-lg bg-(--intent-brand) px-4 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover) disabled:opacity-50"
        >
          {saving ? 'Salvando...' : saved ? 'Salvo ✓' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

export function GoogleIntegration() {
  const [status, setStatus] = useState<{ connected: boolean; email?: string; available: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)

  async function load() {
    const res = await fetch(`${API_URL}/api/integrations`, { credentials: 'include' })
    if (res.ok) {
      const body = await res.json()
      setStatus(body.google)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function disconnect() {
    setDisconnecting(true)
    try {
      await fetch(`${API_URL}/api/integrations/google`, { method: 'DELETE', credentials: 'include' })
      await load()
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-(--border-subtle) p-3">
      <h4 className="font-medium">Google Agenda</h4>
      {loading ? (
        <p className="text-sm text-(--text-muted)">Carregando...</p>
      ) : !status?.available ? (
        <p className="text-sm text-(--text-muted)">
          Integração não configurada no servidor (faltam as credenciais <code>GOOGLE_CLIENT_ID</code> /{' '}
          <code>GOOGLE_CLIENT_SECRET</code>).
        </p>
      ) : status.connected ? (
        <>
          <p className="text-sm">
            Conectado
            {status.email ? (
              <>
                {' '}
                como <span className="text-emerald-400">{status.email}</span>
              </>
            ) : null}
            .
          </p>
          <button
            type="button"
            onClick={disconnect}
            disabled={disconnecting}
            className="rounded-lg border border-(--border-strong) px-4 py-2 text-sm transition hover:bg-(--surface-sunken) disabled:opacity-50"
          >
            {disconnecting ? 'Desconectando...' : 'Desconectar'}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-(--text-muted)">
            Conecte sua conta Google para os agentes poderem consultar disponibilidade e criar eventos na
            sua agenda.
          </p>
          <a
            href={`${API_URL}/api/integrations/google/connect`}
            className="inline-block rounded-lg bg-(--intent-brand) px-4 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover)"
          >
            Conectar Google
          </a>
        </>
      )}
    </div>
  )
}

// The API-keys section of the settings page: loads each provider's key status
// and lets the owner set/replace/remove a key.
export function ApiKeysPanel() {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [status, setStatus] = useState<KeyStatus>({})
  const [loading, setLoading] = useState(true)

  async function loadKeys() {
    setLoading(true)
    const [providersRes, statusRes] = await Promise.all([
      fetch(`${API_URL}/api/providers`, { credentials: 'include' }),
      fetch(`${API_URL}/api/settings`, { credentials: 'include' }),
    ])
    if (providersRes.ok) setProviders(await providersRes.json())
    if (statusRes.ok) {
      const { monthlyTokenCap: _cap, ...keyStatus } = await statusRes.json()
      setStatus(keyStatus)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadKeys()
  }, [])

  return (
    <div className="space-y-3">
      <p className="text-sm text-(--text-muted)">
        Chaves usadas para gerar as respostas dos seus agentes (cada agente escolhe qual provedor
        usar). Se você não configurar uma chave, o sistema tenta usar uma chave padrão do servidor, se
        houver — a busca na base de conhecimento (RAG) funciona normalmente de qualquer forma, isso só
        afeta quem gera a resposta final.
      </p>

      {loading ? (
        <p className="text-sm text-(--text-muted)">Carregando...</p>
      ) : (
        providers.map((provider) => (
          <ProviderKeyField
            key={provider.id}
            provider={provider}
            hasKey={Boolean(status[provider.id])}
            onChange={loadKeys}
          />
        ))
      )}
    </div>
  )
}
