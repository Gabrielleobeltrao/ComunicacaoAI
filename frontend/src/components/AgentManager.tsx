import { useState } from 'react'
import { Link } from 'react-router'
import { API_URL } from '../lib/api'
import type { AgentSummary } from '../lib/types'
import { AgentForm } from './AgentForm'
import { AgentPlayground } from './AgentPlayground'
import { Modal } from './Modal'

interface AgentManagerProps {
  agents: AgentSummary[]
  loading: boolean
  onChange: () => void | Promise<void>
}

export function AgentManager({ agents, loading, onChange }: AgentManagerProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [playgroundAgent, setPlaygroundAgent] = useState<AgentSummary | null>(null)

  async function handleDeleteAgent(agent: AgentSummary) {
    if (deletingAgentId) return
    if (
      !window.confirm(
        `Excluir o agente "${agent.name}"? Essa ação não pode ser desfeita e remove também a base de conhecimento dele.`,
      )
    ) {
      return
    }
    setDeleteError(null)
    setDeletingAgentId(agent._id)

    try {
      const res = await fetch(`${API_URL}/api/agents/${agent._id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null)
        setDeleteError(body?.error ?? 'Não foi possível excluir o agente.')
        return
      }
      await onChange()
    } finally {
      setDeletingAgentId(null)
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setIsCreating(true)}
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
      >
        + Novo agente
      </button>

      {deleteError && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {deleteError}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando agentes...</p>
      ) : agents.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum agente criado ainda.</p>
      ) : (
        <ul className="space-y-3">
          {agents.map((agent) => (
            <li
              key={agent._id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 p-3"
            >
              <Link to={`/agents/${agent._id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium transition hover:text-slate-300">{agent.name}</p>
              </Link>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setPlaygroundAgent(agent)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800"
                >
                  Testar
                </button>
                <Link
                  to={`/agents/${agent._id}`}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800"
                >
                  Abrir
                </Link>
                <button
                  type="button"
                  onClick={() => handleDeleteAgent(agent)}
                  disabled={deletingAgentId === agent._id}
                  className="rounded-lg border border-red-500/40 px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
                >
                  {deletingAgentId === agent._id ? 'Excluindo...' : 'Excluir'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={isCreating} onClose={() => setIsCreating(false)} title="Novo agente" wide>
        <AgentForm
          agent={null}
          onSaved={async () => {
            setIsCreating(false)
            await onChange()
          }}
        />
      </Modal>

      <Modal
        open={playgroundAgent !== null}
        onClose={() => setPlaygroundAgent(null)}
        title={playgroundAgent ? `Testar: ${playgroundAgent.name}` : 'Testar agente'}
        wide
      >
        {playgroundAgent && <AgentPlayground key={playgroundAgent._id} agent={playgroundAgent} />}
      </Modal>
    </div>
  )
}
