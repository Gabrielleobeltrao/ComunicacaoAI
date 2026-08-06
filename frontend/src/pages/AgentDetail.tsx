import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AgentBadges } from '../components/AgentBadges'
import { AgentForm } from '../components/AgentForm'
import { AgentPlayground } from '../components/AgentPlayground'
import { AppLayout } from '../components/AppLayout'
import { DangerZone } from '../components/DangerZone'
import { AGENT_CONFIG_SECTIONS, AGENT_SECTIONS } from '../lib/agentSections'
import { API_URL } from '../lib/api'
import type { AgentOverview } from '../lib/types'

function Metric({ label, value, suffix, hint }: { label: string; value: number; suffix?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-2xl font-semibold">
        {value.toLocaleString('pt-BR')}
        {suffix}
      </p>
      <p className="mt-1 text-sm text-slate-400">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300">{children}</span>
  )
}

function OverviewSection({ overview }: { overview: AgentOverview }) {
  const { agent, stats } = overview
  return (
    <div className="space-y-6">
      {agent.objective && <p className="max-w-3xl text-sm text-slate-400">{agent.objective}</p>}

      <section>
        <h3 className="mb-1 text-sm font-medium text-slate-400">Desempenho</h3>
        <p className="mb-3 text-xs text-slate-500">
          Métricas das conversas dos widgets que este agente atende diretamente.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Metric label="Conversas" value={stats.conversations} hint={`${stats.conversationsThisWeek} na semana`} />
          <Metric label="Mensagens na semana" value={stats.messagesThisWeek} />
          <Metric
            label="Leads qualificados"
            value={stats.qualifiedLeads}
            hint="Conversas com dados estruturados capturados"
          />
          <Metric
            label="Taxa de atendimento"
            value={stats.conversations > 0 ? Math.round((stats.attendedConversations / stats.conversations) * 100) : 0}
            suffix="%"
            hint="Conversas que o agente respondeu"
          />
          <Metric label="Aguardando humano" value={stats.handoffs} hint="Conversas em atendimento humano" />
          <Metric label="Documentos na base" value={overview.knowledgeCount} />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-medium text-slate-400">Onde é usado</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Widgets</p>
            {overview.linkedWidgets.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum widget usa este agente diretamente.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {overview.linkedWidgets.map((w) => (
                  <li key={w._id}>
                    <Badge>{w.name}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Equipes</p>
            {overview.linkedTeams.length === 0 ? (
              <p className="text-sm text-slate-500">Não faz parte de nenhuma equipe.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {overview.linkedTeams.map((t) => (
                  <li key={t._id}>
                    <Badge>{t.name}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

const ALL_KEYS = [...AGENT_SECTIONS.map((s) => s.key), ...AGENT_CONFIG_SECTIONS.map((s) => s.key)]

export function AgentDetail() {
  const { agentId, section } = useParams()
  const navigate = useNavigate()
  const [overview, setOverview] = useState<AgentOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!agentId) return
    const res = await fetch(`${API_URL}/api/agents/${agentId}/overview`, { credentials: 'include' })
    if (res.status === 404) {
      setNotFound(true)
      setLoading(false)
      return
    }
    if (res.ok) setOverview(await res.json())
    setLoading(false)
  }, [agentId])

  useEffect(() => {
    load()
  }, [load])

  async function handleDelete() {
    if (!overview || deleting) return
    if (
      !window.confirm(
        `Excluir o agente "${overview.agent.name}"? Essa ação não pode ser desfeita e remove também a base de conhecimento dele.`,
      )
    ) {
      return
    }
    setDeleteError(null)
    setDeleting(true)
    try {
      const res = await fetch(`${API_URL}/api/agents/${overview.agent._id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null)
        setDeleteError(body?.error ?? 'Não foi possível excluir o agente.')
        return
      }
      navigate('/agents')
    } finally {
      setDeleting(false)
    }
  }

  const agent = overview?.agent
  // Unknown/typo sections fall back to the overview.
  const raw = section ?? ''
  const active = ALL_KEYS.includes(raw) ? raw : ''
  const config = AGENT_CONFIG_SECTIONS.find((s) => s.key === active)
  const sectionLabel =
    [...AGENT_SECTIONS, ...AGENT_CONFIG_SECTIONS].find((s) => s.key === active)?.label ?? 'Visão geral'

  return (
    <AppLayout
      current="/agents"
      title={agent?.name ?? 'Agente'}
      titleExtra={agent ? <AgentBadges agent={agent} /> : undefined}
    >
      {loading ? (
        <p className="text-sm text-slate-400">Carregando agente...</p>
      ) : notFound || !overview || !agent ? (
        <p className="text-sm text-slate-400">Agente não encontrado.</p>
      ) : active === '' ? (
        <OverviewSection overview={overview} />
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{sectionLabel}</h2>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            {active === 'testar' ? (
              <AgentPlayground key={agent._id} agent={agent} />
            ) : config ? (
              <AgentForm
                key={`${agent._id}:${config.key}`}
                agent={agent}
                section={config.key}
                layout="flat"
                onSaved={load}
              />
            ) : null}
          </div>
          {active === 'essencial' && (
            <DangerZone
              title="Excluir este agente"
              description="Remove o agente e sua base de conhecimento. Não pode ser desfeito."
              buttonLabel="Excluir agente"
              onDelete={handleDelete}
              deleting={deleting}
              deleteError={deleteError}
            />
          )}
        </div>
      )}
    </AppLayout>
  )
}
