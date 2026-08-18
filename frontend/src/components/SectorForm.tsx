import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import { DEFAULT_SECTOR_COLOR, SECTOR_COLORS } from '../lib/sectorColors'
import { SECTOR_MODE_LABEL, normalizeSectorMode, sectorReadiness } from '../lib/sectors'
import { Dialog } from '../ui/Dialog'
import { HireWizard } from './HireWizard'
import type { AgentPreset, AgentSummary, SectorMode, SectorSummary } from '../lib/types'

// A sector is a TEAM (never a schedule). Three ways it can work, named after what
// the team DOES (SECTOR_MODE_LABEL) instead of jargon. Creating goes through three
// guided steps; editing shows the same sections stacked, so nothing is buried.

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

const MODES: { value: SectorMode; example: string }[] = [
  { value: 'organization', example: 'Ex.: agrupar “Salão” no mapa, sem executar como equipe.' },
  { value: 'orchestrated', example: 'Ex.: um gerente recebe o pedido, aciona quem precisa e junta tudo.' },
  { value: 'pipeline', example: 'Ex.: coletar → analisar → escrever, cada etapa usando o resultado da anterior.' },
]

// The role we suggest when the user hires straight from the sector.
const RECOMMENDED_PRESET: Record<'coordinator' | 'member' | 'stage', AgentPreset> = {
  coordinator: 'manager',
  member: 'operator',
  stage: 'operator',
}

const inputCls = 'w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)'

interface SectorFormProps {
  sector: SectorSummary | null
  agents: AgentSummary[]
  floorId?: string
  onSaved: () => void
  // Reload the agent list after a contextual hire (the parent owns it).
  onAgentsChanged?: () => void | Promise<void>
  sectors?: SectorSummary[]
}

