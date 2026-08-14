import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import { DEFAULT_SECTOR_COLOR, SECTOR_COLORS } from '../lib/sectorColors'
import type { AgentSummary, SectorMode, SectorSummary } from '../lib/types'

// A sector is a TEAM (never a schedule). Three ways it can work:
//   organization — only groups agents on the map.
//   orchestrated — a coordinator receives the request, delegates and consolidates.
//   pipeline     — ordered stages, each an agent, chaining outputs to inputs.
// The form shows only the fields a mode needs, in plain language (no ids/cron).

// Legacy conversational fields are carried through untouched so editing a legacy
// sector never wipes its advanceWhen/transitions before a safe conversion.
interface EditMember {
  agentId: string
  sector: string
  routingDescription: string
  advanceWhen: string
  transitions: { condition: string; targetAgentId: string }[]
  isDefault: boolean
}

interface EditStage {
  key: string // local-only React key
  id: string // stable id sent to the backend (blank = backend assigns)
  name: string
  agentId: string
  instruction: string
  dependsOn: string[] // ids of earlier stages
  expectedOutput: string
  onError: 'stop' | 'continue'
}

const MODES: { value: SectorMode; label: string; example: string; how: string }[] = [
  {
    value: 'organization',
    label: 'Organização',
    example: 'Ex.: agrupar “Vendas” no mapa, sem executar como equipe.',
    how: 'Apenas agrupa os agentes visualmente. Não é acionável como um time.',
  },
  {
    value: 'orchestrated',
    label: 'Orquestrado',
    example: 'Ex.: um gerente recebe o pedido, aciona pesquisador e redator e junta tudo.',
    how: 'O coordenador recebe a tarefa, aciona os membros que precisar e consolida a resposta.',
  },
  {
    value: 'pipeline',
    label: 'Pipeline',
    example: 'Ex.: coletar → analisar → escrever, cada etapa usando o resultado da anterior.',
    how: 'As etapas rodam em ordem. Cada etapa recebe o resultado das etapas de que depende.',
  },
]

const inputCls = 'w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)'

interface SectorFormProps {
  sector: SectorSummary | null
  agents: AgentSummary[]
  floorId?: string
  onSaved: () => void
}

