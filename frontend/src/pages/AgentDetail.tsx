import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AgentForm } from '../components/AgentForm'
import { AgentPlayground } from '../components/AgentPlayground'
import { AgentActivations, AgentHistoryPanel, AgentRoutines } from '../components/AgentWorkAreas'
import { AppLayout } from '../components/AppLayout'
import { DangerZone } from '../components/DangerZone'
import { accentFor, buildCharacterResolver } from '../lib/agentAvatar'
import type { CharacterResolver } from '../lib/agentAvatar'
import { roleLabelOf, skillsOf } from '../lib/agentPresentation'
import { API_URL } from '../lib/api'
import { getAgentStats, METRIC_KEY_LABEL, PERIOD_LABEL, type StatsPeriod } from '../lib/agentStats'
import { formatCount, formatDuration, formatPercent, formatTokens } from '../lib/metricFormat'
import { useActiveFloorId, useOptionalBuildingContext } from '../contexts/BuildingContext'
import { AgentSectorAssignment } from '../components/AgentSectorAssignment'
import { floorAgent, floorAgents } from '../lib/floorRoutes'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import type { AgentOverview, AgentStatsResponse, AgentSummary } from '../lib/types'
import { Button, Card, MetricStat, StatusPill, Tag } from '../ui'
import type { AgentStatus } from '../ui'
import { Illustration } from '../office/Illustration'

// The agent page mirrors the design: a profile card + "colegas" + "onde é usado"
// on the left, and metric cards over a tabbed panel on the right. Each tab hosts
// a real section (the config form sections + the test playground), so nothing
// loses functionality.
const TABS: { key: string; label: string }[] = [
  { key: 'essencial', label: 'Ajustes' },
  { key: 'ferramentas', label: 'Ferramentas' },
  { key: 'conhecimento', label: 'Conhecimento' },
  { key: 'rotinas', label: 'Rotinas' },
  { key: 'acionamentos', label: 'Acionamentos' },
  { key: 'historico', label: 'Histórico' },
  { key: 'avancado', label: 'Avançado' },
  { key: 'testar', label: 'Testar' },
]
const TAB_KEYS = TABS.map((t) => t.key)

function ProfileCard({ agent, stats, accent, portrait }: { agent: AgentSummary; stats: AgentOverview['stats']; accent: string; portrait: string }) {
  const roleLabel = roleLabelOf(agent)
  const status: AgentStatus = stats.messagesThisWeek > 0 ? 'working' : 'idle'
  const skills = skillsOf(agent)
  return (
    <Card accent={accent} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
      <Illustration
        src={portrait}
        alt={agent.name}
        fit="contain"
        ratio="3 / 4"
        radius={14}
        placeholder={agent.name}
        style={{ maxWidth: 180, background: `color-mix(in oklab, ${accent} 10%, var(--paper-0))` }}
      />
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--text-heading)' }}>
        {agent.name}
      </span>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{roleLabel}</span>
      <StatusPill status={status} />
      {agent.objective ? (
        <span style={{ fontSize: 13, color: 'var(--text-body)', lineHeight: 1.5, marginTop: 4 }}>{agent.objective}</span>
      ) : null}
      {skills.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 4 }}>
          {skills.map((s) => (
            <Tag key={s} color={accent}>
              {s}
            </Tag>
          ))}
        </div>
      ) : null}
    </Card>
  )
}

function ColleaguesCard({ agents, currentId, chars }: { agents: AgentSummary[]; currentId: string; chars: CharacterResolver }) {
  const navigate = useNavigate()
  const fid = useActiveFloorId()
  const colleagues = agents.filter((x) => x._id !== currentId).slice(0, 5)
  if (colleagues.length === 0) return null
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Colegas de mesa</span>
      {colleagues.map((x) => (
        <button
          key={x._id}
          onClick={() => navigate(fid ? floorAgent(fid, x._id) : `/agents/${x._id}`)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, border: 0, background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left' }}
        >
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              overflow: 'hidden',
              flex: '0 0 auto',
              background: `color-mix(in oklab, ${accentFor(x._id)} 14%, var(--surface-card))`,
            }}
          >
            <img src={chars.portrait(x._id)} alt="" style={{ width: '100%', height: '150%', objectFit: 'cover', objectPosition: '50% 8%', display: 'block' }} />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)' }}>{x.name}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }}>
              {x.objective || (x.provider === 'openai' ? 'OpenAI' : 'Anthropic')}
            </span>
          </span>
        </button>
      ))}
    </Card>
  )
}

