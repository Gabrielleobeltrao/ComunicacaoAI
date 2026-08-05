import { useState } from 'react'
import { Link } from 'react-router'
import type { AgentSummary, TeamSummary } from '../lib/types'
import { Modal } from './Modal'
import { TeamForm } from './TeamForm'

interface TeamManagerProps {
  teams: TeamSummary[]
  loading: boolean
  agents: AgentSummary[]
  agentsLoading: boolean
  onChange: () => void | Promise<void>
}

export function TeamManager({ teams, loading, agents, agentsLoading, onChange }: TeamManagerProps) {
  const [isCreating, setIsCreating] = useState(false)

  const agentNameById = new Map(agents.map((a) => [a._id, a.name]))

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
            <li key={team._id}>
              <Link
                to={`/teams/${team._id}`}
                className="block rounded-lg border border-slate-800 p-3 transition hover:border-slate-600"
              >
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{team.name}</p>
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
    </div>
  )
}
