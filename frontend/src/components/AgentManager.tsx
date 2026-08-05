import { useState } from 'react'
import { Link } from 'react-router'
import type { AgentSummary } from '../lib/types'
import { AgentForm } from './AgentForm'
import { Modal } from './Modal'

interface AgentManagerProps {
  agents: AgentSummary[]
  loading: boolean
  onChange: () => void | Promise<void>
}

export function AgentManager({ agents, loading, onChange }: AgentManagerProps) {
  const [isCreating, setIsCreating] = useState(false)

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setIsCreating(true)}
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
      >
        + Novo agente
      </button>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando agentes...</p>
      ) : agents.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum agente criado ainda.</p>
      ) : (
        <ul className="space-y-3">
          {agents.map((agent) => (
            <li key={agent._id}>
              <Link
                to={`/agents/${agent._id}`}
                className="block rounded-lg border border-slate-800 p-3 transition hover:border-slate-600"
              >
                <p className="font-medium">{agent.name}</p>
              </Link>
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
    </div>
  )
}
