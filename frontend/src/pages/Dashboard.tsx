import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { OfficeFloor } from '../office/OfficeFloor'
import { API_URL } from '../lib/api'
import { featureFlags } from '../featureFlags'
import { getBuildingOverview } from '../lib/floors'
import type { BuildingOverview, FloorOverview } from '../lib/floors'
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

// The unified building dashboard (nav V2). Replaces the old office-map dashboard
// AND the standalone Prédio page: KPIs across all floors + per-floor cards. The
// visual office map now lives on each floor's overview (FloorView), never here.
export function Dashboard() {
  return featureFlags.aiBuilding ? <BuildingDashboard /> : <LegacyDashboard />
}

function BuildingDashboard() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<BuildingOverview | null>(null)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const ov = await getBuildingOverview()
        if (!cancelled) setOverview(ov)
      } catch {
        if (!cancelled) setError(true)
      }
      const statsRes = await fetch(`${API_URL}/api/stats`, { credentials: 'include' })
      if (statsRes.ok && !cancelled) setStats(await statsRes.json())
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const t = overview?.totals
  const attendanceRate =
    stats && stats.conversations > 0 ? Math.round((stats.attendedConversations / stats.conversations) * 100) : 0

  return (
    <AppLayout
      current="/dashboard"
      title={overview?.building.name ?? 'Prédio'}
      subtitle={t ? `${t.floors} ${t.floors === 1 ? 'andar' : 'andares'} · ${t.agents} agentes` : 'Visão geral do prédio'}
      actions={
        <Button icon="plus" aria-label="Contratar agente" onClick={() => navigate('/agents')}>
          <span className="hidden sm:inline">Contratar agente</span>
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <section>
          <SectionTitle>Operação</SectionTitle>
          {loading && !overview ? (
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando visão geral...</p>
          ) : error && !overview ? (
            <p style={{ fontSize: 14, color: 'var(--coral-600, #d92d20)' }}>Não foi possível carregar a visão geral.</p>
          ) : t ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Andares" value={t.floors} icon="building-2" />
              <StatCard label="Agentes" value={t.agents} icon="users-round" />
              <StatCard label="Setores" value={t.sectors} icon="network" />
              <StatCard label="Automações ativas" value={t.automationsActive} icon="workflow" />
              <StatCard label="Execuções ativas" value={t.runsActive} icon="history" />
              <StatCard label="Falhas (24h)" value={t.failures24h} icon="triangle-alert" />
            </div>
          ) : null}
        </section>

        <section>
          <SectionTitle>Andares</SectionTitle>
          {overview && overview.floors.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {overview.floors.map((f) => (
                <FloorCard key={f.floor.id} f={f} />
              ))}
            </div>
          ) : overview ? (
            <EmptyState icon="building-2" title="Nenhum andar" body="Crie um andar pra organizar o time e as automações do prédio." />
          ) : null}
        </section>

        {stats && (
          <section>
            <SectionTitle>Comunicação</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Conversas na semana" value={stats.conversationsThisWeek} hint={`${stats.conversations} no total`} icon="messages-square" />
              <StatCard label="Leads qualificados" value={stats.qualifiedLeads} icon="user-check" />
              <StatCard label="Aguardando humano" value={stats.handoffs} icon="hand" />
              <StatCard label="Taxa de atendimento" value={attendanceRate} suffix="%" icon="percent" />
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  )
}

// A floor card is a link into that floor's overview (the whole card is clickable).
function FloorCard({ f }: { f: FloorOverview }) {
  return (
    <Link to={`/floors/${f.floor.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <Card padding="16px" interactive accent={f.floor.color ?? undefined}>
        <strong style={{ fontSize: 15 }}>{f.floor.name}</strong>
        {f.floor.mission ? <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 12px' }}>{f.floor.mission}</p> : <div style={{ height: 12 }} />}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: 'var(--text-faint)' }}>
          <span>{f.agentCount} agentes</span>
          <span>{f.sectorCount} setores</span>
          <span>{f.automationsActive} automações</span>
          {f.runsActive > 0 ? <span style={{ color: 'var(--accent, #6b5cff)', fontWeight: 600 }}>{f.runsActive} em execução</span> : null}
          {f.failures24h > 0 ? <span style={{ color: 'var(--coral-600, #d92d20)', fontWeight: 600 }}>{f.failures24h} falhas 24h</span> : null}
        </div>
      </Card>
    </Link>
  )
}

function LegacyDashboard() {
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
      {/* The wide search is hidden on phones (search lives on the Agents page); the
          hire button collapses to an icon so the topbar never overflows. */}
      <div className="hidden sm:block">
        <Input
          icon="search"
          placeholder="Buscar agente"
          aria-label="Buscar agente"
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate('/agents')
          }}
          style={{ width: 'clamp(140px, 24vw, 220px)' }}
        />
      </div>
      <IconButton icon="bell" label="Avisos" variant="soft" onClick={() => navigate('/chats')} />
      <Button icon="plus" aria-label="Contratar agente" onClick={() => navigate('/agents')}>
        <span className="hidden sm:inline">Contratar agente</span>
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
