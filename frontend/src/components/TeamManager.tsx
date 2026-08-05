import { useState } from 'react'
import { Link } from 'react-router'
import { API_URL } from '../lib/api'
import type { AgentSummary, TeamSummary } from '../lib/types'
import { Modal } from './Modal'
import { TeamForm } from './TeamForm'
import { TeamPlayground } from './TeamPlayground'

interface TeamManagerProps {
  teams: TeamSummary[]
  loading: boolean
  agents: AgentSummary[]
  agentsLoading: boolean
  onChange: () => void | Promise<void>
}

export function TeamManager({ teams, loading, agents, agentsLoading, onChange }: TeamManagerProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [playgroundTeam, setPlaygroundTeam] = useState<TeamSummary | null>(null)
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const agentNameById = new Map(agents.map((a) => [a._id, a.name]))

  async function handleDeleteTeam(team: TeamSummary) {
    if (deletingTeamId) return
    if (!window.confirm(`Excluir a equipe "${team.name}"? Essa ação não pode ser desfeita.`)) return
    setListError(null)
    setDeletingTeamId(team._id)

    try {
      const res = await fetch(`${API_URL}/api/teams/${team._id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null)
        setListError(body?.error ?? 'Não foi possível excluir a equipe.')
        return
      }
      await onChange()
    } finally {
      setDeletingTeamId(null)
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setIsCreating(true)}
        disabled={agentsLoading}
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
      >
        + Nova equipe
      </button>

      {listError && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {listError}
        </p>
      )}

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
              <Link to={`/teams/${team._id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium transition hover:text-slate-300">{team.name}</p>
                  <span className="shrink-0 rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                    {team.mode === 'pipeline' ? 'Fluxo' : 'Adaptativo'}
                  </span>
                </div>
                <p className="truncate text-sm text-slate-400">
                  {team.mode === 'pipeline'
                    ? team.members.map((m) => agentNameById.get(m.agentId) ?? 'removido').join(' → ')
                    : `${team.members.length} agente${team.members.length === 1 ? '' : 's'}: ${team.members
                        .map((m) => agentNameById.get(m.agentId) ?? 'removido')
                        .join(', ')}`}
                </p>
              </Link>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setPlaygroundTeam(team)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800"
                >
                  Testar
                </button>
                <Link
                  to={`/teams/${team._id}`}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800"
                >
                  Abrir
                </Link>
                <button
                  type="button"
                  onClick={() => handleDeleteTeam(team)}
                  disabled={deletingTeamId === team._id}
                  className="rounded-lg border border-red-500/40 px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
                >
                  {deletingTeamId === team._id ? 'Excluindo...' : 'Excluir'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={isCreating} onClose={() => setIsCreating(false)} title="Nova equipe" wide>
        <TeamForm
          team={null}
          agents={agents}
          onSaved={async () => {
            setIsCreating(false)
            await onChange()
          }}
        />
      </Modal>

      <Modal
        open={playgroundTeam !== null}
        onClose={() => setPlaygroundTeam(null)}
        title={playgroundTeam ? `Testar: ${playgroundTeam.name}` : 'Testar equipe'}
        wide
      >
        {playgroundTeam && <TeamPlayground key={playgroundTeam._id} team={playgroundTeam} />}
      </Modal>
    </div>
  )
}