export function SectorForm({ sector, agents, floorId, onSaved, onAgentsChanged, sectors = [] }: SectorFormProps) {
  const isCreating = sector === null
  const [step, setStep] = useState(0)
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
  // Contextual hiring: which slot asked for a new agent.
  const [hiringFor, setHiringFor] = useState<{ slot: 'coordinator' | 'member' | 'stage'; stageKey?: string } | null>(null)

  useEffect(() => {
    setEditError(null)
    setSaving(false)
    setStep(0)
    if (sector) {
      setEditName(sector.name)
      setEditColor(sector.color ?? DEFAULT_SECTOR_COLOR)
      setEditMode(normalizeSectorMode(sector.mode))
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

  const agentById = useMemo(() => new Map(agents.map((a) => [a._id, a])), [agents])
  const agentNameById = useMemo(() => new Map(agents.map((a) => [a._id, a.name])), [agents])
  const memberIds = new Set(members.map((m) => m.agentId))
  const availableAgents = agents.filter((a) => !memberIds.has(a._id))

  // ----- members (organization / orchestrated) -----
  const addMember = (agentId: string) => {
    if (!agentId) return
    setMembers((prev) => (prev.some((m) => m.agentId === agentId) ? prev : [...prev, { agentId, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: prev.length === 0 }]))
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

  // The SAME rule the backend enforces — the user sees what is missing while
  // editing, not only after pressing save.
  const readiness = sectorReadiness({
    mode: editMode,
    members: editMode === 'pipeline' ? [] : members,
    coordinatorAgentId: coordinatorAgentId || null,
    stages: stages.map((s, i) => ({ id: effectiveStageId(stages, i), name: s.name, agentId: s.agentId })),
    knownAgentIds: agents.map((a) => a._id),
  })

  // A new agent hired from inside the sector lands straight in the slot that asked
  // for it — no going back to the agent list to wire it up by hand.
  async function handleHired(created?: { _id: string; name: string }) {
    const target = hiringFor
    setHiringFor(null)
    if (onAgentsChanged) await onAgentsChanged()
    if (!created || !target) return
    if (target.slot === 'stage' && target.stageKey) patchStage(target.stageKey, { agentId: created._id })
    else if (target.slot === 'stage') addStage(created._id)
    else {
      addMember(created._id)
      if (target.slot === 'coordinator') setCoordinatorAgentId(created._id)
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setEditError(null)
    if (!editName.trim()) return setEditError('Dê um nome ao setor.')
    if (!readiness.ready) return setEditError(readiness.issues.find((i) => i.severity === 'blocking')?.message ?? 'Configuração incompleta.')

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
      // `members` NÃO é enviado: num pipeline quem está nas etapas é quem está no setor,
      // e o servidor deriva a lista. Mandar `[]` daqui — que era o que acontecia — zerava
      // os agentes de toda a interface (contagem, lista, mapa, página do agente) e ainda
      // fazia a regra de "um agente, um setor" checar contra uma lista vazia.
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

  // ---------------------------------------------------------------- sections
  const identitySection = (
    <div className="space-y-4" data-testid="sector-step-identity">
      <div>
        <label htmlFor="sector-name" className="mb-1 block text-sm text-(--text-muted)">Nome da equipe</label>
        <input id="sector-name" value={editName} onChange={(e) => setEditName(e.target.value)} required autoFocus placeholder="Ex: Atendimento do salão" className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-sm text-(--text-muted)">Cor do setor (base da sala no mapa)</label>
        <div className="flex flex-wrap gap-2">
          {SECTOR_COLORS.map((c) => (
            <button key={c.value} type="button" onClick={() => setEditColor(c.value)} title={c.name} aria-label={c.name} className="h-8 w-8 rounded-full transition" style={{ background: c.value, outline: editColor === c.value ? '2px solid var(--text-heading)' : '2px solid transparent', outlineOffset: 2 }} />
          ))}
        </div>
      </div>
    </div>
  )

  const modeSection = (
    <div data-testid="sector-step-mode">
      <label className="mb-1 block text-sm text-(--text-muted)">O que esta equipe faz</label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {MODES.map((m) => (
          <button key={m.value} type="button" data-testid={`sector-mode-${m.value}`} aria-pressed={editMode === m.value} onClick={() => setEditMode(m.value)} className={`rounded-lg border p-3 text-left text-sm transition ${editMode === m.value ? 'border-(--intent-brand) bg-(--surface-sunken)' : 'border-(--border-strong)'}`}>
            <span className="font-medium">{SECTOR_MODE_LABEL[m.value].title}</span>
            <span className="mt-1 block text-xs text-(--text-muted)">{m.example}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-(--text-faint)">{SECTOR_MODE_LABEL[editMode].help}</p>
    </div>
  )

  const teamSection = (
    <div className="space-y-4" data-testid="sector-step-team">
      {/* Organization / Orchestrated: the team roster */}
      {editMode !== 'pipeline' && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Quem faz parte</p>
          {members.length === 0 ? (
            <p className="text-sm text-(--text-muted)">Adicione os agentes que fazem parte desta equipe.</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.agentId} className="rounded-lg border border-(--border-subtle) p-3" data-testid="sector-member-row">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {agentNameById.get(m.agentId) ?? 'Agente'}
                      {coordinatorAgentId === m.agentId ? <span className="ml-1.5 text-xs text-(--text-faint)">· coordenador</span> : null}
                    </span>
                    <button type="button" onClick={() => removeMember(m.agentId)} className="text-xs text-(--coral-600) underline">
                      Remover
                    </button>
                  </div>
                  {editMode === 'orchestrated' && (
                    <input value={m.routingDescription} onChange={(e) => setDescription(m.agentId, e.target.value)} placeholder="No que este membro ajuda (ex: reservas)" className={inputCls} />
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {availableAgents.length > 0 && (
              <select value="" onChange={(e) => { addMember(e.target.value); e.target.value = '' }} className={`${inputCls} sm:flex-1`}>
                <option value="">+ Adicionar agente</option>
                {availableAgents.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
            <button type="button" onClick={() => setHiringFor({ slot: 'member' })} className="rounded-lg border border-(--border-strong) px-3 py-2 text-xs" data-testid="hire-for-member">
              Contratar agente
            </button>
          </div>
        </div>
      )}

      {/* Orchestrated: coordinator + instruction + contracts */}
      {editMode === 'orchestrated' && (
        <>
          <div>
            <label htmlFor="sector-coordinator" className="mb-1 block text-sm text-(--text-muted)">Quem coordena <span className="text-(--text-faint)">(um gerente é recomendado)</span></label>
            <div className="flex flex-wrap items-center gap-2">
              <select id="sector-coordinator" value={coordinatorAgentId} onChange={(e) => setCoordinatorAgentId(e.target.value)} className={`${inputCls} sm:flex-1`} data-testid="coordinator-picker">
                <option value="">Escolher coordenador…</option>
                {members.map((m) => (
                  <option key={m.agentId} value={m.agentId}>
                    {agentNameById.get(m.agentId) ?? 'Agente'}
                    {agentById.get(m.agentId)?.preset === 'manager' ? ' — gerente' : ''}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setHiringFor({ slot: 'coordinator' })} className="rounded-lg border border-(--border-strong) px-3 py-2 text-xs" data-testid="hire-for-coordinator">
                Contratar gerente
              </button>
            </div>
            {coordinatorAgentId && agentById.get(coordinatorAgentId)?.preset !== 'manager' && (
              // A warning, never a block: the coordinator reaches the members through
              // the sector context, whatever its own preset is.
              <p className="mt-1 text-xs text-(--mango-700)" data-testid="coordinator-warning">
                Este agente não é um gerente. Ele vai funcionar, mas um gerente costuma coordenar melhor.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm text-(--text-muted)">Instrução para a equipe (opcional)</label>
            <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={2} placeholder="Como o coordenador deve conduzir o time." className={inputCls} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">O que a equipe recebe</label>
              <input value={inputContract} onChange={(e) => setInputContract(e.target.value)} placeholder="Ex.: um pedido de reserva" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">O que a equipe entrega</label>
              <input value={outputContract} onChange={(e) => setOutputContract(e.target.value)} placeholder="Ex.: a mesa confirmada" className={inputCls} />
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
              <input value={inputContract} onChange={(e) => setInputContract(e.target.value)} placeholder="Ex.: um pedido do cliente" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">Saída do fluxo</label>
              <input value={outputContract} onChange={(e) => setOutputContract(e.target.value)} placeholder="Ex.: o pedido pronto na cozinha" className={inputCls} />
            </div>
          </div>

          {stages.length > 0 && (
            <div className="rounded-lg border border-(--border-subtle) bg-(--surface-sunken) p-2 text-xs text-(--text-muted)" data-testid="stage-flow-preview">
              Entrada → {stages.map((s, i) => `${i + 1}. ${s.name || agentNameById.get(s.agentId) || 'Etapa'}`).join('  →  ')} → Saída
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Etapas, na ordem</p>
            {stages.length === 0 ? <p className="text-sm text-(--text-muted)">Adicione as etapas do fluxo, na ordem em que acontecem.</p> : null}
            <ul className="space-y-2">
              {stages.map((s, index) => (
                <li key={s.key} className="rounded-lg border border-(--border-subtle) p-3 space-y-2" data-testid="stage-row">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-(--text-faint)">{index + 1}.</span>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => moveStage(index, -1)} disabled={index === 0} className="rounded border border-(--border-strong) px-1.5 text-xs disabled:opacity-30" aria-label="Subir">↑</button>
                      <button type="button" onClick={() => moveStage(index, 1)} disabled={index === stages.length - 1} className="rounded border border-(--border-strong) px-1.5 text-xs disabled:opacity-30" aria-label="Descer">↓</button>
                      <button type="button" onClick={() => removeStage(s.key)} className="ml-2 text-xs text-(--coral-600) underline">Remover</button>
                    </div>
                  </div>
                  <input value={s.name} onChange={(e) => patchStage(s.key, { name: e.target.value })} placeholder="Nome da etapa (ex: Anotar pedido)" className={inputCls} />
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={s.agentId} onChange={(e) => patchStage(s.key, { agentId: e.target.value })} className={`${inputCls} sm:flex-1`}>
                      <option value="">Escolher agente…</option>
                      {agents.map((a) => (
                        <option key={a._id} value={a._id}>{a.name}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => setHiringFor({ slot: 'stage', stageKey: s.key })} className="rounded-lg border border-(--border-strong) px-3 py-2 text-xs" data-testid="hire-for-stage">
                      Contratar agente para esta etapa
                    </button>
                  </div>
                  <input value={s.instruction} onChange={(e) => patchStage(s.key, { instruction: e.target.value })} placeholder="O que esta etapa faz" className={inputCls} />
                  {index > 0 && (
                    // By default a stage uses the previous one. Anything else is
                    // advanced, so it stays collapsed.
                    <details>
                      <summary className="cursor-pointer text-xs text-(--text-faint)">Avançado: de onde vem a informação</summary>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                    </details>
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
    </div>
  )

  const issuesPanel = readiness.issues.length > 0 && (
    <ul className="space-y-1 rounded-lg border border-(--border-subtle) bg-(--surface-sunken) p-3" data-testid="sector-readiness">
      {readiness.issues.map((i, idx) => (
        <li key={`${i.code}-${idx}`} className={`text-xs ${i.severity === 'blocking' ? 'text-(--coral-600)' : 'text-(--mango-700)'}`}>
          {i.message}
        </li>
      ))}
    </ul>
  )

  const hireDialog = (
    <Dialog open={hiringFor !== null} onClose={() => setHiringFor(null)} title="Contratar agente" width={680}>
      {hiringFor && (
        <HireWizard
          floorId={floorId ?? sector?.floorId ?? undefined}
          agents={agents}
          sectors={sectors}
          initialPreset={RECOMMENDED_PRESET[hiringFor.slot]}
          initialSectorId={sector?._id}
          onCancel={() => setHiringFor(null)}
          onHired={handleHired}
        />
      )}
    </Dialog>
  )

  // Editing: everything at once. Creating: three guided steps.
  if (!isCreating) {
    return (
      <>
        <form onSubmit={handleSave} className="space-y-4">
          {identitySection}
          {modeSection}
          {teamSection}
          {issuesPanel}
          {editError && <p className="text-sm text-(--coral-600)">{editError}</p>}
          <div className="flex justify-end border-t border-(--border-subtle) pt-4">
            <button type="submit" disabled={saving} className="rounded-lg bg-(--intent-brand) px-5 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover) disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </form>
        {hireDialog}
      </>
    )
  }

  const STEPS = ['A equipe', 'O que ela faz', 'Quem trabalha nela']
  const canAdvance = step === 0 ? editName.trim().length > 0 : true

  return (
    <>
      <form onSubmit={handleSave} className="space-y-4" data-testid="sector-wizard">
        <ol className="flex flex-wrap gap-2 text-xs">
          {STEPS.map((label, i) => (
            <li key={label} className={`rounded-full px-2.5 py-1 ${i === step ? 'bg-(--surface-sunken) font-semibold text-(--text-heading)' : 'text-(--text-faint)'}`}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>

        {step === 0 && identitySection}
        {step === 1 && modeSection}
        {step === 2 && (
          <>
            {teamSection}
            {issuesPanel}
          </>
        )}

        {editError && <p className="text-sm text-(--coral-600)">{editError}</p>}

        <div className="flex justify-between border-t border-(--border-subtle) pt-4">
          <button type="button" onClick={() => setStep((s) => s - 1)} disabled={step === 0} className="rounded-lg border border-(--border-strong) px-4 py-2 text-sm disabled:opacity-30">
            Voltar
          </button>
          {step < 2 ? (
            <button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canAdvance} className="rounded-lg bg-(--intent-brand) px-5 py-2 text-sm font-medium text-white disabled:opacity-50" data-testid="sector-next">
              Continuar
            </button>
          ) : (
            <button type="submit" disabled={saving} className="rounded-lg bg-(--intent-brand) px-5 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover) disabled:opacity-50">
              {saving ? 'Criando...' : 'Criar equipe'}
            </button>
          )}
        </div>
      </form>
      {hireDialog}
    </>
  )
}
