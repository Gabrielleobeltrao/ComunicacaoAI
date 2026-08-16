import { useCallback, useEffect, useState } from 'react'
import { API_URL } from '../lib/api'
import type { AgentSummary, SectorSummary } from '../lib/types'
import { Button } from '../ui'

// Who may call INTO this sector's people.
//
// Without a boundary, an outside agent can call a pipeline STAGE directly and walk
// into the middle of a flow, skipping the coordinator, the order and the contract.
// Closing the core removes ways in; it never grants anything, and the impact of the
// choice is shown before it is made.

export type EntryPolicy = 'sector_only' | 'selected_members' | 'open_members'

const POLICIES: { key: EntryPolicy; title: string; help: string }[] = [
  {
    key: 'sector_only',
    title: 'Sempre pelo setor (núcleo fechado)',
    help: 'Chamadas de fora enxergam e chamam somente o setor. Coordenador, membros e etapas não recebem chamada direta.',
  },
  {
    key: 'selected_members',
    title: 'Setor + agentes selecionados',
    help: 'O setor continua disponível e apenas os agentes escolhidos podem receber chamada direta.',
  },
  {
    key: 'open_members',
    title: 'Setor + qualquer agente',
    help: 'Qualquer agente do setor pode ser chamado direto, sujeito às permissões dele.',
  },
]

interface Impact {
  entryPolicy: EntryPolicy
  protectedAgents: { id: string; name: string; exposed: boolean }[]
  affectedCallers: { id: string; name: string; targets: string[] }[]
}

export function SectorAccessSection({
  sector,
  agents,
  onSaved,
}: {
  sector: SectorSummary & { entryPolicy?: EntryPolicy; exposedAgentIds?: string[] }
  agents: AgentSummary[]
  onSaved?: () => void
}) {
  const [policy, setPolicy] = useState<EntryPolicy>(sector.entryPolicy ?? 'open_members')
  const [exposed, setExposed] = useState<string[]>(sector.exposedAgentIds ?? [])
  const [impact, setImpact] = useState<Impact | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isGroup = sector.mode === 'organization'

  const loadImpact = useCallback(
    async (nextPolicy: EntryPolicy, nextExposed: string[]) => {
      try {
        const q = new URLSearchParams({ entryPolicy: nextPolicy })
        if (nextExposed.length) q.set('exposedAgentIds', nextExposed.join(','))
        const res = await fetch(`${API_URL}/api/sectors/${sector._id}/access-impact?${q}`, { credentials: 'include' })
        setImpact(res.ok ? ((await res.json()) as Impact) : null)
      } catch {
        setImpact(null)
      }
    },
    [sector._id],
  )

  useEffect(() => {
    void loadImpact(policy, exposed)
  }, [loadImpact, policy, exposed])

  const dirty = policy !== (sector.entryPolicy ?? 'open_members') || exposed.join(',') !== (sector.exposedAgentIds ?? []).join(',')

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/sectors/${sector._id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryPolicy: policy, exposedAgentIds: exposed }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? body?.message ?? 'Não foi possível salvar.')
      }
      onSaved?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const nameOf = (id: string) => agents.find((a) => a._id === id)?.name ?? 'Agente removido'
  const participants = impact?.protectedAgents ?? []

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4" data-testid="sector-access">
      <div>
        <p className="font-medium text-(--text-heading)">Quem pode chamar direto</p>
        <p className="text-sm text-(--text-muted)">
          Fechar o núcleo faz o setor ser a única porta de entrada. Isso só remove caminhos — não concede acesso a ninguém.
        </p>
      </div>

      <div className="grid gap-2">
        {POLICIES.map((p) => {
          const disabled = p.key === 'sector_only' && isGroup
          return (
            <label
              key={p.key}
              data-testid={`entry-${p.key}`}
              className="flex gap-2 rounded-lg border p-3"
              style={{
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.55 : 1,
                borderColor: policy === p.key ? 'var(--intent-brand)' : 'var(--border-subtle)',
              }}
            >
              <input
                type="radio"
                name="sector-entry-policy"
                checked={policy === p.key}
                disabled={disabled}
                onChange={() => setPolicy(p.key)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{p.title}</span>
                <span className="block text-xs text-(--text-muted)">
                  {disabled ? 'Um setor que apenas organiza não executa como unidade, então não pode ser a única porta de entrada.' : p.help}
                </span>
              </span>
            </label>
          )
        })}
      </div>

      {policy === 'selected_members' && participants.length > 0 ? (
        <div className="grid gap-1" data-testid="exposed-agents">
          <p className="text-xs text-(--text-muted)">Quem pode receber chamada direta:</p>
          {participants.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={exposed.includes(p.id)}
                onChange={(e) => setExposed((list) => (e.target.checked ? [...list, p.id] : list.filter((id) => id !== p.id)))}
              />
              {nameOf(p.id)}
            </label>
          ))}
        </div>
      ) : null}

      {impact && impact.affectedCallers.length > 0 ? (
        <div className="rounded-lg bg-(--surface-sunken) p-3" data-testid="access-impact">
          <p className="text-xs font-medium text-(--text-heading)">
            {impact.affectedCallers.length} agente(s) perderiam a chamada direta:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {impact.affectedCallers.map((c) => (
              <li key={c.id} className="text-xs text-(--text-muted)">
                {c.name} → {c.targets.join(', ')}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-(--text-muted)">Eles continuam podendo chamar o setor inteiro.</p>
        </div>
      ) : null}

      {error ? <p className="text-sm text-(--coral-600,#d92d20)" data-testid="access-error">{error}</p> : null}

      <div>
        <Button size="sm" disabled={!dirty || saving} onClick={() => void save()} data-testid="save-entry-policy">
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
