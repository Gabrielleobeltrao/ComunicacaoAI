import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { OfficeFloor } from '../office/OfficeFloor'
import { API_URL } from '../lib/api'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import type { DashboardStats, TeamAnalytics } from '../lib/types'
import { Badge, Button, Card, EmptyState, Icon, MetricStat } from '../ui'

const SECTIONS = [
  { to: '/agents', title: 'Agentes', icon: 'users-round', description: 'Contrate e configure seus agentes: objetivo, modelo e base de conhecimento.' },
  { to: '/widgets', title: 'Canais', icon: 'share-2', description: 'Coloque seus agentes pra atender no site (widget) e no WhatsApp.' },
  { to: '/chats', title: 'Conversas', icon: 'messages-square', description: 'Acompanhe e responda as conversas dos visitantes em tempo real.' },
]

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

function TeamAnalyticsCard({ team }: { team: TeamAnalytics }) {
  const rows = team.specialists
  const max = Math.max(1, ...rows.map((s) => s.count))
  const stickiest =
    team.mode === 'pipeline' && team.stages.length > 0
      ? [...team.stages].sort((a, b) => b.handled - b.left - (a.handled - a.left))[0]
      : null

  return (
    <Card padding="16px">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: 'var(--text-heading)' }}>{team.teamName}</span>
          <Badge tone="brand">{team.mode === 'pipeline' ? 'Fluxo' : 'Adaptativo'}</Badge>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {team.decisions.toLocaleString('pt-BR')} {team.decisions === 1 ? 'turno' : 'turnos'}
        </span>
      </div>

      <p style={{ marginBottom: 8, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
        {team.mode === 'pipeline' ? 'Atividade por etapa' : 'Mais consultados'}
      </p>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((s) => (
          <li key={s.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
              <span style={{ color: 'var(--text-body)' }}>{s.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>{s.count}</span>
            </div>
            <div style={{ height: 6, borderRadius: 'var(--radius-full)', background: 'var(--surface-sunken)', overflow: 'hidden' }}>
              <div style={{ width: `${(s.count / max) * 100}%`, height: '100%', borderRadius: 'var(--radius-full)', background: 'var(--intent-brand)' }} />
            </div>
          </li>
        ))}
      </ul>

      <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
        {team.mode === 'pipeline' ? (
          <>
            <span>
              Avanços/desvios: <span style={{ color: 'var(--text-heading)', fontWeight: 700 }}>{team.moves}</span>
            </span>
            {stickiest ? (
              <span>
                Mais fica em: <span style={{ color: 'var(--text-heading)', fontWeight: 700 }}>{stickiest.name}</span>
              </span>
            ) : null}
          </>
        ) : (
          <span>
            Pediu esclarecimento:{' '}
            <span style={{ color: 'var(--text-heading)', fontWeight: 700 }}>{Math.round(team.clarifyRate * 100)}%</span>
          </span>
        )}
      </div>
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
  const { agents, agentsLoading } = useAgentsAndWidgets()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [teamAnalytics, setTeamAnalytics] = useState<TeamAnalytics[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [statsRes, teamsRes] = await Promise.all([
        fetch(`${API_URL}/api/stats`, { credentials: 'include' }),
        fetch(`${API_URL}/api/team-analytics`, { credentials: 'include' }),
      ])
      if (statsRes.ok && !cancelled) setStats(await statsRes.json())
      if (teamsRes.ok && !cancelled) setTeamAnalytics(await teamsRes.json())
      if (!cancelled) setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const attendanceRate =
    stats && stats.conversations > 0 ? Math.round((stats.attendedConversations / stats.conversations) * 100) : 0

  return (
    <AppLayout current="/dashboard" title="Escritório" subtitle="Visão geral do seu time de IA">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
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
              <OfficeFloor agents={agents} />
            </Card>
          )}
        </section>

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

        {teamAnalytics.length > 0 && (
          <section>
            <SectionTitle>Equipes</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {teamAnalytics.map((team) => (
                <TeamAnalyticsCard key={team.teamId} team={team} />
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionTitle>Atalhos</SectionTitle>
          <div className="grid gap-3 md:grid-cols-3">
            {SECTIONS.map((section) => (
              <Link key={section.to} to={section.to} style={{ textDecoration: 'none' }}>
                <Card interactive padding="20px" style={{ height: '100%' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 40,
                      height: 40,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--intent-brand-soft)',
                      marginBottom: 12,
                    }}
                  >
                    <Icon name={section.icon} size={20} color="var(--intent-brand)" />
                  </span>
                  <h3 style={{ marginBottom: 4, fontSize: 16, fontWeight: 700, color: 'var(--text-heading)' }}>{section.title}</h3>
                  <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{section.description}</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </AppLayout>
  )
}
