import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { ProviderInfo } from '../lib/types'
import { Modal } from './Modal'

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
    <div className="space-y-3 rounded-lg border border-slate-800 p-3">
      <div>
        <h4 className="font-medium">{provider.label}</h4>
        <p className="text-sm">
          Status:{' '}
          {hasKey ? (
            <span className="text-emerald-400">chave configurada</span>
          ) : (
            <span className="text-slate-400">nenhuma chave configurada</span>
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
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : hasKey ? 'Substituir chave' : 'Salvar chave'}
          </button>
          {hasKey && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm transition hover:bg-slate-800 disabled:opacity-50"
            >
              {removing ? 'Removendo...' : 'Remover'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

function MonthlyCapField({ initialCap, onSaved }: { initialCap: number; onSaved: () => void | Promise<void> }) {
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
    <div className="space-y-2 rounded-lg border border-slate-800 p-3">
      <h4 className="font-medium">Teto mensal de tokens</h4>
      <p className="text-sm text-slate-400">
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
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
        >
          {saving ? 'Salvando...' : saved ? 'Salvo ✓' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

export function ApiKeySettings() {
  const [open, setOpen] = useState(false)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [status, setStatus] = useState<KeyStatus>({})
  const [monthlyCap, setMonthlyCap] = useState(0)
  const [loading, setLoading] = useState(true)

  async function loadSettings() {
    setLoading(true)
    const [providersRes, statusRes] = await Promise.all([
      fetch(`${API_URL}/api/providers`, { credentials: 'include' }),
      fetch(`${API_URL}/api/settings`, { credentials: 'include' }),
    ])
    if (providersRes.ok) setProviders(await providersRes.json())
    if (statusRes.ok) {
      const { monthlyTokenCap, ...keyStatus } = await statusRes.json()
      setStatus(keyStatus)
      setMonthlyCap(typeof monthlyTokenCap === 'number' ? monthlyTokenCap : 0)
    }
    setLoading(false)
  }

  function handleOpen() {
    setOpen(true)
    loadSettings()
  }

  useEffect(() => {
    if (open) loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="text-sm text-slate-400 transition hover:text-white"
      >
        Configurações
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Configurações">
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Chaves usadas para gerar as respostas dos seus agentes (cada agente escolhe qual provedor
            usar). Se você não configurar uma chave, o sistema tenta usar uma chave padrão do servidor,
            se houver — a busca na base de conhecimento (RAG) funciona normalmente de qualquer forma,
            isso só afeta quem gera a resposta final.
          </p>

          {loading ? (
            <p className="text-sm text-slate-400">Carregando...</p>
          ) : (
            <>
              {providers.map((provider) => (
                <ProviderKeyField
                  key={provider.id}
                  provider={provider}
                  hasKey={Boolean(status[provider.id])}
                  onChange={loadSettings}
                />
              ))}
              <MonthlyCapField initialCap={monthlyCap} onSaved={loadSettings} />
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
