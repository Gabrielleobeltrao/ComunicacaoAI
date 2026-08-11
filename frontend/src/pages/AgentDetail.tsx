import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AgentForm } from '../components/AgentForm'
import { AgentPlayground } from '../components/AgentPlayground'
import { AppLayout } from '../components/AppLayout'
import { DangerZone } from '../components/DangerZone'
import { accentFor, buildCharacterResolver } from '../lib/agentAvatar'
import type { CharacterResolver } from '../lib/agentAvatar'
import { roleLabelOf, skillsOf } from '../lib/agentPresentation'
import { API_URL } from '../lib/api'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import type { AgentOverview, AgentSummary } from '../lib/types'
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
  const colleagues = agents.filter((x) => x._id !== currentId).slice(0, 5)
  if (colleagues.length === 0) return null
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Colegas de mesa</span>
      {colleagues.map((x) => (
        <button
          key={x._id}
          onClick={() => navigate(`/agents/${x._id}`)}
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
  const { linkedWidgets, linkedSectors, knowledgeCount } = overview
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
      <div>
        <p style={{ marginBottom: 6, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Setores</p>
        {linkedSectors.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>Não faz parte de nenhum setor.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {linkedSectors.map((t) => (
              <Tag key={t._id}>{t.name}</Tag>
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
  const navigate = useNavigate()
  const { agents } = useAgentsAndWidgets()
  const chars = useMemo(() => buildCharacterResolver(agents.map((a) => a._id)), [agents])
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
      const res = await fetch(`${API_URL}/api/agents/${overview.agent._id}`, { method: 'DELETE', credentials: 'include' })
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
  const active = TAB_KEYS.includes(section ?? '') ? (section as string) : 'essencial'
  const accent = agent ? accentFor(agent._id) : 'var(--intent-brand)'
  const stats = overview?.stats
  const attendanceRate = stats && stats.conversations > 0 ? Math.round((stats.attendedConversations / stats.conversations) * 100) : 0

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
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ProfileCard agent={agent} stats={stats} accent={accent} portrait={chars.portrait(agent._id)} />
            <ColleaguesCard agents={agents} currentId={agent._id} chars={chars} />
            <UsageCard overview={overview} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
              <Card padding="16px">
                <MetricStat icon="messages-square" label="Conversas" value={stats.conversations.toLocaleString('pt-BR')} />
              </Card>
              <Card padding="16px">
                <MetricStat icon="message-circle" label="Mensagens/sem" value={stats.messagesThisWeek.toLocaleString('pt-BR')} />
              </Card>
              <Card padding="16px">
                <MetricStat icon="user-check" label="Leads" value={stats.qualifiedLeads.toLocaleString('pt-BR')} />
              </Card>
              <Card padding="16px">
                <MetricStat icon="percent" label="Atendimento" value={attendanceRate} unit="%" />
              </Card>
            </div>

            <Card padding="0" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
                <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius-control)', background: 'var(--surface-sunken)' }}>
                  {TABS.map((t) => {
                    const on = t.key === active
                    return (
                      <button
                        key={t.key}
                        onClick={() => navigate(`/agents/${agent._id}/${t.key}`)}
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
                ) : (
                  <>
                    <AgentForm key={`${agent._id}:${active}`} agent={agent} section={active} layout="flat" onSaved={load} />
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
