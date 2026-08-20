import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AgentForm } from '../components/AgentForm'
import { AgentPlayground } from '../components/AgentPlayground'
import { AgentActivations, AgentHistoryPanel, AgentRoutines } from '../components/AgentWorkAreas'
import { AgentEventTriggers } from '../components/AgentEventTriggers'
import { CollaborationEditor } from '../components/CollaborationEditor'
import { AppLayout } from '../components/AppLayout'
import { DangerZone } from '../components/DangerZone'
import { accentFor, buildCharacterResolver } from '../lib/agentAvatar'
import type { CharacterResolver } from '../lib/agentAvatar'
import { modelLabelOf, roleLabelOf, skillsOf } from '../lib/agentPresentation'
import { API_URL } from '../lib/api'
import { getAgentStats, METRIC_KEY_LABEL, PERIOD_LABEL, type StatsPeriod } from '../lib/agentStats'
import { formatCount, formatDuration, formatPercent, formatTokens } from '../lib/metricFormat'
import { useActiveFloorId, useOptionalBuildingContext } from '../contexts/BuildingContext'
import { AgentSectorAssignment } from '../components/AgentSectorAssignment'
import { floorAgent, floorAgents, floorSector } from '../lib/floorRoutes'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import type { AgentOverview, AgentStatsResponse, AgentSummary } from '../lib/types'
import { Button, Card, MetricStat, StatusPill, Tag } from '../ui'
import type { AgentStatus } from '../ui'
import { Illustration } from '../office/Illustration'

// The agent page mirrors the design: a profile card + "colegas" + "onde é usado"
// on the left, and metric cards over a tabbed panel on the right. Each tab hosts
// a real section (the config form sections + the test playground), so nothing
// loses functionality.
// Five sections instead of eight: what it is, how it works, what triggers it, what it
// did, and the technical knobs. Old links keep working through LEGACY_SECTION.
const TABS: { key: string; label: string }[] = [
  { key: 'visao-geral', label: 'Visão geral' },
  { key: 'como-trabalha', label: 'Como trabalha' },
  { key: 'fluxos', label: 'Fluxos' },
  { key: 'atividade', label: 'Atividade' },
  { key: 'avancado', label: 'Avançado' },
]
const TAB_KEYS = TABS.map((t) => t.key)
const LEGACY_SECTION: Record<string, string> = {
  essencial: 'visao-geral',
  ferramentas: 'como-trabalha',
  conhecimento: 'como-trabalha',
  rotinas: 'fluxos',
  acionamentos: 'fluxos',
  historico: 'atividade',
  testar: 'atividade',
}

const TRIGGER_LABEL: Record<string, { label: string; configured: string; pending: string; conflict: string; fix: string }> = {
  manual: { label: 'Execução manual', configured: 'Você pode rodar quando quiser', pending: 'Não permitido — use “Testar” para experimentar', conflict: 'Algo dispara este agente sem permissão.', fix: 'Permitir execução manual' },
  scheduled: { label: 'Rotina', configured: 'Roda no horário definido', pending: 'Permitido, mas sem rotina criada', conflict: 'Existe rotina rodando, mas o agendamento não está permitido.', fix: 'Permitir agendamento' },
  channel: { label: 'Canal', configured: 'Atende no canal vinculado', pending: 'Permitido, mas sem canal vinculado', conflict: 'Existe canal vinculado, mas o atendimento por canal não está permitido.', fix: 'Permitir canal' },
  event: { label: 'Evento', configured: 'Disparado por webhook', pending: 'Permitido, mas sem webhook configurado', conflict: 'Existe webhook ativo, mas o gatilho por evento não está permitido.', fix: 'Permitir evento' },
}

