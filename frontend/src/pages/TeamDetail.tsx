import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AgentBadges } from '../components/AgentBadges'
import { AppLayout } from '../components/AppLayout'
import { DangerZone } from '../components/DangerZone'
import { TeamForm } from '../components/TeamForm'
import { TeamPlayground } from '../components/TeamPlayground'
import { API_URL } from '../lib/api'
import { TEAM_SECTIONS } from '../lib/teamSections'
import type { AgentSummary, TeamOverview } from '../lib/types'

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

function OverviewSection({ overview, agents }: { overview: TeamOverview; agents: AgentSummary[] }) {
  const { team, analytics, linkedWidgets } = overview
  const nameById = new Map(agents.map((a) => [a._id, a.name]))
  const agentById = new Map(agents.map((a) => [a._id, a]))
  const isPipeline = team.mode === 'pipeline'
  const maxCount = Math.max(1, ...(analytics?.specialists.map((s) => s.count) ?? []))

  const renderMember = (m: (typeof team.members)[number], index: number) => {
    const full = agentById.get(m.agentId)
    const inner = (
      <>
        <div className="flex items-center gap-2">
          {isPipeline && <span className="text-sm text-slate-500">{index + 1}.</span>}
          <span className={`font-medium ${full ? '' : 'text-slate-500'}`}>
            {full ? full.name : 'Agente removido'}
          </span>
          {m.isDefault && <Badge>Padrão</Badge>}
        </div>
        {full && (
          <div className="mt-2">
            <AgentBadges agent={full} />
          </div>
        )}
        {m.routingDescription && <p className="mt-2 text-sm text-slate-400">{m.routingDescription}</p>}
        {isPipeline && index < team.members.length - 1 && m.advanceWhen && (
          <p className="mt-1 text-xs text-slate-500">
            <span className="text-slate-600">Avança quando:</span> {m.advanceWhen}
          </p>
        )}
        {isPipeline && m.transitions.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {m.transitions.map((t, ti) => (
              <li key={ti} className="text-xs text-slate-500">
                <span className="text-slate-600">Se</span> {t.condition || '…'}{' '}
                <span className="text-slate-400">→ {nameById.get(t.targetAgentId) ?? 'etapa'}</span>
              </li>
            ))}
          </ul>
        )}
      </>
    )
    return (
      <li key={m.agentId}>
        {full ? (
          <Link
            to={`/agents/${m.agentId}?from=${encodeURIComponent(`/teams/${team._id}`)}`}
            className="block rounded-xl border border-slate-800 bg-slate-900 p-3 transition hover:border-slate-600"
          >
            {inner}
          </Link>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">{inner}</div>
        )}
      </li>
    )
  }

  // Adaptive teams group members by sector; pipelines stay in stage order. The
  // "no sector" group sorts last, and a single empty group means no headings.
  const sectorGroups: [string, typeof team.members][] = []
  if (!isPipeline) {
    const map = new Map<string, typeof team.members>()
    for (const m of team.members) {
      const key = (m.sector ?? '').trim()
      if (!map.has(key)) map.set(key, [])
      map.get(key)?.push(m)
    }
    sectorGroups.push(...[...map.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : 0)))
  }
  const showSectorHeadings = sectorGroups.length > 1 || (sectorGroups.length === 1 && sectorGroups[0][0] !== '')

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-medium text-slate-400">
          {isPipeline ? 'Etapas do fluxo' : 'Agentes da equipe'}
        </h3>
        {isPipeline || !showSectorHeadings ? (
          <ul className="space-y-2">
            {team.members.map((m, index) => renderMember(m, index))}
          </ul>
        ) : (
          <div className="space-y-4">
            {sectorGroups.map(([sector, members]) => (
              <div key={sector || '_none'}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {sector || 'Sem setor'}
                </p>
                <ul className="space-y-2">
                  {members.map((m) => renderMember(m, team.members.indexOf(m)))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-medium text-slate-400">Desempenho</h3>
        {analytics ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Metric label="Turnos orquestrados" value={analytics.decisions} />
              {isPipeline ? (
                <Metric label="Avanços/desvios" value={analytics.moves} />
              ) : (
                <Metric
                  label="Pediu esclarecimento"
                  value={Math.round(analytics.clarifyRate * 100)}
                  suffix="%"
                />
              )}
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                {isPipeline ? 'Atividade por etapa' : 'Mais consultados'}
              </p>
              <ul className="space-y-1.5">
                {analytics.specialists.map((s) => (
                  <li key={s.name}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="text-slate-300">{s.name}</span>
                      <span className="text-slate-500">{s.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800">
                      <div
                        className="h-1.5 rounded-full bg-slate-400"
                        style={{ width: `${(s.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Sem dados de orquestração ainda. Eles aparecem conforme a equipe responde conversas.
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-medium text-slate-400">Onde é usado</h3>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Widgets</p>
          {linkedWidgets.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum widget usa esta equipe.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {linkedWidgets.map((w) => (
                <li key={w._id}>
                  <Badge>{w.name}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

export function TeamDetail() {
  const { teamId, section } = useParams()
  const navigate = useNavigate()
  const [overview, setOverview] = useState<TeamOverview | null>(null)
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!teamId) return
    const res = await fetch(`${API_URL}/api/teams/${teamId}/overview`, { credentials: 'include' })
    if (res.status === 404) {
      setNotFound(true)
      setLoading(false)
      return
    }
    if (res.ok) setOverview(await res.json())
    setLoading(false)
  }, [teamId])

  useEffect(() => {
    load()
  }, [load])

  // Agents are needed to name members and to edit the team.
  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/api/agents`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((a) => {
        if (!cancelled) setAgents(a)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function handleDelete() {
    if (!overview || deleting) return
    if (!window.confirm(`Excluir a equipe "${overview.team.name}"? Essa ação não pode ser desfeita.`)) return
    setDeleteError(null)
    setDeleting(true)
    try {
      const res = await fetch(`${API_URL}/api/teams/${overview.team._id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null)
        setDeleteError(body?.error ?? 'Não foi possível excluir a equipe.')
        return
      }
      navigate('/teams')
    } finally {
      setDeleting(false)
    }
  }

  const team = overview?.team
  const raw = section ?? ''
  const active = TEAM_SECTIONS.some((s) => s.key === raw) ? raw : ''
  const sectionLabel = TEAM_SECTIONS.find((s) => s.key === active)?.label ?? 'Visão geral'

  const titleExtra = team ? (
    <>
      <Badge>{team.mode === 'pipeline' ? 'Fluxo' : 'Adaptativo'}</Badge>
      <Badge>{`${team.members.length} ${team.members.length === 1 ? 'agente' : 'agentes'}`}</Badge>
    </>
  ) : undefined

  return (
    <AppLayout current="/teams" title={team?.name ?? 'Equipe'} titleExtra={titleExtra}>
      {loading ? (
        <p className="text-sm text-slate-400">Carregando equipe...</p>
      ) : notFound || !overview || !team ? (
        <p className="text-sm text-slate-400">Equipe não encontrada.</p>
      ) : (
        <div className="space-y-4">
          {active === '' ? (
            <OverviewSection overview={overview} agents={agents} />
          ) : (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">{sectionLabel}</h3>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
                {active === 'configuracao' ? (
                  <TeamForm key={team._id} team={team} agents={agents} onSaved={load} />
                ) : active === 'testar' ? (
                  <TeamPlayground key={team._id} team={team} />
                ) : null}
              </div>
              {active === 'configuracao' && (
                <DangerZone
                  title="Excluir esta equipe"
                  description="Não pode ser desfeito."
                  buttonLabel="Excluir equipe"
                  onDelete={handleDelete}
                  deleting={deleting}
                  deleteError={deleteError}
                />
              )}
            </div>
          )}
        </div>
      )}
    </AppLayout>
  )
}
