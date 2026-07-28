import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { API_URL } from '../lib/api'
import type { DashboardStats } from '../lib/types'

const SECTIONS = [
  {
    to: '/agents',
    title: 'Agentes',
    description: 'Crie e configure os agentes de IA: objetivo, provedor/modelo e base de conhecimento.',
  },
  {
    to: '/widgets',
    title: 'Widgets',
    description: 'Crie widgets de chat, personalize a aparência e vincule cada um a um agente.',
  },
  {
    to: '/chats',
    title: 'Chats',
    description: 'Veja e responda as conversas dos visitantes em tempo real.',
  },
]

function Metric({
  label,
  value,
  suffix,
  hint,
}: {
  label: string
  value: number
  suffix?: string
  hint?: string
}) {
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

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch(`${API_URL}/api/stats`, { credentials: 'include' })
      if (res.ok && !cancelled) setStats(await res.json())
      if (!cancelled) setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const attendanceRate =
    stats && stats.conversations > 0
      ? Math.round((stats.attendedConversations / stats.conversations) * 100)
      : 0

  return (
    <AppLayout current="/dashboard" title="Dashboard">
      <div className="space-y-6">
        <section>
          <h2 className="mb-3 text-sm font-medium text-slate-400">Visão geral</h2>
          {loading ? (
            <p className="text-sm text-slate-400">Carregando métricas...</p>
          ) : stats ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Conversas na semana"
                value={stats.conversationsThisWeek}
                hint={`${stats.conversations} no total`}
              />
              <Metric label="Mensagens na semana" value={stats.messagesThisWeek} />
              <Metric
                label="Leads qualificados"
                value={stats.qualifiedLeads}
                hint="Conversas com dados estruturados capturados"
              />
              <Metric
                label="Aguardando humano"
                value={stats.handoffs}
                hint="Conversas em atendimento humano"
              />
              <Metric label="Agentes" value={stats.agents} />
              <Metric label="Widgets" value={stats.widgets} />
              <Metric
                label="Taxa de atendimento"
                value={attendanceRate}
                suffix="%"
                hint="Conversas que o agente respondeu"
              />
              <Metric
                label="Tokens no mês"
                value={stats.tokensThisMonth}
                hint={
                  stats.monthlyTokenCap > 0
                    ? `Teto mensal: ${stats.monthlyTokenCap.toLocaleString('pt-BR')}`
                    : `${stats.tokensThisWeek.toLocaleString('pt-BR')} na semana`
                }
              />
            </div>
          ) : (
            <p className="text-sm text-slate-400">Não foi possível carregar as métricas.</p>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-slate-400">Atalhos</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {SECTIONS.map((section) => (
              <Link
                key={section.to}
                to={section.to}
                className="rounded-xl border border-slate-800 bg-slate-900 p-6 transition hover:border-slate-600"
              >
                <h3 className="mb-2 font-medium">{section.title}</h3>
                <p className="text-sm text-slate-400">{section.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </AppLayout>
  )
}
