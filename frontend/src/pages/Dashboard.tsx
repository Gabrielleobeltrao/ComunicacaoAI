import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { OfficeFloor } from '../office/OfficeFloor'
import { API_URL } from '../lib/api'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import type { DashboardStats } from '../lib/types'
import { Button, Card, EmptyState, IconButton, Input, MetricStat } from '../ui'

function StatCard({
  label,
  value,
  suffix,
  hint,
  icon,
}: {
  label: string
  value: number
  suffix?: string
  hint?: string
  icon?: string
}) {
  return (
    <Card padding="16px">
      <MetricStat label={label} value={`${value.toLocaleString('pt-BR')}${suffix ?? ''}`} icon={icon} />
      {hint ? <p style={{ marginTop: 4, fontSize: 12, color: 'var(--text-faint)' }}>{hint}</p> : null}
    </Card>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 style={{ marginBottom: 12, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
      {children}
    </h2>
  )
}

export function Dashboard() {
  const navigate = useNavigate()
  const { agents, agentsLoading, sectors } = useAgentsAndWidgets()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const statsRes = await fetch(`${API_URL}/api/stats`, { credentials: 'include' })
      if (statsRes.ok && !cancelled) setStats(await statsRes.json())
      if (!cancelled) setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const attendanceRate =
    stats && stats.conversations > 0 ? Math.round((stats.attendedConversations / stats.conversations) * 100) : 0

  const agentCount = agents.length
  const teamSubtitle = `${agentCount} ${agentCount === 1 ? 'agente' : 'agentes'}${
    stats ? ` · ${stats.conversationsThisWeek.toLocaleString('pt-BR')} conversas na semana` : ''
  }`

  const headerActions = (
    <>
      <Input
        icon="search"
        placeholder="Buscar agente"
        aria-label="Buscar agente"
        onKeyDown={(e) => {
          if (e.key === 'Enter') navigate('/agents')
        }}
        style={{ width: 220 }}
      />
      <IconButton icon="bell" label="Avisos" variant="soft" onClick={() => navigate('/chats')} />
      <Button icon="plus" onClick={() => navigate('/agents')}>
        Contratar agente
      </Button>
    </>
  )

  return (
    <AppLayout current="/dashboard" title="Escritório" subtitle={teamSubtitle} actions={headerActions}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <section>
          <SectionTitle>Visão geral</SectionTitle>
          {loading ? (
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando métricas...</p>
          ) : stats ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Conversas na semana" value={stats.conversationsThisWeek} hint={`${stats.conversations} no total`} icon="messages-square" />
              <StatCard label="Mensagens na semana" value={stats.messagesThisWeek} icon="message-circle" />
              <StatCard label="Leads qualificados" value={stats.qualifiedLeads} hint="Com dados capturados" icon="user-check" />
              <StatCard label="Aguardando humano" value={stats.handoffs} hint="Em atendimento humano" icon="hand" />
              <StatCard label="Agentes" value={stats.agents} icon="users-round" />
              <StatCard label="Canais" value={stats.widgets} icon="share-2" />
              <StatCard label="Taxa de atendimento" value={attendanceRate} suffix="%" hint="Conversas que o agente respondeu" icon="percent" />
              <StatCard
                label="Tokens no mês"
                value={stats.tokensThisMonth}
                hint={
                  stats.monthlyTokenCap > 0
                    ? `Teto: ${stats.monthlyTokenCap.toLocaleString('pt-BR')}`
                    : `${stats.tokensThisWeek.toLocaleString('pt-BR')} na semana`
                }
                icon="coins"
              />
            </div>
          ) : (
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Não foi possível carregar as métricas.</p>
          )}
        </section>

        <section>
          <SectionTitle>Sua equipe</SectionTitle>
          {agentsLoading ? (
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando o escritório...</p>
          ) : agents.length === 0 ? (
            <EmptyState
              icon="armchair"
              title="Escritório vazio"
              body="Contrate seu primeiro agente e veja a mesa dele ganhar vida."
              action={
                <Button icon="plus" onClick={() => navigate('/agents')}>
                  Contratar agente
                </Button>
              }
            />
          ) : (
            <Card padding="0" style={{ overflow: 'hidden' }}>
              <OfficeFloor agents={agents} sectors={sectors} />
            </Card>
          )}
        </section>

      </div>
    </AppLayout>
  )
}