export function SectorForm({ sector, agents, floorId, onSaved }: SectorFormProps) {
  const isCreating = sector === null
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState(DEFAULT_SECTOR_COLOR)
  const [editMode, setEditMode] = useState<SectorMode>('orchestrated')
  const [members, setMembers] = useState<EditMember[]>([])
  const [coordinatorAgentId, setCoordinatorAgentId] = useState('')
  const [instruction, setInstruction] = useState('')
  const [inputContract, setInputContract] = useState('')
  const [outputContract, setOutputContract] = useState('')
  const [stages, setStages] = useState<EditStage[]>([])
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  useEffect(() => {
    setEditError(null)
    setSaving(false)
    if (sector) {
      setEditName(sector.name)
      setEditColor(sector.color ?? DEFAULT_SECTOR_COLOR)
      setEditMode(sector.mode)
      setMembers(sector.members.map((m) => ({ ...m, transitions: (m.transitions ?? []).map((t) => ({ ...t })) })))
      setCoordinatorAgentId(sector.coordinatorAgentId ?? '')
      setInstruction(sector.instruction ?? '')
      setInputContract(sector.inputContract ?? '')
      setOutputContract(sector.outputContract ?? '')
      setStages(
        (sector.stages ?? []).map((s, i) => ({ key: `k${i}`, id: s.id, name: s.name, agentId: s.agentId, instruction: s.instruction, dependsOn: s.dependsOn ?? [], expectedOutput: s.expectedOutput ?? '', onError: s.onError })),
      )
    } else {
      setEditName('')
      setEditColor(DEFAULT_SECTOR_COLOR)
      setEditMode('orchestrated')
      setMembers([])
      setCoordinatorAgentId('')
      setInstruction('')
      setInputContract('')
      setOutputContract('')
      setStages([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sector?._id])

  const agentNameById = useMemo(() => new Map(agents.map((a) => [a._id, a.name])), [agents])
  const managerRecommended = useMemo(() => agents.filter((a) => a.preset === 'manager'), [agents])
  const memberIds = new Set(members.map((m) => m.agentId))
  const availableAgents = agents.filter((a) => !memberIds.has(a._id))

  // ----- members (organization / orchestrated) -----
  const addMember = (agentId: string) => {
    if (!agentId) return
    setMembers((prev) => [...prev, { agentId, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: prev.length === 0 }])
  }
  const removeMember = (agentId: string) => {
    setMembers((prev) => {
      const next = prev.filter((m) => m.agentId !== agentId).map((m) => ({ ...m, transitions: m.transitions.filter((t) => t.targetAgentId !== agentId) }))
      if (next.length > 0 && !next.some((m) => m.isDefault)) next[0].isDefault = true
      return [...next]
    })
    if (coordinatorAgentId === agentId) setCoordinatorAgentId('')
  }
  const setDescription = (agentId: string, value: string) => setMembers((prev) => prev.map((m) => (m.agentId === agentId ? { ...m, routingDescription: value } : m)))

  // ----- stages (pipeline) -----
  const addStage = (agentId: string) => {
    if (!agentId) return
    setStages((prev) => [...prev, { key: `k${Date.now()}-${prev.length}`, id: '', name: `Etapa ${prev.length + 1}`, agentId, instruction: '', dependsOn: prev.length ? [effectiveStageId(prev, prev.length - 1)] : [], expectedOutput: '', onError: 'stop' }])
  }
  const patchStage = (key: string, patch: Partial<EditStage>) => setStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  const removeStage = (key: string) => setStages((prev) => prev.filter((s) => s.key !== key))
  const moveStage = (index: number, dir: -1 | 1) =>
    setStages((prev) => {
      const t = index + dir
      if (t < 0 || t >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[t]] = [next[t], next[index]]
      return next
    })

  // A stage's effective id (assigned deterministically for dependency selection).
  function effectiveStageId(list: EditStage[], i: number): string {
    return list[i].id && list[i].id.trim() ? list[i].id : `s${i + 1}`
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setEditError(null)
    if (!editName.trim()) return setEditError('Dê um nome ao setor.')
    if (editMode === 'organization' && members.length < 1) return setEditError('Adicione ao menos um agente ao grupo.')
    if (editMode === 'orchestrated' && (!coordinatorAgentId || members.length < 1)) return setEditError('Escolha um coordenador e ao menos um membro.')
    if (editMode === 'pipeline') {
      if (stages.length < 1) return setEditError('Um pipeline precisa de ao menos uma etapa.')
      if (stages.some((s) => !s.agentId)) return setEditError('Cada etapa precisa de um agente.')
    }

    // Assign deterministic ids so dependencies resolve on the backend.
    const withIds = stages.map((s, i) => ({ ...s, id: effectiveStageId(stages, i) }))

    const body: Record<string, unknown> = {
      name: editName,
      color: editColor,
      mode: editMode,
      ...(isCreating && floorId ? { floorId } : {}),
    }
    if (editMode === 'organization' || editMode === 'orchestrated') {
      body.members = members.map((m) => ({
        agentId: m.agentId,
        sector: m.sector.trim(),
        routingDescription: m.routingDescription.trim(),
        advanceWhen: m.advanceWhen.trim(), // legacy, carried through untouched
        transitions: m.transitions.map((t) => ({ condition: t.condition.trim(), targetAgentId: t.targetAgentId })),
        isDefault: m.isDefault,
      }))
    }
    if (editMode === 'orchestrated') {
      body.coordinatorAgentId = coordinatorAgentId
      body.instruction = instruction.trim()
      body.inputContract = inputContract.trim()
      body.outputContract = outputContract.trim()
    }
    if (editMode === 'pipeline') {
      body.inputContract = inputContract.trim()
      body.outputContract = outputContract.trim()
      body.stages = withIds.map((s) => ({
        id: s.id,
        name: s.name.trim() || 'Etapa',
        agentId: s.agentId,
        instruction: s.instruction.trim(),
        dependsOn: s.dependsOn,
        expectedOutput: s.expectedOutput.trim(),
        onError: s.onError,
      }))
      // Clearing a converted pipeline of legacy roster is intentional here.
      body.members = []
    }

    setSaving(true)
    try {
      const res = isCreating
        ? await fetch(`${API_URL}/api/sectors`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`${API_URL}/api/sectors/${sector?._id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setEditError(data.error ?? 'Não foi possível salvar o setor.')
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm text-(--text-muted)">Nome do setor</label>
        <input value={editName} onChange={(e) => setEditName(e.target.value)} required autoFocus placeholder="Ex: Redação de conteúdo" className={inputCls} />
      </div>

      <div>
        <label className="mb-1 block text-sm text-(--text-muted)">Cor do setor (base da sala no mapa)</label>
        <div className="flex flex-wrap gap-2">
          {SECTOR_COLORS.map((c) => (
            <button key={c.value} type="button" onClick={() => setEditColor(c.value)} title={c.name} aria-label={c.name} className="h-8 w-8 rounded-full transition" style={{ background: c.value, outline: editColor === c.value ? '2px solid var(--text-heading)' : '2px solid transparent', outlineOffset: 2 }} />
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-(--text-muted)">Como esta equipe trabalha</label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <button key={m.value} type="button" onClick={() => setEditMode(m.value)} className={`rounded-lg border p-3 text-left text-sm transition ${editMode === m.value ? 'border-(--intent-brand) bg-(--surface-sunken)' : 'border-(--border-strong)'}`}>
              <span className="font-medium">{m.label}</span>
              <span className="mt-1 block text-xs text-(--text-muted)">{m.example}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-(--text-faint)">{MODES.find((m) => m.value === editMode)?.how}</p>
      </div>

      {/* Organization / Orchestrated: the team roster */}
      {editMode !== 'pipeline' && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Membros da equipe</p>
          {members.length === 0 ? (
            <p className="text-sm text-(--text-muted)">Adicione os agentes que fazem parte deste setor.</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.agentId} className="rounded-lg border border-(--border-subtle) p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{agentNameById.get(m.agentId) ?? 'Agente'}</span>
                    <button type="button" onClick={() => removeMember(m.agentId)} className="text-xs text-(--coral-600) underline">
                      Remover
                    </button>
                  </div>
                  {editMode === 'orchestrated' && (
                    <input value={m.routingDescription} onChange={(e) => setDescription(m.agentId, e.target.value)} placeholder="No que este membro ajuda (ex: pesquisa de fontes)" className={inputCls} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {availableAgents.length > 0 && (
            <select value="" onChange={(e) => { addMember(e.target.value); e.target.value = '' }} className={inputCls}>
              <option value="">+ Adicionar agente</option>
              {availableAgents.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Orchestrated: coordinator + instruction + contracts */}
      {editMode === 'orchestrated' && (
        <>
          <div>
            <label className="mb-1 block text-sm text-(--text-muted)">Coordenador {managerRecommended.length > 0 && <span className="text-(--text-faint)">(um gerente é recomendado)</span>}</label>
            <select value={coordinatorAgentId} onChange={(e) => setCoordinatorAgentId(e.target.value)} className={inputCls}>
              <option value="">Escolher coordenador…</option>
              {members.map((m) => (
                <option key={m.agentId} value={m.agentId}>
                  {agentNameById.get(m.agentId) ?? 'Agente'}
                  {agents.find((a) => a._id === m.agentId)?.preset === 'manager' ? ' — gerente' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-(--text-muted)">Instrução para a equipe (opcional)</label>
            <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={2} placeholder="Como o coordenador deve conduzir o time." className={inputCls} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">O que a equipe recebe</label>
              <input value={inputContract} onChange={(e) => setInputContract(e.target.value)} placeholder="Ex.: um pedido de conteúdo" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">O que a equipe entrega</label>
              <input value={outputContract} onChange={(e) => setOutputContract(e.target.value)} placeholder="Ex.: um texto final revisado" className={inputCls} />
            </div>
          </div>
        </>
      )}

      {/* Pipeline: contracts + stage editor + flow preview */}
      {editMode === 'pipeline' && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">Entrada do fluxo</label>
              <input value={inputContract} onChange={(e) => setInputContract(e.target.value)} placeholder="Ex.: um tema" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">Saída do fluxo</label>
              <input value={outputContract} onChange={(e) => setOutputContract(e.target.value)} placeholder="Ex.: um relatório pronto" className={inputCls} />
            </div>
          </div>

          {stages.length > 0 && (
            <div className="rounded-lg border border-(--border-subtle) bg-(--surface-sunken) p-2 text-xs text-(--text-muted)">
              Fluxo: {stages.map((s, i) => `${i + 1}. ${s.name || agentNameById.get(s.agentId) || 'Etapa'}`).join('  →  ')}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Etapas</p>
            {stages.length === 0 ? <p className="text-sm text-(--text-muted)">Adicione as etapas do fluxo, na ordem.</p> : null}
            <ul className="space-y-2">
              {stages.map((s, index) => (
                <li key={s.key} className="rounded-lg border border-(--border-subtle) p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-(--text-faint)">{index + 1}.</span>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => moveStage(index, -1)} disabled={index === 0} className="rounded border border-(--border-strong) px-1.5 text-xs disabled:opacity-30" aria-label="Subir">↑</button>
                      <button type="button" onClick={() => moveStage(index, 1)} disabled={index === stages.length - 1} className="rounded border border-(--border-strong) px-1.5 text-xs disabled:opacity-30" aria-label="Descer">↓</button>
                      <button type="button" onClick={() => removeStage(s.key)} className="ml-2 text-xs text-(--coral-600) underline">Remover</button>
                    </div>
                  </div>
                  <input value={s.name} onChange={(e) => patchStage(s.key, { name: e.target.value })} placeholder="Nome da etapa (ex: Coleta)" className={inputCls} />
                  <select value={s.agentId} onChange={(e) => patchStage(s.key, { agentId: e.target.value })} className={inputCls}>
                    <option value="">Escolher agente…</option>
                    {agents.map((a) => (
                      <option key={a._id} value={a._id}>{a.name}</option>
                    ))}
                  </select>
                  <input value={s.instruction} onChange={(e) => patchStage(s.key, { instruction: e.target.value })} placeholder="O que esta etapa faz" className={inputCls} />
                  {index > 0 && (
                    <div>
                      <label className="mb-1 block text-xs text-(--text-faint)">Usa o resultado de</label>
                      <div className="flex flex-wrap gap-1.5">
                        {stages.slice(0, index).map((prev, pi) => {
                          const pid = effectiveStageId(stages, pi)
                          const on = s.dependsOn.includes(pid)
                          return (
                            <button key={prev.key} type="button" onClick={() => patchStage(s.key, { dependsOn: on ? s.dependsOn.filter((d) => d !== pid) : [...s.dependsOn, pid] })} className={`rounded border px-2 py-1 text-xs ${on ? 'border-(--intent-brand) bg-(--surface-sunken)' : 'border-(--border-strong)'}`}>
                              {prev.name || `Etapa ${pi + 1}`}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-(--text-muted)">
                      Se falhar:
                      <select value={s.onError} onChange={(e) => patchStage(s.key, { onError: e.target.value as 'stop' | 'continue' })} className="rounded border border-(--border-strong) bg-(--surface-card) px-2 py-1 text-xs">
                        <option value="stop">parar o fluxo</option>
                        <option value="continue">seguir para a próxima</option>
                      </select>
                    </label>
                  </div>
                </li>
              ))}
            </ul>
            <select value="" onChange={(e) => { addStage(e.target.value); e.target.value = '' }} className={inputCls}>
              <option value="">+ Adicionar etapa</option>
              {agents.map((a) => (
                <option key={a._id} value={a._id}>{a.name}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {editError && <p className="text-sm text-(--coral-600)">{editError}</p>}

      <div className="flex justify-end border-t border-(--border-subtle) pt-4">
        <button type="submit" disabled={saving} className="rounded-lg bg-(--intent-brand) px-5 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover) disabled:opacity-50">
          {isCreating ? (saving ? 'Criando...' : 'Criar setor') : saving ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </div>
    </form>
  )
}