// Ready or the exact pending items, each with the one action that fixes it.
function ReadinessCard({ overview, onGo }: { overview: AgentOverview; onGo: (section: string) => void }) {
  // A payload without readiness (an older server, a cached response) must degrade to
  // "no pendency known", never blank the whole page.
  const readiness = overview.readiness ?? { ready: true, issues: [] }
  if (readiness.ready)
    return (
      <Card padding="14px 16px" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusPill status="working" label="Pronto para trabalhar" pulse={false} />
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Este agente tem tudo o que precisa.</span>
      </Card>
    )
  return (
    <Card padding="14px 16px" style={{ display: 'grid', gap: 10 }} data-testid="agent-readiness">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <StatusPill status="blocked" label="Falta configurar" pulse={false} />
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Ele ainda não consegue fazer o trabalho dele.</span>
      </div>
      {(readiness.issues ?? []).map((issue) => (
        <div key={issue.code} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, color: 'var(--text-heading)', minWidth: 0 }}>{issue.message}</span>
          <Button size="sm" variant="secondary" onClick={() => onGo(issue.section)}>
            {issue.action}
          </Button>
        </div>
      ))}
    </Card>
  )
}

// What fires this agent: each trigger with BOTH truths — allowed by the agent, and
// actually configured (a routine/channel/webhook that really exists).
function TriggersPanel({ overview, onFixed }: { overview: AgentOverview; onFixed: () => void }) {
  const triggers = overview.triggers ?? []
  const [fixing, setFixing] = useState<string | null>(null)

  // Legacy rows can have a live routine/channel/webhook while the agent never
  // allowed that trigger. One click makes the permission match what already runs.
  const allow = async (kind: string) => {
    setFixing(kind)
    try {
      const modes = [...new Set([...(overview.agent.activationModes ?? []), kind])].filter((m) => m !== 'agent_only')
      const res = await fetch(`${API_URL}/api/agents/${overview.agent._id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activationModes: modes }),
      })
      if (res.ok) onFixed()
    } finally {
      setFixing(null)
    }
  }

  return (
    <div data-testid="agent-triggers">
      <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>O que aciona este agente</h3>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>“Permitido” é o que ele aceita. “Configurado” é o que já existe de verdade.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 10 }}>
        {triggers.map((t) => {
          const copy = TRIGGER_LABEL[t.kind]
          // 'conflict' is the legacy case: it really fires, but the agent says no.
          const state = t.inconsistent ? 'conflict' : !t.allowed ? 'off' : t.configured ? 'on' : 'pending'
          const pill =
            state === 'conflict'
              ? { status: 'break' as const, label: 'Configurado, mas não permitido' }
              : state === 'on'
                ? { status: 'working' as const, label: 'Configurado' }
                : state === 'pending'
                  ? { status: 'break' as const, label: 'Permitido' }
                  : { status: 'idle' as const, label: 'Desligado' }
          return (
            <Card key={t.kind} padding="12px 14px" style={{ display: 'grid', gap: 4, opacity: state === 'off' ? 0.55 : 1 }} data-testid={`trigger-${t.kind}`}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, color: 'var(--text-heading)' }}>{copy.label}</span>
                <StatusPill status={pill.status} label={pill.label} pulse={false} />
              </div>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {state === 'conflict' ? copy.conflict : !t.allowed ? copy.pending : t.configured ? copy.configured : copy.pending}
              </span>
              {state === 'conflict' ? (
                <button
                  type="button"
                  onClick={() => void allow(t.kind)}
                  disabled={fixing === t.kind}
                  data-testid={`trigger-fix-${t.kind}`}
                  style={{ justifySelf: 'start', background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 12.5, color: 'var(--intent-brand)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  {fixing === t.kind ? 'Ajustando…' : copy.fix}
                </button>
              ) : null}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// Where this agent works as part of a team: which sectors, and in which role —
// coordinator, member or a named pipeline stage. Answers "por que ele foi
// acionado?" without opening every sector.
function TeamsPanel({ overview, fid }: { overview: AgentOverview; fid: string | null }) {
  const links = overview.linkedSectors ?? []
  return (
    <div data-testid="agent-teams">
      <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Onde este agente trabalha</h3>
      {links.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Ele ainda não faz parte de nenhuma equipe.</p>
      ) : (
        <ul style={{ display: 'grid', gap: 8, margin: 0, padding: 0, listStyle: 'none' }}>
          {links.map((l) => (
            <li key={l._id}>
              <Card padding="10px 14px">
                <Link to={fid ? floorSector(fid, l._id) : `/setores/${l._id}`} style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-heading)', textDecoration: 'none' }}>
                  {l.name}
                </Link>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {(l.roles ?? []).map((r, i) => (
                    <Tag key={`${r.role}-${r.stageId ?? i}`}>{r.role === 'coordinator' ? 'coordena' : r.role === 'member' ? 'membro' : `etapa: ${r.stageName || r.stageId}`}</Tag>
                  ))}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// The four questions the overview must answer at a glance.
function AgentSummaryCard({ agent, overview }: { agent: AgentSummary; overview: AgentOverview }) {
  const rows: [string, string][] = [
    ['Função', roleLabelOf(agent)],
    ['O que faz', agent.objective || '—'],
    ['Recebe', agent.inputContract || '—'],
    ['Entrega', agent.outputContract || '—'],
    // O modelo tem linha própria. Ele estava ocupando a linha de "Função", onde não
    // responde a pergunta que a visão geral faz.
    ['Modelo', modelLabelOf(agent)],
  ]
  const w = overview.wiring
  return (
    <Card padding="16px" style={{ display: 'grid', gap: 10 }} data-testid="agent-summary">
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ minWidth: 110, fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
          <span style={{ fontSize: 13.5, color: 'var(--text-heading)', minWidth: 0, flex: 1 }}>{value}</span>
        </div>
      ))}
      {w ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 4 }}>
          <Tag>{w.toolCount} ferramenta(s)</Tag>
          <Tag>{w.knowledgeCount} documento(s)</Tag>
          {/* O site cadastrado também é fonte, e some do resumo se não for contado. */}
          {w.sourceCount > 0 ? <Tag>{w.sourceCount} fonte(s) na web</Tag> : null}
          <Tag>{w.routineCount} rotina(s)</Tag>
          <Tag>{w.channelCount} canal(is)</Tag>
        </div>
      ) : null}
    </Card>
  )
}

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

  // The confirmation is the dialog in DangerZone: it names the agent and requires
  // that name to be typed. This function only performs what was already confirmed,
  // and a double click cannot start a second request.
  async function handleDelete() {
    if (!overview || deleting) return
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
  const raw = section ?? ''
  const active = TAB_KEYS.includes(raw) ? raw : (LEGACY_SECTION[raw] ?? 'visao-geral')
  // A key may carry an anchor ("fluxos#colaboracao") so an action opens the exact
  // editor that solves the pendency, not just the tab that contains it.
  const goToSection = (key: string) => {
    const [section, anchor] = key.split('#')
    const base = fid ? floorAgent(fid, agentId!, section) : `/agents/${agentId}/${section}`
    navigate(anchor ? `${base}#${anchor}` : base)
  }
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
    >
      {loading ? (
        <p className="text-sm text-(--text-muted)">Carregando agente...</p>
      ) : notFound || !overview || !agent || !stats ? (
        <p className="text-sm text-(--text-muted)">Agente não encontrado.</p>
      ) : (
        // Summary on top (profile + metrics, side by side on desktop), workspace
        // below at the FULL content width. The tabs card used to live in the right
        // column, which squeezed forms, flows and long values into ~60% of the page.
        <div className="grid grid-cols-1 gap-5" style={{ minWidth: 0 }}>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:items-start">
          {/* Só o card do agente aqui. Os outros três desceram para depois do painel:
              a altura desta coluna dependia de quantos colegas a conta tem, passava
              dos 950px contra ~400 das métricas, e a diferença virava um retângulo
              vazio que nenhum rearranjo entre as colunas fechava. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ProfileCard agent={agent} stats={stats} accent={accent} portrait={chars.portrait(agent._id)} />
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

          </div>
        </div>

        {/* The workspace: same width for every tab, so switching never shifts the
            layout. No 100vw and no negative margins — that would scroll the page
            sideways outside AppLayout. */}
        <div style={{ width: '100%', minWidth: 0 }} data-testid="agent-workspace">
            <Card padding="0" style={{ minWidth: 0 }}>
              {/* Only the tab STRIP scrolls sideways on a phone; the tab content must
                  never be clipped by the card. */}
              <div style={{ display: 'flex', padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }} data-testid="agent-tabs">
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
              <div style={{ padding: 18, minWidth: 0, overflowWrap: 'anywhere' }}>
                {active === 'atividade' ? (
                  // What it did: metrics live above; here go history and the test bench.
                  <div style={{ display: 'grid', gap: 20 }}>
                    <AgentHistoryPanel key={`${agent._id}:hist`} agent={agent} sectors={overview.linkedSectors} />
                    <div>
                      <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Testar</h3>
                      {/* Testing is NOT a production trigger: it never needs "execução
                          manual" to be permitted, and nothing here is scheduled or
                          published. That is why a specialist ships without triggers. */}
                      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="playground-note">
                        Teste é sempre possível, mesmo sem gatilho. Não é execução em produção: nada é agendado nem enviado a um canal.
                      </p>
                      <AgentPlayground key={`${agent._id}:play`} agent={agent} />
                    </div>
                  </div>
                ) : active === 'fluxos' ? (
                  // What sets it in motion: triggers (allowed vs configured), routines
                  // and the relationships with other agents/sectors.
                  <div style={{ display: 'grid', gap: 20 }}>
                    <TriggersPanel overview={overview} onFixed={load} />
                    <TeamsPanel overview={overview} fid={fid} />
                    <AgentRoutines key={`${agent._id}:routines`} agent={agent} />
                    {/* The other half of "what sets it in motion": an endpoint another
                        system calls. Same agent-native shape as Rotinas. */}
                    <AgentEventTriggers key={`${agent._id}:triggers`} agent={agent} />
                    <AgentActivations key={`${agent._id}:activations`} agent={agent} />
                    {/* The pendency "sem colaboradores" is solved right here — the
                        checklist and the readiness card link straight to it. */}
                    <CollaborationEditor key={`${agent._id}:collab`} agent={agent} onSaved={load} />
                  </div>
                ) : (
                  <>
                    {active === 'visao-geral' ? (
                      <div style={{ display: 'grid', gap: 14, marginBottom: 18 }}>
                        <ReadinessCard overview={overview} onGo={goToSection} />
                        <AgentSummaryCard agent={agent} overview={overview} />
                      </div>
                    ) : null}
                    {/* Competências abrem a aba: é por elas que outro agente encontra
                        este, antes de ferramenta, conhecimento ou site. Aberto por padrão
                        para a aba não abrir como uma lista de títulos vazia. */}
                    {/* Competências e ferramentas reutilizáveis mudaram para dentro do
                        formulário, junto dos blocos que elas complementam. Aqui elas
                        ficavam soltas, uma antes e outra depois, e a aba abria com três
                        blocos que não conversavam entre si. */}
                    <AgentForm key={`${agent._id}:${active}`} agent={agent} section={active} layout="flat" onSaved={load} availableMetrics={overview.availableMetrics} />
                    {/* Deleting lives in Avançado, after every setting, and is
                        mounted ONLY there — it used to sit under Visão geral, the
                        first thing anyone opens. */}
                    {active === 'avancado' ? (
                      <div style={{ marginTop: 24 }}>
                        <DangerZone
                          title="Excluir este agente"
                          description={`Remove "${agent.name}" e a base de conhecimento dele. Não pode ser desfeito.`}
                          buttonLabel="Excluir agente"
                          confirmName={agent.name}
                          consequences={[
                            'As rotinas e gatilhos deste agente param de existir.',
                            'A base de conhecimento dele é removida.',
                            'O histórico de execuções já registrado é preservado.',
                          ]}
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

        {/* Com quem trabalha, onde fica e onde é usado. Desceram para cá: numa faixa
            de largura total os três dividem a linha em vez de empilhar numa coluna
            estreita, e nenhum deles empurra a altura de uma coluna que a outra tem
            que acompanhar. */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3" data-testid="agent-context">
          <ColleaguesCard agents={agents} currentId={agent._id} chars={chars} />
          <AgentSectorAssignment agentId={agent._id} floorId={agentFloorId} floorName={agentFloorName} onChanged={load} />
          <UsageCard overview={overview} />
        </div>
        </div>
      )}
    </AppLayout>
  )
}