function UsageCard({ overview }: { overview: AgentOverview }) {
  const { linkedWidgets, knowledgeCount } = overview
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Onde é usado</span>
      <div>
        <p style={{ marginBottom: 6, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Canais</p>
        {linkedWidgets.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>Nenhum canal usa este agente diretamente.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {linkedWidgets.map((w) => (
              <Tag key={w._id}>{w.name}</Tag>
            ))}
          </div>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
        <span style={{ fontWeight: 700, color: 'var(--text-heading)' }}>{knowledgeCount}</span> documento{knowledgeCount === 1 ? '' : 's'} na base
      </p>
    </Card>
  )
}

export function AgentDetail() {
  const { agentId, section } = useParams()
  const fid = useActiveFloorId()
  const building = useOptionalBuildingContext()
  const navigate = useNavigate()
  const { agents } = useAgentsAndWidgets()
  const chars = useMemo(() => buildCharacterResolver(agents.map((a) => a._id)), [agents])
  const [overview, setOverview] = useState<AgentOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [period, setPeriod] = useState<StatsPeriod>('30d')
  const [opStats, setOpStats] = useState<AgentStatsResponse | null>(null)

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

  // Operational stats for the period — kept null (rendered "—") while loading so the
  // metric grid never jumps.
  useEffect(() => {
    let cancelled = false
    setOpStats(null)
    getAgentStats(period)
      .then((d) => !cancelled && setOpStats(d))
      .catch(() => !cancelled && setOpStats(null))
    return () => {
      cancelled = true
    }
  }, [period, agentId])

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
      const res = await fetch(`${API_URL}/api/agents/${overview.agent._id}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null)
        setDeleteError(body?.error ?? 'Não foi possível excluir o agente.')
        return
      }
      navigate(fid ? floorAgents(fid) : '/agents')
    } finally {
      setDeleting(false)
    }
  }

  const agent = overview?.agent
  const agentFloorId = agent?.floorId ?? fid
  const agentFloorName = building?.floors.find((f) => f.id === agentFloorId)?.name ?? 'Andar'
  const active = TAB_KEYS.includes(section ?? '') ? (section as string) : 'essencial'
  const accent = agent ? accentFor(agent._id) : 'var(--intent-brand)'
  const stats = overview?.stats
  const attendanceRate = stats && stats.conversations > 0 ? Math.round((stats.attendedConversations / stats.conversations) * 100) : 0
  const op = agent ? opStats?.stats[agent._id] : undefined
  const chan = agent ? opStats?.channel[agent._id] : undefined

  return (
    <AppLayout
      current="/agents"
      title={agent?.name ?? 'Agente'}
      subtitle={agent ? roleLabelOf(agent) : undefined}
      actions={
        agent ? (
          <Button variant="secondary" icon="message-circle" onClick={() => navigate('/chats')}>
            Conversar
          </Button>
        ) : undefined
      }
    >
      {loading ? (
        <p className="text-sm text-(--text-muted)">Carregando agente...</p>
      ) : notFound || !overview || !agent || !stats ? (
        <p className="text-sm text-(--text-muted)">Agente não encontrado.</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:items-start">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ProfileCard agent={agent} stats={stats} accent={accent} portrait={chars.portrait(agent._id)} />
            <ColleaguesCard agents={agents} currentId={agent._id} chars={chars} />
            <AgentSectorAssignment agentId={agent._id} floorId={agentFloorId} floorName={agentFloorName} onChanged={load} />
            <UsageCard overview={overview} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Operational metrics for the period. Null = no telemetry ("—"); the
                grid renders all cards even while loading, so it never jumps. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Desempenho operacional</h2>
              <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius-control)', background: 'var(--surface-sunken)' }} title={opStats?.telemetrySince ? `Telemetria desde ${new Date(opStats.telemetrySince).toLocaleDateString('pt-BR')}` : 'Telemetria por agente'}>
                {(['7d', '30d', 'all'] as StatsPeriod[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius-xs)', border: 0, background: p === period ? 'var(--surface-card)' : 'transparent', boxShadow: p === period ? 'var(--shadow-flat)' : 'none', color: p === period ? 'var(--text-heading)' : 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {PERIOD_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
              <Card padding="16px" title={`Execuções concluídas + iniciadas no período (${PERIOD_LABEL[period]})`}>
                <MetricStat icon="activity" label="Execuções" value={formatCount(op ? op.executions : null)} />
              </Card>
              <Card padding="16px" title={`Tempo somado de execução no período (${PERIOD_LABEL[period]})`}>
                <MetricStat icon="timer" label="Tempo ativo" value={formatDuration(op ? op.activeTimeMs : null)} />
              </Card>
              <Card padding="16px" title="Duração média de uma execução">
                <MetricStat icon="gauge" label="Duração média" value={formatDuration(op?.avgDurationMs)} />
              </Card>
              <Card padding="16px" title={`Tokens (entrada + saída) no período (${PERIOD_LABEL[period]})`}>
                <MetricStat icon="coins" label="Tokens" value={formatTokens(op ? op.totalTokens : null)} />
              </Card>
              <Card padding="16px" title="Tokens médios por execução">
                <MetricStat icon="calculator" label="Tokens médios" value={formatTokens(op?.avgTokensPerExecution)} />
              </Card>
              <Card padding="16px" title="Execuções bem-sucedidas / total">
                <MetricStat icon="check-circle" label="Sucesso" value={formatPercent(op?.successRate)} />
              </Card>
            </div>

            {/* The agent's specific KPI — its own section. */}
            <Card padding="16px" title={`KPI do agente (${PERIOD_LABEL[period]})`}>
              <MetricStat icon="target" label={op?.specific.label ?? METRIC_KEY_LABEL[overview.resolvedMetric]} value={formatCount(op?.specific.value)} />
            </Card>

            {/* Channel/attendance only when the agent actually answers a channel. */}
            {(chan?.linked ?? overview.channelLinked) ? (
              <Card padding="16px">
                <p style={{ margin: '0 0 12px', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 800, color: 'var(--text-heading)' }}>Canais e atendimento</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14 }}>
                  <MetricStat icon="messages-square" label="Conversas" value={stats.conversations.toLocaleString('pt-BR')} />
                  <MetricStat icon="message-circle" label="Mensagens/sem" value={stats.messagesThisWeek.toLocaleString('pt-BR')} />
                  <MetricStat icon="user-check" label="Leads" value={stats.qualifiedLeads.toLocaleString('pt-BR')} />
                  <MetricStat icon="percent" label="Atendimento" value={attendanceRate} unit="%" />
                </div>
              </Card>
            ) : null}

            <Card padding="0" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
                <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius-control)', background: 'var(--surface-sunken)' }}>
                  {TABS.map((t) => {
                    const on = t.key === active
                    return (
                      <button
                        key={t.key}
                        onClick={() => navigate(fid ? floorAgent(fid, agent._id, t.key) : `/agents/${agent._id}/${t.key}`)}
                        style={{
                          height: 32,
                          padding: '0 14px',
                          borderRadius: 'var(--radius-xs)',
                          border: 0,
                          background: on ? 'var(--surface-card)' : 'transparent',
                          boxShadow: on ? 'var(--shadow-flat)' : 'none',
                          color: on ? 'var(--text-heading)' : 'var(--text-muted)',
                          fontFamily: 'var(--font-ui)',
                          fontSize: 13.5,
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                          transition: 'all var(--dur-fast) var(--ease-standard)',
                        }}
                      >
                        {t.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div style={{ padding: 18 }}>
                {active === 'testar' ? (
                  <AgentPlayground key={agent._id} agent={agent} />
                ) : active === 'rotinas' ? (
                  <AgentRoutines key={agent._id} agent={agent} />
                ) : active === 'acionamentos' ? (
                  <AgentActivations key={agent._id} agent={agent} agents={agents} />
                ) : active === 'historico' ? (
                  <AgentHistoryPanel key={agent._id} agent={agent} />
                ) : (
                  <>
                    <AgentForm key={`${agent._id}:${active}`} agent={agent} section={active} layout="flat" onSaved={load} availableMetrics={overview.availableMetrics} />
                    {active === 'essencial' ? (
                      <div style={{ marginTop: 20 }}>
                        <DangerZone
                          title="Excluir este agente"
                          description="Remove o agente e sua base de conhecimento. Não pode ser desfeito."
                          buttonLabel="Excluir agente"
                          onDelete={handleDelete}
                          deleting={deleting}
                          deleteError={deleteError}
                        />
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
