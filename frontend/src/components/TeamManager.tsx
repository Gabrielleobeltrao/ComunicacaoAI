import { useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { AgentSummary, TeamMode, TeamSummary } from '../lib/types'
import { MessageContent } from './MessageContent'
import { Modal } from './Modal'

interface TeamManagerProps {
  teams: TeamSummary[]
  loading: boolean
  agents: AgentSummary[]
  agentsLoading: boolean
  onChange: () => void | Promise<void>
}

interface EditTransition {
  condition: string
  targetAgentId: string
}

interface EditMember {
  agentId: string
  routingDescription: string
  advanceWhen: string
  transitions: EditTransition[]
  isDefault: boolean
}

interface PlayMessage {
  role: 'user' | 'assistant'
  content: string
  specialists?: string[]
  clarify?: boolean
  stage?: string | null
  advanced?: boolean
  fromStage?: string | null
  mode?: TeamMode
}

export function TeamManager({ teams, loading, agents, agentsLoading, onChange }: TeamManagerProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [editingTeam, setEditingTeam] = useState<TeamSummary | null>(null)
  const [editName, setEditName] = useState('')
  const [editMode, setEditMode] = useState<TeamMode>('adaptive')
  const [editMembers, setEditMembers] = useState<EditMember[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [playgroundTeam, setPlaygroundTeam] = useState<TeamSummary | null>(null)
  const [playMessages, setPlayMessages] = useState<PlayMessage[]>([])
  const [playInput, setPlayInput] = useState('')
  const [playSending, setPlaySending] = useState(false)
  const [playStageIndex, setPlayStageIndex] = useState(0)

  const agentNameById = new Map(agents.map((a) => [a._id, a.name]))
  const open = isCreating || editingTeam !== null
  const isPipeline = editMode === 'pipeline'

  function openPlayground(team: TeamSummary) {
    setPlaygroundTeam(team)
    setPlayMessages([])
    setPlayInput('')
    setPlayStageIndex(0)
  }

  async function handlePlaygroundSend(event: FormEvent) {
    event.preventDefault()
    if (!playgroundTeam || !playInput.trim() || playSending) return
    const next: PlayMessage[] = [...playMessages, { role: 'user', content: playInput.trim() }]
    setPlayMessages(next)
    setPlayInput('')
    setPlaySending(true)
    try {
      const res = await fetch(`${API_URL}/api/teams/${playgroundTeam._id}/playground`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
          stageIndex: playStageIndex,
        }),
      })
      if (res.ok) {
        const body = await res.json()
        if (typeof body.stageIndex === 'number') setPlayStageIndex(body.stageIndex)
        setPlayMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: body.reply,
            specialists: body.specialists,
            clarify: body.clarify,
            stage: body.stage,
            advanced: body.advanced,
            fromStage: body.fromStage,
            mode: body.mode,
          },
        ])
      } else {
        setPlayMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: 'Não foi possível gerar a resposta — verifique a chave de API em Configurações.',
          },
        ])
      }
    } finally {
      setPlaySending(false)
    }
  }

  function openCreate() {
    setIsCreating(true)
    setEditingTeam(null)
    setEditName('')
    setEditMode('adaptive')
    setEditMembers([])
    setEditError(null)
  }

  function openEdit(team: TeamSummary) {
    setIsCreating(false)
    setEditingTeam(team)
    setEditName(team.name)
    setEditMode(team.mode)
    setEditMembers(
      team.members.map((m) => ({ ...m, transitions: (m.transitions ?? []).map((t) => ({ ...t })) })),
    )
    setEditError(null)
  }

  function close() {
    setIsCreating(false)
    setEditingTeam(null)
  }

  const usedAgentIds = new Set(editMembers.map((m) => m.agentId))
  const availableAgents = agents.filter((a) => !usedAgentIds.has(a._id))

  function addMember(agentId: string) {
    if (!agentId) return
    setEditMembers((prev) => [
      ...prev,
      { agentId, routingDescription: '', advanceWhen: '', transitions: [], isDefault: prev.length === 0 },
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
          : 'Uma equipe precisa de pelo menos 2 agentes para o orquestrador fazer sentido.',
      )
      return
    }
    setSaving(true)
    const body = JSON.stringify({
      name: editName,
      mode: editMode,
      members: editMembers.map((m) => ({
        agentId: m.agentId,
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
        ? await fetch(`${API_URL}/api/teams`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body,
          })
        : await fetch(`${API_URL}/api/teams/${editingTeam?._id}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body,
          })
      if (!res.ok) {
        setEditError('Não foi possível salvar a equipe.')
        return
      }
      close()
      await onChange()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editingTeam) return
    setDeleting(true)
    try {
      const res = await fetch(`${API_URL}/api/teams/${editingTeam._id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        close()
        await onChange()
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={openCreate}
        disabled={agentsLoading}
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
      >
        + Nova equipe
      </button>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando equipes...</p>
      ) : teams.length === 0 ? (
        <p className="text-sm text-slate-400">
          Nenhuma equipe ainda. Uma equipe junta vários agentes especialistas — no modo adaptativo um
          orquestrador consulta os que fazem sentido em cada mensagem; no modo fluxo, o atendimento passa
          por etapas em sequência. Sempre com uma voz única para o visitante.
        </p>
      ) : (
        <ul className="space-y-3">
          {teams.map((team) => (
            <li
              key={team._id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 p-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{team.name}</p>
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                    {team.mode === 'pipeline' ? 'Fluxo' : 'Adaptativo'}
                  </span>
                </div>
                <p className="text-sm text-slate-400">
                  {team.mode === 'pipeline'
                    ? team.members.map((m) => agentNameById.get(m.agentId) ?? 'removido').join(' → ')
                    : `${team.members.length} agente${team.members.length === 1 ? '' : 's'}: ${team.members
                        .map((m) => agentNameById.get(m.agentId) ?? 'removido')
                        .join(', ')}`}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => openPlayground(team)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800"
                >
                  Testar
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(team)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800"
                >
                  Editar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={close} title={isCreating ? 'Nova equipe' : 'Editar equipe'} wide>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400">Nome da equipe</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
              autoFocus
              placeholder="Ex: Atendimento da barbearia"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-400">Modo de orquestração</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setEditMode('adaptive')}
                className={`rounded-lg border p-3 text-left text-sm transition ${
                  editMode === 'adaptive'
                    ? 'border-slate-400 bg-slate-800'
                    : 'border-slate-700 hover:border-slate-600'
                }`}
              >
                <span className="font-medium">Adaptativo</span>
                <span className="mt-1 block text-xs text-slate-400">
                  Um supervisor consulta, a cada mensagem, os especialistas que têm a informação.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setEditMode('pipeline')}
                className={`rounded-lg border p-3 text-left text-sm transition ${
                  editMode === 'pipeline'
                    ? 'border-slate-400 bg-slate-800'
                    : 'border-slate-700 hover:border-slate-600'
                }`}
              >
                <span className="font-medium">Fluxo (pipeline)</span>
                <span className="mt-1 block text-xs text-slate-400">
                  Etapas em sequência: cada agente cuida de uma parte e passa para a próxima.
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">{isPipeline ? 'Etapas do fluxo' : 'Agentes da equipe'}</p>
            <p className="text-xs text-slate-500">
              {isPipeline
                ? 'As etapas são executadas na ordem abaixo. Descreva o que cada etapa faz e quando ela deve passar para a próxima. Marque uma etapa como padrão (voz, memória e configurações compartilhadas).'
                : 'Descreva quando cada agente deve ser usado — é o que o orquestrador lê para decidir quais consultar. Marque um como padrão (voz da equipe e fallback para mensagens ambíguas).'}
            </p>

            {editMembers.length === 0 ? (
              <p className="text-sm text-slate-400">Adicione pelo menos 2 {isPipeline ? 'etapas' : 'agentes'}.</p>
            ) : (
              <ul className="space-y-2">
                {editMembers.map((m, index) => (
                  <li key={m.agentId} className="rounded-lg border border-slate-800 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {isPipeline && <span className="text-slate-500">{index + 1}. </span>}
                        {agentNameById.get(m.agentId) ?? 'Agente'}
                      </span>
                      <div className="flex items-center gap-3">
                        {isPipeline && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveMember(index, -1)}
                              disabled={index === 0}
                              className="rounded border border-slate-700 px-1.5 text-xs text-slate-400 transition hover:bg-slate-800 disabled:opacity-30"
                              aria-label="Subir etapa"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveMember(index, 1)}
                              disabled={index === editMembers.length - 1}
                              className="rounded border border-slate-700 px-1.5 text-xs text-slate-400 transition hover:bg-slate-800 disabled:opacity-30"
                              aria-label="Descer etapa"
                            >
                              ↓
                            </button>
                          </div>
                        )}
                        <label className="flex items-center gap-1.5 text-xs text-slate-400">
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
                          className="text-xs text-red-400 underline transition hover:text-red-300"
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                    <input
                      value={m.routingDescription}
                      onChange={(e) => setDescription(m.agentId, e.target.value)}
                      placeholder={
                        isPipeline
                          ? 'O que esta etapa faz (ex: qualificar o lead e coletar requisitos)'
                          : 'Quando usar este agente (ex: reservas, horários e disponibilidade)'
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
                    />
                    {isPipeline &&
                      (index === editMembers.length - 1 ? (
                        <p className="mt-1.5 text-xs text-slate-600">
                          Última etapa — encerra o fluxo (mas ainda pode ter desvios abaixo).
                        </p>
                      ) : (
                        <input
                          value={m.advanceWhen}
                          onChange={(e) => setAdvanceWhen(m.agentId, e.target.value)}
                          placeholder="Quando avançar para a próxima etapa (ex: quando já tiver data e nº de pessoas)"
                          className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
                        />
                      ))}
                    {isPipeline && (
                      <div className="mt-2 rounded-lg border border-slate-800/70 bg-slate-950/40 p-2">
                        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          Desvios (opcional)
                        </p>
                        {m.transitions.length === 0 ? (
                          <p className="text-xs text-slate-600">
                            Pule, ramifique ou volte para outra etapa quando uma condição acontecer.
                          </p>
                        ) : (
                          <ul className="space-y-1.5">
                            {m.transitions.map((t, ti) => (
                              <li key={ti} className="flex items-center gap-1.5">
                                <span className="shrink-0 text-xs text-slate-500">Se</span>
                                <input
                                  value={t.condition}
                                  onChange={(e) => setTransitionCondition(m.agentId, ti, e.target.value)}
                                  placeholder="ex: o grupo tiver mais de 8 pessoas"
                                  className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs outline-none focus:border-slate-500"
                                />
                                <span className="shrink-0 text-xs text-slate-400">
                                  → {agentNameById.get(t.targetAgentId) ?? 'etapa'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeTransition(m.agentId, ti)}
                                  className="shrink-0 px-1 text-sm text-red-400 transition hover:text-red-300"
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
                            className="mt-1.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs outline-none focus:border-slate-500"
                          >
                            <option value="">+ Adicionar desvio para outra etapa</option>
                            {editMembers
                              .filter(
                                (o) =>
                                  o.agentId !== m.agentId &&
                                  !m.transitions.some((t) => t.targetAgentId === o.agentId),
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
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
              >
                <option value="">+ Adicionar {isPipeline ? 'etapa' : 'agente à equipe'}</option>
                {availableAgents.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {editError && <p className="text-sm text-red-400">{editError}</p>}

          <div className="flex items-center justify-between gap-2">
            {!isCreating ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg border border-red-900 px-4 py-2 text-sm text-red-400 transition hover:bg-red-950 disabled:opacity-50"
              >
                {deleting ? 'Excluindo...' : 'Excluir equipe'}
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
            >
              {isCreating ? (saving ? 'Criando...' : 'Criar equipe') : saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={playgroundTeam !== null}
        onClose={() => setPlaygroundTeam(null)}
        title={playgroundTeam ? `Testar: ${playgroundTeam.name}` : 'Testar equipe'}
        wide
      >
        <p className="mb-3 text-xs text-slate-500">
          {playgroundTeam?.mode === 'pipeline'
            ? 'Conversa de teste — nada é salvo. Cada resposta mostra em qual etapa do fluxo o atendimento está.'
            : 'Conversa de teste — nada é salvo. Cada resposta mostra quais especialistas o orquestrador consultou.'}
        </p>
        <div className="flex h-96 flex-col rounded-lg border border-slate-800 bg-slate-950/50">
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {playMessages.length === 0 && (
              <p className="text-sm text-slate-400">Envie uma mensagem como se fosse o visitante.</p>
            )}
            {playMessages.map((message, index) => (
              <div key={index} className={message.role === 'user' ? '' : 'flex flex-col items-start'}>
                <div
                  className={
                    message.role === 'user'
                      ? 'ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-white px-3 py-2 text-sm text-slate-950'
                      : 'max-w-[85%] rounded-2xl rounded-tl-sm bg-slate-800 px-3 py-2 text-sm'
                  }
                >
                  <MessageContent content={message.content} />
                </div>
                {message.role === 'assistant' && (
                  <span className="mt-0.5 text-[10px] text-slate-500">
                    {message.mode === 'pipeline'
                      ? message.advanced && message.fromStage
                        ? `↳ ${message.fromStage} → ${message.stage ?? '—'}`
                        : `↳ etapa: ${message.stage ?? '—'}`
                      : message.clarify
                        ? '↳ pediu esclarecimento'
                        : message.specialists && message.specialists.length > 0
                          ? `↳ consultou: ${message.specialists.join(', ')}`
                          : ''}
                  </span>
                )}
              </div>
            ))}
            {playSending && <p className="text-sm text-slate-500">Orquestrando...</p>}
          </div>
          <form onSubmit={handlePlaygroundSend} className="flex gap-2 border-t border-slate-800 p-3">
            <input
              value={playInput}
              onChange={(e) => setPlayInput(e.target.value)}
              placeholder="Mensagem do visitante..."
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            <button
              type="submit"
              disabled={playSending || !playInput.trim()}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
            >
              Enviar
            </button>
          </form>
        </div>
      </Modal>
    </div>
  )
}
