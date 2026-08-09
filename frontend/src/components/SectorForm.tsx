import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { AgentSummary, SectorMode, SectorSummary } from '../lib/types'

interface EditTransition {
  condition: string
  targetAgentId: string
}

interface EditMember {
  agentId: string
  sector: string
  routingDescription: string
  advanceWhen: string
  transitions: EditTransition[]
  isDefault: boolean
}

const DEFAULT_SECTORS = ['Suporte', 'Vendas', 'Desenvolvimento', 'Financeiro', 'Marketing']

interface SectorFormProps {
  // null = creating a new sector; otherwise editing this one.
  sector: SectorSummary | null
  agents: AgentSummary[]
  onSaved: () => void
}

export function SectorForm({ sector, agents, onSaved }: SectorFormProps) {
  const isCreating = sector === null
  const [editName, setEditName] = useState('')
  const [editMode, setEditMode] = useState<SectorMode>('adaptive')
  const [editMembers, setEditMembers] = useState<EditMember[]>([])
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  useEffect(() => {
    setEditError(null)
    setSaving(false)
    if (sector) {
      setEditName(sector.name)
      setEditMode(sector.mode)
      setEditMembers(sector.members.map((m) => ({ ...m, transitions: (m.transitions ?? []).map((t) => ({ ...t })) })))
    } else {
      setEditName('')
      setEditMode('adaptive')
      setEditMembers([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sector?._id])

  const agentNameById = new Map(agents.map((a) => [a._id, a.name]))
  const isPipeline = editMode === 'pipeline'
  const usedAgentIds = new Set(editMembers.map((m) => m.agentId))
  const availableAgents = agents.filter((a) => !usedAgentIds.has(a._id))
  // Suggest sectors already in use on this sector plus a few common defaults.
  const sectorSuggestions = Array.from(
    new Set([...editMembers.map((m) => m.sector.trim()).filter(Boolean), ...DEFAULT_SECTORS]),
  )

  function addMember(agentId: string) {
    if (!agentId) return
    setEditMembers((prev) => [
      ...prev,
      { agentId, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: prev.length === 0 },
    ])
  }

  function removeMember(agentId: string) {
    setEditMembers((prev) => {
      const next = prev
        .filter((m) => m.agentId !== agentId)
        // Drop any transitions that pointed at the removed stage.
        .map((m) => ({ ...m, transitions: m.transitions.filter((t) => t.targetAgentId !== agentId) }))
      // Keep exactly one default.
      if (next.length > 0 && !next.some((m) => m.isDefault)) next[0].isDefault = true
      return [...next]
    })
  }

  function moveMember(index: number, direction: -1 | 1) {
    setEditMembers((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function setSector(agentId: string, value: string) {
    setEditMembers((prev) => prev.map((m) => (m.agentId === agentId ? { ...m, sector: value } : m)))
  }

  function setDescription(agentId: string, value: string) {
    setEditMembers((prev) => prev.map((m) => (m.agentId === agentId ? { ...m, routingDescription: value } : m)))
  }

  function setAdvanceWhen(agentId: string, value: string) {
    setEditMembers((prev) => prev.map((m) => (m.agentId === agentId ? { ...m, advanceWhen: value } : m)))
  }

  function addTransition(agentId: string, targetAgentId: string) {
    if (!targetAgentId) return
    setEditMembers((prev) =>
      prev.map((m) =>
        m.agentId === agentId ? { ...m, transitions: [...m.transitions, { condition: '', targetAgentId }] } : m,
      ),
    )
  }

  function removeTransition(agentId: string, index: number) {
    setEditMembers((prev) =>
      prev.map((m) =>
        m.agentId === agentId ? { ...m, transitions: m.transitions.filter((_, i) => i !== index) } : m,
      ),
    )
  }

  function setTransitionCondition(agentId: string, index: number, value: string) {
    setEditMembers((prev) =>
      prev.map((m) =>
        m.agentId === agentId
          ? { ...m, transitions: m.transitions.map((t, i) => (i === index ? { ...t, condition: value } : t)) }
          : m,
      ),
    )
  }

  function setDefault(agentId: string) {
    setEditMembers((prev) => prev.map((m) => ({ ...m, isDefault: m.agentId === agentId })))
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setEditError(null)
    if (editMembers.length < 2) {
      setEditError(
        isPipeline
          ? 'Um fluxo precisa de pelo menos 2 etapas.'
          : 'Um setor precisa de pelo menos 2 agentes para o orquestrador fazer sentido.',
      )
      return
    }
    setSaving(true)
    const body = JSON.stringify({
      name: editName,
      mode: editMode,
      members: editMembers.map((m) => ({
        agentId: m.agentId,
        // Sectors organize adaptive sectors; they don't apply to ordered pipelines.
        sector: editMode === 'adaptive' ? m.sector.trim() : '',
        routingDescription: m.routingDescription.trim(),
        advanceWhen: m.advanceWhen.trim(),
        // Transitions only apply to the pipeline flow.
        transitions:
          editMode === 'pipeline'
            ? m.transitions.map((t) => ({ condition: t.condition.trim(), targetAgentId: t.targetAgentId }))
            : [],
        isDefault: m.isDefault,
      })),
    })

    try {
      const res = isCreating
        ? await fetch(`${API_URL}/api/sectors`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body,
          })
        : await fetch(`${API_URL}/api/sectors/${sector?._id}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body,
          })
      if (!res.ok) {
        setEditError('Não foi possível salvar o setor.')
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <datalist id="sector-sector-suggestions">
        {sectorSuggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div>
        <label className="mb-1 block text-sm text-(--text-muted)">Nome do setor</label>
        <input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          required
          autoFocus
          placeholder="Ex: Atendimento da barbearia"
          className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-(--text-muted)">Modo de orquestração</label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setEditMode('adaptive')}
            className={`rounded-lg border p-3 text-left text-sm transition ${
              editMode === 'adaptive' ? 'border-(--intent-brand) bg-(--surface-sunken)' : 'border-(--border-strong) hover:border-(--border-strong)'
            }`}
          >
            <span className="font-medium">Adaptativo</span>
            <span className="mt-1 block text-xs text-(--text-muted)">
              Um supervisor consulta, a cada mensagem, os especialistas que têm a informação.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setEditMode('pipeline')}
            className={`rounded-lg border p-3 text-left text-sm transition ${
              editMode === 'pipeline' ? 'border-(--intent-brand) bg-(--surface-sunken)' : 'border-(--border-strong) hover:border-(--border-strong)'
            }`}
          >
            <span className="font-medium">Fluxo (pipeline)</span>
            <span className="mt-1 block text-xs text-(--text-muted)">
              Etapas em sequência: cada agente cuida de uma parte e passa para a próxima.
            </span>
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">{isPipeline ? 'Etapas do fluxo' : 'Agentes do setor'}</p>
        <p className="text-xs text-(--text-faint)">
          {isPipeline
            ? 'As etapas são executadas na ordem abaixo. Descreva o que cada etapa faz e quando ela deve passar para a próxima. Marque uma etapa como padrão (voz, memória e configurações compartilhadas).'
            : 'Descreva quando cada agente deve ser usado — é o que o orquestrador lê para decidir quais consultar. Marque um como padrão (voz do setor e fallback para mensagens ambíguas).'}
        </p>

        {editMembers.length === 0 ? (
          <p className="text-sm text-(--text-muted)">Adicione pelo menos 2 {isPipeline ? 'etapas' : 'agentes'}.</p>
        ) : (
          <ul className="space-y-2">
            {editMembers.map((m, index) => (
              <li key={m.agentId} className="rounded-lg border border-(--border-subtle) p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {isPipeline && <span className="text-(--text-faint)">{index + 1}. </span>}
                    {agentNameById.get(m.agentId) ?? 'Agente'}
                  </span>
                  <div className="flex items-center gap-3">
                    {isPipeline && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveMember(index, -1)}
                          disabled={index === 0}
                          className="rounded border border-(--border-strong) px-1.5 text-xs text-(--text-muted) transition hover:bg-(--surface-sunken) disabled:opacity-30"
                          aria-label="Subir etapa"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveMember(index, 1)}
                          disabled={index === editMembers.length - 1}
                          className="rounded border border-(--border-strong) px-1.5 text-xs text-(--text-muted) transition hover:bg-(--surface-sunken) disabled:opacity-30"
                          aria-label="Descer etapa"
                        >
                          ↓
                        </button>
                      </div>
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-(--text-muted)">
                      <input
                        type="radio"
                        name="default-member"
                        checked={m.isDefault}
                        onChange={() => setDefault(m.agentId)}
                      />
                      Padrão
                    </label>
                    <button
                      type="button"
                      onClick={() => removeMember(m.agentId)}
                      className="text-xs text-(--coral-600) underline transition hover:text-(--coral-600)"
                    >
                      Remover
                    </button>
                  </div>
                </div>
                {!isPipeline && (
                  <input
                    value={m.sector}
                    onChange={(e) => setSector(m.agentId, e.target.value)}
                    list="sector-sector-suggestions"
                    placeholder="Área (ex: Suporte, Vendas) — opcional"
                    className="mb-2 w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                  />
                )}
                <input
                  value={m.routingDescription}
                  onChange={(e) => setDescription(m.agentId, e.target.value)}
                  placeholder={
                    isPipeline
                      ? 'O que esta etapa faz (ex: qualificar o lead e coletar requisitos)'
                      : 'Quando usar este agente (ex: reservas, horários e disponibilidade)'
                  }
                  className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                />
                {isPipeline &&
                  (index === editMembers.length - 1 ? (
                    <p className="mt-1.5 text-xs text-(--text-faint)">
                      Última etapa — encerra o fluxo (mas ainda pode ter desvios abaixo).
                    </p>
                  ) : (
                    <input
                      value={m.advanceWhen}
                      onChange={(e) => setAdvanceWhen(m.agentId, e.target.value)}
                      placeholder="Quando avançar para a próxima etapa (ex: quando já tiver data e nº de pessoas)"
                      className="mt-2 w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                    />
                  ))}
                {isPipeline && (
                  <div className="mt-2 rounded-lg border border-(--border-subtle)/70 bg-(--surface-card)/40 p-2">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-(--text-faint)">
                      Desvios (opcional)
                    </p>
                    {m.transitions.length === 0 ? (
                      <p className="text-xs text-(--text-faint)">
                        Pule, ramifique ou volte para outra etapa quando uma condição acontecer.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {m.transitions.map((t, ti) => (
                          <li key={ti} className="flex items-center gap-1.5">
                            <span className="shrink-0 text-xs text-(--text-faint)">Se</span>
                            <input
                              value={t.condition}
                              onChange={(e) => setTransitionCondition(m.agentId, ti, e.target.value)}
                              placeholder="ex: o grupo tiver mais de 8 pessoas"
                              className="min-w-0 flex-1 rounded border border-(--border-strong) bg-(--surface-card) px-2 py-1 text-xs outline-none focus:border-(--border-focus)"
                            />
                            <span className="shrink-0 text-xs text-(--text-muted)">
                              → {agentNameById.get(t.targetAgentId) ?? 'etapa'}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeTransition(m.agentId, ti)}
                              className="shrink-0 px-1 text-sm text-(--coral-600) transition hover:text-(--coral-600)"
                              aria-label="Remover desvio"
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {editMembers.some(
                      (o) => o.agentId !== m.agentId && !m.transitions.some((t) => t.targetAgentId === o.agentId),
                    ) && (
                      <select
                        value=""
                        onChange={(e) => {
                          addTransition(m.agentId, e.target.value)
                          e.target.value = ''
                        }}
                        className="mt-1.5 w-full rounded border border-(--border-strong) bg-(--surface-card) px-2 py-1 text-xs outline-none focus:border-(--border-focus)"
                      >
                        <option value="">+ Adicionar desvio para outra etapa</option>
                        {editMembers
                          .filter(
                            (o) =>
                              o.agentId !== m.agentId && !m.transitions.some((t) => t.targetAgentId === o.agentId),
                          )
                          .map((o) => (
                            <option key={o.agentId} value={o.agentId}>
                              ir para {agentNameById.get(o.agentId) ?? 'etapa'}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {availableAgents.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              addMember(e.target.value)
              e.target.value = ''
            }}
            className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
          >
            <option value="">+ Adicionar {isPipeline ? 'etapa' : 'agente ao setor'}</option>
            {availableAgents.map((a) => (
              <option key={a._id} value={a._id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {editError && <p className="text-sm text-(--coral-600)">{editError}</p>}

      <div className="flex justify-end border-t border-(--border-subtle) pt-4">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-(--intent-brand) px-5 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover) disabled:opacity-50"
        >
          {isCreating ? (saving ? 'Criando...' : 'Criar setor') : saving ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </div>
    </form>
  )
}
