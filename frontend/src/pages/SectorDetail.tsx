import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AgentBadges } from '../components/AgentBadges'
import { AppLayout } from '../components/AppLayout'
import { DangerZone } from '../components/DangerZone'
import { SectorForm } from '../components/SectorForm'
import { SectorPlayground } from '../components/SectorPlayground'
import { API_URL } from '../lib/api'
import { SectorApiError, getSectorOverview } from '../lib/sectors'
import { useActiveFloorId } from '../contexts/BuildingContext'
import { floorAgent, floorSector, floorSectors } from '../lib/floorRoutes'
import { SECTOR_SECTIONS } from '../lib/sectorSections'
import type { AgentSummary, SectorOverview } from '../lib/types'

function Metric({ label, value, suffix, hint }: { label: string; value: number; suffix?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4">
      <p className="text-2xl font-semibold">
        {value.toLocaleString('pt-BR')}
        {suffix}
      </p>
      <p className="mt-1 text-sm text-(--text-muted)">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-(--text-faint)">{hint}</p>}
    </div>
  )
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-(--border-strong) px-2.5 py-0.5 text-xs text-(--text-body)">{children}</span>
  )
}

function OverviewSection({ overview, agents }: { overview: SectorOverview; agents: AgentSummary[] }) {
  const { sector, analytics, linkedWidgets } = overview
  const fid = useActiveFloorId()
  const nameById = new Map(agents.map((a) => [a._id, a.name]))
  const agentById = new Map(agents.map((a) => [a._id, a]))
  const isPipeline = sector.mode === 'pipeline'
  const maxCount = Math.max(1, ...(analytics?.specialists.map((s) => s.count) ?? []))

  const renderMember = (m: (typeof sector.members)[number], index: number) => {
    const full = agentById.get(m.agentId)
    const inner = (
      <>
        <div className="flex items-center gap-2">
          {isPipeline && <span className="text-sm text-(--text-faint)">{index + 1}.</span>}
          <span className={`font-medium ${full ? '' : 'text-(--text-faint)'}`}>
            {full ? full.name : 'Agente removido'}
          </span>
          {m.isDefault && <Badge>Padrão</Badge>}
        </div>
        {full && (
          <div className="mt-2">
            <AgentBadges agent={full} />
          </div>
        )}
        {m.routingDescription && <p className="mt-2 text-sm text-(--text-muted)">{m.routingDescription}</p>}
        {isPipeline && index < sector.members.length - 1 && m.advanceWhen && (
          <p className="mt-1 text-xs text-(--text-faint)">
            <span className="text-(--text-faint)">Avança quando:</span> {m.advanceWhen}
          </p>
        )}
        {isPipeline && m.transitions.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {m.transitions.map((t, ti) => (
              <li key={ti} className="text-xs text-(--text-faint)">
                <span className="text-(--text-faint)">Se</span> {t.condition || '…'}{' '}
                <span className="text-(--text-muted)">→ {nameById.get(t.targetAgentId) ?? 'etapa'}</span>
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
            to={`${fid ? floorAgent(fid, m.agentId) : `/agents/${m.agentId}`}?from=${encodeURIComponent(fid ? floorSector(fid, sector._id) : `/setores/${sector._id}`)}`}
            className="block rounded-xl border border-(--border-subtle) bg-(--surface-card) p-3 transition hover:border-(--border-strong)"
          >
            {inner}
          </Link>
        ) : (
          <div className="rounded-xl border border-(--border-subtle) bg-(--surface-card) p-3">{inner}</div>
        )}
      </li>
    )
  }

  // Adaptive sectors group members by sector; pipelines stay in stage order. The
  // "no sector" group sorts last, and a single empty group means no headings.
  const sectorGroups: [string, typeof sector.members][] = []
  if (!isPipeline) {
    const map = new Map<string, typeof sector.members>()
    for (const m of sector.members) {
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
        <h3 className="mb-3 text-sm font-medium text-(--text-muted)">
          {isPipeline ? 'Etapas do fluxo' : 'Agentes do setor'}
        </h3>
        {isPipeline || !showSectorHeadings ? (
          <ul className="space-y-2">
            {sector.members.map((m, index) => renderMember(m, index))}
          </ul>
        ) : (
          <div className="space-y-4">
            {sectorGroups.map(([area, members]) => (
              <div key={area || '_none'}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
                  {area || 'Sem área'}
                </p>
                <ul className="space-y-2">
                  {members.map((m) => renderMember(m, sector.members.indexOf(m)))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-medium text-(--text-muted)">Desempenho</h3>
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
            <div className="rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-(--text-faint)">
                {isPipeline ? 'Atividade por etapa' : 'Mais consultados'}
              </p>
              <ul className="space-y-1.5">
                {analytics.specialists.map((s) => (
                  <li key={s.name}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="text-(--text-body)">{s.name}</span>
                      <span className="text-(--text-faint)">{s.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-(--surface-sunken)">
                      <div
                        className="h-1.5 rounded-full bg-(--intent-brand)"
                        style={{ width: `${(s.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-sm text-(--text-faint)">
            Sem dados de orquestração ainda. Eles aparecem conforme o setor responde conversas.
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-medium text-(--text-muted)">Onde é usado</h3>
        <div className="rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-(--text-faint)">Widgets</p>
          {linkedWidgets.length === 0 ? (
            <p className="text-sm text-(--text-faint)">Nenhum widget usa este setor.</p>
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

export function SectorDetail() {
  const { sectorId, section } = useParams()
  const fid = useActiveFloorId()
  const navigate = useNavigate()
  const [overview, setOverview] = useState<SectorOverview | null>(null)
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!sectorId) return
    setLoading(true)
    setError(false)
    setNotFound(false)
    try {
      setOverview(await getSectorOverview(sectorId))
    } catch (e) {
      if (e instanceof SectorApiError && e.status === 404) setNotFound(true)
      else setError(true)
    } finally {
      setLoading(false)
    }
  }, [sectorId])

  useEffect(() => {
    load()
  }, [load])

  // Members + editing need agents of the SECTOR'S floor, not every floor (§3.8).
  const sectorFloorId = overview?.sector.floorId ?? fid ?? null
  useEffect(() => {
    if (!sectorFloorId) return
    let cancelled = false
    fetch(`${API_URL}/api/agents?floorId=${sectorFloorId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((a) => {
        if (!cancelled) setAgents(a)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sectorFloorId])

  async function handleDelete() {
    if (!overview || deleting) return
    if (!window.confirm(`Excluir o setor "${overview.sector.name}"? Essa ação não pode ser desfeita.`)) return
    setDeleteError(null)
    setDeleting(true)
    try {
      const res = await fetch(`${API_URL}/api/sectors/${overview.sector._id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null)
        setDeleteError(body?.error ?? 'Não foi possível excluir o setor.')
        return
      }
      navigate(fid ? floorSectors(fid) : '/setores')
    } finally {
      setDeleting(false)
    }
  }

  const sector = overview?.sector
  const raw = section ?? ''
  const active = SECTOR_SECTIONS.some((s) => s.key === raw) ? raw : ''
  const sectionLabel = SECTOR_SECTIONS.find((s) => s.key === active)?.label ?? 'Visão geral'

  const titleExtra = sector ? (
    <>
      <Badge>{sector.mode === 'pipeline' ? 'Fluxo' : 'Adaptativo'}</Badge>
      <Badge>{`${sector.members.length} ${sector.members.length === 1 ? 'agente' : 'agentes'}`}</Badge>
    </>
  ) : undefined

  return (
    <AppLayout current="/setores" title={sector?.name ?? 'Setor'} titleExtra={titleExtra}>
      {loading ? (
        <p className="text-sm text-(--text-muted)">Carregando setor...</p>
      ) : error ? (
        <p className="text-sm" style={{ color: 'var(--coral-600, #d92d20)' }}>
          Não foi possível carregar o setor.{' '}
          <button onClick={() => void load()} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--intent-brand,#2e5bff)', cursor: 'pointer', textDecoration: 'underline' }}>
            Tentar novamente
          </button>
        </p>
      ) : notFound || !overview || !sector ? (
        <p className="text-sm text-(--text-muted)">Setor não encontrado.</p>
      ) : (
        <div className="space-y-4">
          {active === '' ? (
            <OverviewSection overview={overview} agents={agents} />
          ) : (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">{sectionLabel}</h3>
              <div className="rounded-xl border border-(--border-subtle) bg-(--surface-card) p-6">
                {active === 'configuracao' ? (
                  <SectorForm key={sector._id} sector={sector} agents={agents} onSaved={load} />
                ) : active === 'testar' ? (
                  <SectorPlayground key={sector._id} sector={sector} />
                ) : null}
              </div>
              {active === 'configuracao' && (
                <DangerZone
                  title="Excluir este setor"
                  description="Não pode ser desfeito."
                  buttonLabel="Excluir setor"
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
