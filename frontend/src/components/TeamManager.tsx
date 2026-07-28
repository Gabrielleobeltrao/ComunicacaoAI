import { useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { AgentSummary, TeamSummary } from '../lib/types'
import { Modal } from './Modal'

interface TeamManagerProps {
  teams: TeamSummary[]
  loading: boolean
  agents: AgentSummary[]
  agentsLoading: boolean
  onChange: () => void | Promise<void>
}

interface EditMember {
  agentId: string
  routingDescription: string
  isDefault: boolean
}

export function TeamManager({ teams, loading, agents, agentsLoading, onChange }: TeamManagerProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [editingTeam, setEditingTeam] = useState<TeamSummary | null>(null)
  const [editName, setEditName] = useState('')
  const [editMembers, setEditMembers] = useState<EditMember[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const agentNameById = new Map(agents.map((a) => [a._id, a.name]))
  const open = isCreating || editingTeam !== null

  function openCreate() {
    setIsCreating(true)
    setEditingTeam(null)
    setEditName('')
    setEditMembers([])
    setEditError(null)
  }

  function openEdit(team: TeamSummary) {
    setIsCreating(false)
    setEditingTeam(team)
    setEditName(team.name)
    setEditMembers(team.members.map((m) => ({ ...m })))
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
      { agentId, routingDescription: '', isDefault: prev.length === 0 },
    ])
  }

  function removeMember(agentId: string) {
    setEditMembers((prev) => {
      const next = prev.filter((m) => m.agentId !== agentId)
      // Keep exactly one default.
      if (next.length > 0 && !next.some((m) => m.isDefault)) next[0].isDefault = true
      return [...next]
    })
  }

  function setDescription(agentId: string, value: string) {
    setEditMembers((prev) => prev.map((m) => (m.agentId === agentId ? { ...m, routingDescription: value } : m)))
  }

  function setDefault(agentId: string) {
    setEditMembers((prev) => prev.map((m) => ({ ...m, isDefault: m.agentId === agentId })))
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setEditError(null)
    if (editMembers.length < 2) {
      setEditError('Uma equipe precisa de pelo menos 2 agentes para o roteamento fazer sentido.')
      return
    }
    setSaving(true)
    const body = JSON.stringify({
      name: editName,
      members: editMembers.map((m) => ({
        agentId: m.agentId,
        routingDescription: m.routingDescription.trim(),
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
          Nenhuma equipe ainda. Uma equipe junta vários agentes especialistas e um roteador escolhe qual
          responde cada mensagem.
        </p>
      ) : (
        <ul className="space-y-3">
          {teams.map((team) => (
            <li
              key={team._id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 p-3"
            >
              <div>
                <p className="font-medium">{team.name}</p>
                <p className="text-sm text-slate-400">
                  {team.members.length} agente{team.members.length === 1 ? '' : 's'}:{' '}
                  {team.members.map((m) => agentNameById.get(m.agentId) ?? 'removido').join(', ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openEdit(team)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800"
              >
                Editar
              </button>
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

          <div className="space-y-2">
            <p className="text-sm font-medium">Agentes da equipe</p>
            <p className="text-xs text-slate-500">
              Descreva quando cada agente deve ser usado — é o que o roteador lê para escolher quem
              responde. Marque um como padrão (fallback para mensagens ambíguas).
            </p>

            {editMembers.length === 0 ? (
              <p className="text-sm text-slate-400">Adicione pelo menos 2 agentes.</p>
            ) : (
              <ul className="space-y-2">
                {editMembers.map((m) => (
                  <li key={m.agentId} className="rounded-lg border border-slate-800 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{agentNameById.get(m.agentId) ?? 'Agente'}</span>
                      <div className="flex items-center gap-3">
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
                      placeholder="Quando usar este agente (ex: reservas, horários e disponibilidade)"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
                    />
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
                <option value="">+ Adicionar agente à equipe</option>
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
    </div>
  )
}
