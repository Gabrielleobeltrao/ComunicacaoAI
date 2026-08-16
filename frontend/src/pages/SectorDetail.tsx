import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AgentBadges } from '../components/AgentBadges'
import { AppLayout } from '../components/AppLayout'
import { DangerZone } from '../components/DangerZone'
import { SectorForm } from '../components/SectorForm'
import { SectorExecutions } from '../components/SectorExecutions'
import { SectorKnowledge } from '../components/SectorKnowledge'
import { API_URL } from '../lib/api'
import { SectorApiError, getSectorOverview, sectorModeLabel } from '../lib/sectors'
import { SectorHero } from '../components/SectorHero'
import { SectorFlow } from '../components/SectorFlow'
import { SectorAgentsDialog } from '../components/SectorAgentsDialog'
import { MoveSectorWizard } from '../components/MoveSectorWizard'
import { useActiveFloorId, useOptionalBuildingContext } from '../contexts/BuildingContext'
import { floorAgent, floorSector, floorSectors } from '../lib/floorRoutes'
import { Button } from '../ui'
import { LEGACY_SECTOR_SECTION, SECTOR_SECTIONS } from '../lib/sectorSections'
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

function ReadinessPanel({ overview, onFix }: { overview: SectorOverview; onFix: () => void }) {
  const issues = overview.readiness?.issues ?? []
  if (issues.length === 0) return null
  return (
    <div className="rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4" data-testid="sector-readiness-panel">
      <ul className="space-y-1">
        {issues.map((i, idx) => (
          <li key={`${i.code}-${idx}`} className={`text-sm ${i.severity === 'blocking' ? 'text-(--coral-600)' : 'text-(--mango-700)'}`}>
            {i.message}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onFix} className="mt-2 text-xs underline" style={{ color: 'var(--intent-brand)' }}>
        {issues[0].action}
      </button>
    </div>
  )
}

function OverviewSection({ overview, agents }: { overview: SectorOverview; agents: AgentSummary[] }) {
  const { sector, analytics, linkedWidgets } = overview
  const fid = useActiveFloorId()
  const nameById = new Map(agents.map((a) => [a._id, a.name]))
  const agentById = new Map(agents.map((a) => [a._id, a]))
  const isPipeline = sector.mode === 'pipeline'
  // Agents that are wired in but still need their OWN setup — the backend reports
  // them by name, so the card can say so instead of failing silently at run time.
  const pendingNames = new Set((overview.readiness?.issues ?? []).filter((i) => i.code === 'agent_pending').map((i) => i.message.split(' ainda precisa')[0]))
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
          {sector.coordinatorAgentId === m.agentId && <Badge>Coordena</Badge>}
          {full && pendingNames.has(full.name) && (
            <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: 'var(--mango-100, #fef3e6)', color: 'var(--mango-700, #b54708)' }} data-testid="member-pending">
              Precisa de configuração
            </span>
          )}
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
        <h3 className="mb-3 text-sm font-medium text-(--text-muted)">Como o trabalho anda</h3>
        <div className="rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4">
          <SectorFlow sector={sector} agents={agents} />
        </div>
      </section>

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
  const building = useOptionalBuildingContext()
  const navigate = useNavigate()
  const [overview, setOverview] = useState<SectorOverview | null>(null)
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)

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
  const loadAgents = useCallback(async () => {
    if (!sectorFloorId) return
    const list = await fetch(`${API_URL}/api/agents?floorId=${sectorFloorId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
    setAgents(list)
  }, [sectorFloorId])
  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  // Confirmed by the dialog in DangerZone, which requires the sector's name to be
  // typed. This only performs what was already confirmed.
  async function handleDelete() {
    if (!overview || deleting) return
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
  const raw = LEGACY_SECTOR_SECTION[section ?? ''] ?? section ?? ''
  const active = SECTOR_SECTIONS.some((s) => s.key === raw) ? raw : ''
  const floorName = building?.floors.find((f) => f.id === sector?.floorId)?.name ?? 'este andar'
  const tabHref = (key: string) => (fid ? (key ? floorSector(fid, sector!._id, key) : floorSector(fid, sector!._id)) : key ? `/setores/${sector!._id}/${key}` : `/setores/${sector!._id}`)

  const titleExtra = sector ? (
    <>
      <Badge>{sectorModeLabel(sector.mode)}</Badge>
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
          <SectorHero
            sector={sector}
            agents={agents}
            floorName={floorName}
            actions={
              <Button icon="users-round" onClick={() => setManageOpen(true)}>
                Gerenciar agentes
              </Button>
            }
          />

          <SectorAgentsDialog open={manageOpen} onClose={() => setManageOpen(false)} sector={sector} floorAgents={agents} onChanged={load} />

          <MoveSectorWizard
            open={moveOpen}
            onClose={() => setMoveOpen(false)}
            sector={sector}
            floors={(building?.floors ?? []).map((f) => ({ id: f.id, name: f.name }))}
            onMoved={(targetFloorId) => {
              setMoveOpen(false)
              navigate(floorSector(targetFloorId, sector._id))
              void load()
            }}
          />

          {/* Visible in-page navigation (canonical, URL-active, scrolls on mobile). */}
          <nav aria-label="Seções do setor" style={{ display: 'flex', gap: 4, overflowX: 'auto', borderBottom: '1px solid var(--border-subtle)' }}>
            {SECTOR_SECTIONS.map((s) => {
              const on = active === s.key
              return (
                <Link
                  key={s.key || 'overview'}
                  to={tabHref(s.key)}
                  aria-current={on ? 'page' : undefined}
                  style={{ flexShrink: 0, minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: '0 14px', fontSize: 14, fontWeight: on ? 700 : 500, color: on ? 'var(--intent-brand)' : 'var(--text-muted)', borderBottom: on ? '2px solid var(--intent-brand)' : '2px solid transparent', textDecoration: 'none', whiteSpace: 'nowrap' }}
                >
                  {s.label}
                </Link>
              )
            })}
          </nav>

          {active === '' ? (
            <div className="space-y-4">
              <ReadinessPanel overview={overview} onFix={() => navigate(tabHref('equipe'))} />
              <OverviewSection overview={overview} agents={agents} />
            </div>
          ) : (
            <div className="space-y-4">
              {active !== 'avancado' && (
                <div className="rounded-xl border border-(--border-subtle) bg-(--surface-card) p-6">
                  {active === 'equipe' ? (
                    // Inline editing: the team and its flow are changed right here,
                    // no separate "edit sector" screen.
                    <SectorForm key={sector._id} sector={sector} agents={agents} sectors={[sector]} onSaved={load} onAgentsChanged={loadAgents} />
                  ) : active === 'conhecimento' ? (
                    <SectorKnowledge key={sector._id} sectorId={sector._id} />
                  ) : active === 'execucoes' ? (
                    // Desempenho, Histórico and — last, labelled as a test — the
                    // playground. It used to be the playground alone.
                    <SectorExecutions sector={sector} agents={agents} />
                  ) : null}
                </div>
              )}
              {active === 'avancado' && (
                <>
                  <div className="flex flex-col gap-2 rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-(--text-heading)">Mover de andar</p>
                      <p className="text-sm text-(--text-muted)">Leva este setor para outro andar preservando histórico e canais. Os agentes atuais permanecem no andar de origem.</p>
                    </div>
                    <Button variant="secondary" icon="arrow-right-left" onClick={() => setMoveOpen(true)}>
                      Mover de andar
                    </Button>
                  </div>
                  <DangerZone
                    title="Excluir este setor"
                    description={`Remove "${overview.sector.name}". Não pode ser desfeito.`}
                    buttonLabel="Excluir setor"
                    confirmName={overview.sector.name}
                    consequences={[
                      'O setor deixa de existir como unidade executável.',
                      'Os agentes que participavam dele continuam existindo.',
                      'O histórico de execuções já registrado é preservado.',
                    ]}
                    onDelete={handleDelete}
                    deleting={deleting}
                    deleteError={deleteError}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </AppLayout>
  )
}
