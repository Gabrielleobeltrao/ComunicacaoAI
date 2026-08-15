import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { useOptionalBuildingContext } from '../contexts/BuildingContext'
import { API_URL } from '../lib/api'
import { routineAction } from '../lib/agentRoutines'
import {
  absoluteWhen,
  agentFlowPath,
  averageTokensLabel,
  AUTOMATION_STATUS_LABEL,
  AUTOMATION_STATUS_PILL,
  EXECUTION_TABS,
  getExecutionSummary,
  listExecutions,
  relativeWhen,
  RUN_STATUS_LABEL,
  RUN_STATUS_PILL,
  statusOptionsFor,
  tokensLabel,
} from '../lib/executions'
import type { ExecutionFilters, ExecutionSummary, ExecutionTab, RunItem, ScheduledItem, TriggerItem } from '../lib/executions'
import { Button, Card, EmptyState, Icon, MetricStat, Select, StatusPill, Tag } from '../ui'

// CENTRAL DE EXECUÇÕES — one building-wide place to see the work the agents do on
// their own: what is scheduled, what is armed and waiting for an event, what is
// running right now and what already happened.
//
// It is a CONTROL surface, not an editor. Creating and editing stay inside the
// agent (Fluxos), and every row links straight there. The only actions here are the
// ones an operator needs at a glance: pause, reactivate, copy an endpoint.

const TAB_LABEL: Record<ExecutionTab, string> = {
  scheduled: 'Agendadas',
  triggers: 'Gatilhos',
  active: 'Em andamento',
  history: 'Histórico',
}

const EMPTY: Record<ExecutionTab, { icon: string; title: string; body: string }> = {
  scheduled: { icon: 'clock', title: 'Nenhuma rotina agendada', body: 'Crie uma rotina na aba Fluxos de um agente para ele trabalhar em horários definidos.' },
  triggers: { icon: 'webhook', title: 'Nenhum gatilho por evento', body: 'Crie um gatilho na aba Fluxos de um agente para que ele reaja a eventos de outro sistema.' },
  active: { icon: 'loader', title: 'Nada em andamento', body: 'Quando uma rotina disparar ou um gatilho for acionado, a execução aparece aqui.' },
  history: { icon: 'history', title: 'Sem histórico', body: 'Execuções concluídas, com falha ou canceladas aparecem aqui.' },
}

const PAGE_SIZE = 20

const muted: React.CSSProperties = { margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }
const faint: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--text-faint)' }

// Floor · sector, skipping whatever is missing (an agent may have no sector).
function PlaceLine({ floorName, sectorName }: { floorName: string | null; sectorName: string | null }) {
  const parts = [floorName, sectorName].filter(Boolean)
  if (!parts.length) return null
  return <p style={faint}>{parts.join(' · ')}</p>
}

function OpenAgent({ agentId, floorId }: { agentId: string | null | undefined; floorId: string | null }) {
  if (!agentId) return null
  return (
    <Link to={agentFlowPath({ floorId, floorName: null, sectorId: null, sectorName: null }, agentId)} style={{ textDecoration: 'none' }}>
      <Button size="sm" variant="ghost" icon="external-link">
        Abrir agente
      </Button>
    </Link>
  )
}

// A row is a Card everywhere: dense on desktop (title, meta and actions on one
// line), stacked and touch-sized on a phone. One component, no duplicated markup.
function Row({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <Card padding="14px 16px" style={{ display: 'grid', gap: 10 }}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div style={{ minWidth: 0, display: 'grid', gap: 3 }}>{children}</div>
        {actions ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>{actions}</div> : null}
      </div>
    </Card>
  )
}

function ScheduledRow({ item, onChanged }: { item: ScheduledItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const act = async (action: 'activate' | 'pause') => {
    if (!item.agent) return
    setBusy(true)
    setFailed(false)
    try {
      await routineAction(item.agent.id, item.id, action)
      onChanged()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Row
      actions={
        <>
          {item.agent ? (
            item.status === 'active' ? (
              <Button size="sm" variant="secondary" icon="pause" onClick={() => void act('pause')} disabled={busy} data-testid="pause-scheduled">
                Pausar
              </Button>
            ) : (
              <Button size="sm" variant="secondary" icon="play" onClick={() => void act('activate')} disabled={busy} data-testid="activate-scheduled">
                Ativar
              </Button>
            )
          ) : null}
          <OpenAgent agentId={item.agent?.id} floorId={item.place.floorId} />
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--text-heading)' }}>{item.name}</span>
        <StatusPill status={AUTOMATION_STATUS_PILL[item.status]} label={AUTOMATION_STATUS_LABEL[item.status]} pulse={false} />
        {item.agent ? <Tag>{item.agent.name}</Tag> : null}
      </div>
      <PlaceLine floorName={item.place.floorName} sectorName={item.place.sectorName} />
      {item.objective ? (
        <p style={{ ...muted, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.objective}</p>
      ) : null}
      <p style={muted}>
        {item.scheduleLabel}
        {item.timezone ? ` · ${item.timezone}` : ''}
      </p>
      <p style={muted} data-testid="next-run">
        <strong style={{ color: 'var(--text-heading)' }}>Próxima: </strong>
        {item.nextRunAt ? `${relativeWhen(item.nextRunAt)} · ${absoluteWhen(item.nextRunAt)}` : 'sem próxima execução'}
      </p>
      <p style={faint}>
        Última: {item.lastRun ? `${RUN_STATUS_LABEL[item.lastRun.status]} · ${absoluteWhen(item.lastRun.finishedAt)}` : '—'} · {averageTokensLabel(item.averageTokens, item.recentRuns)}
      </p>
      {failed ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--status-blocked)' }}>Não foi possível alterar. Tente de novo.</p> : null}
    </Row>
  )
}

function TriggerRow({ item, onChanged }: { item: TriggerItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const act = async (action: 'activate' | 'pause') => {
    if (!item.agent) return
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch(`${API_URL}/api/agents/${item.agent.id}/event-triggers/${item.id}/${action}`, { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      onChanged()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!item.endpoint) return
    await navigator.clipboard.writeText(item.endpoint)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Row
      actions={
        <>
          {item.endpoint ? (
            <Button size="sm" variant="secondary" icon="copy" onClick={() => void copy()} data-testid="copy-endpoint">
              {copied ? 'Copiado' : 'Copiar URL'}
            </Button>
          ) : null}
          {item.agent ? (
            item.status === 'active' ? (
              <Button size="sm" variant="ghost" icon="pause" onClick={() => void act('pause')} disabled={busy}>
                Pausar
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon="play" onClick={() => void act('activate')} disabled={busy}>
                Ativar
              </Button>
            )
          ) : null}
          <OpenAgent agentId={item.agent?.id} floorId={item.place.floorId} />
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--text-heading)' }}>{item.name}</span>
        <StatusPill status={AUTOMATION_STATUS_PILL[item.status]} label={item.status === 'active' ? 'Aguardando evento' : AUTOMATION_STATUS_LABEL[item.status]} pulse={false} />
        {item.agent ? <Tag>{item.agent.name}</Tag> : null}
        {item.requireSignature ? <Tag>Assinatura obrigatória</Tag> : null}
      </div>
      <PlaceLine floorName={item.place.floorName} sectorName={item.place.sectorName} />
      {item.objective ? <p style={muted}>{item.objective}</p> : null}
      {item.endpoint ? <p style={{ ...faint, wordBreak: 'break-all' }}>{item.endpoint}</p> : null}
      <p style={faint}>
        Última ativação: {item.lastActivationAt ? `${relativeWhen(item.lastActivationAt)} · ${absoluteWhen(item.lastActivationAt)}` : 'nunca acionado'}
        {item.lastResult ? ` · ${RUN_STATUS_LABEL[item.lastResult.status]}` : ''} · {averageTokensLabel(item.averageTokens, item.recentRuns)}
      </p>
      {failed ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--status-blocked)' }}>Não foi possível alterar. Tente de novo.</p> : null}
    </Row>
  )
}

function RunRow({ item }: { item: RunItem }) {
  const when = item.finishedAt ?? item.startedAt ?? item.queuedAt
  return (
    <Row actions={<OpenAgent agentId={item.agent?.id} floorId={item.place.floorId} />}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--text-heading)' }}>{item.name}</span>
        <StatusPill status={RUN_STATUS_PILL[item.status]} label={RUN_STATUS_LABEL[item.status]} pulse={item.status === 'running'} />
        {item.agent ? <Tag>{item.agent.name}</Tag> : null}
        <Tag>{item.triggerType === 'schedule' ? 'Agendada' : item.triggerType === 'webhook' ? 'Evento' : 'Manual'}</Tag>
      </div>
      <PlaceLine floorName={item.place.floorName} sectorName={item.place.sectorName} />
      <p style={muted}>
        {relativeWhen(when)} · {absoluteWhen(when)}
      </p>
      <p style={faint}>
        {item.tokens > 0 ? `${tokensLabel(item.tokens)} tokens` : 'sem consumo registrado'}
        {item.errorKind ? ` · falha: ${item.errorKind}` : ''}
      </p>
    </Row>
  )
}

interface FilterOptions {
  floors: { id: string; name: string }[]
  sectors: { _id: string; name: string; floorId?: string; members?: { agentId: string }[] }[]
  agents: { _id: string; name: string; floorId?: string }[]
}

// The filters are conjunctive on the server, so the pickers must be conjunctive
// here too: choosing a floor or a sector NARROWS what an agent can be, and a
// selection that no longer fits is cleared instead of being sent as an impossible
// combination.
export function narrowFilters(next: ExecutionFilters, options: FilterOptions): ExecutionFilters {
  const out: ExecutionFilters = { ...next }
  if (out.floorId) {
    const sector = options.sectors.find((s) => s._id === out.sectorId)
    if (sector && sector.floorId && sector.floorId !== out.floorId) out.sectorId = undefined
    const agent = options.agents.find((a) => a._id === out.agentId)
    if (agent && agent.floorId && agent.floorId !== out.floorId) out.agentId = undefined
  }
  if (out.sectorId && out.agentId) {
    const sector = options.sectors.find((s) => s._id === out.sectorId)
    const members = sector?.members?.map((m) => m.agentId) ?? []
    // A sector we know the membership of, that does not contain this agent: the
    // agent goes, because the sector is the wider choice the user just made.
    if (sector && !members.includes(out.agentId)) out.agentId = undefined
  }
  return out
}

// Agents the current floor/sector selection allows.
export function agentsFor(filters: ExecutionFilters, options: FilterOptions): FilterOptions['agents'] {
  const sector = filters.sectorId ? options.sectors.find((s) => s._id === filters.sectorId) : undefined
  const members = sector?.members?.map((m) => m.agentId)
  return options.agents
    .filter((a) => !filters.floorId || !a.floorId || a.floorId === filters.floorId)
    .filter((a) => !members || members.includes(a._id))
}

export const activeFilterCount = (f: ExecutionFilters): number => [f.floorId, f.sectorId, f.agentId, f.status].filter(Boolean).length

function Filters({
  tab,
  filters,
  options,
  onChange,
}: {
  tab: ExecutionTab
  filters: ExecutionFilters
  options: FilterOptions
  onChange: (next: ExecutionFilters) => void
}) {
  const set = (key: keyof ExecutionFilters, value: string) => onChange(narrowFilters({ ...filters, [key]: value || undefined }, options))
  // Narrow the pickers to what the wider choices already allow.
  const sectors = filters.floorId ? options.sectors.filter((s) => !s.floorId || s.floorId === filters.floorId) : options.sectors
  const agents = agentsFor(filters, options)
  return (
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))' }} data-testid="execution-filters">
      <Select
        value={filters.floorId ?? ''}
        onChange={(e) => onChange(narrowFilters({ ...filters, floorId: e.target.value || undefined }, options))}
        options={[{ value: '', label: 'Todos os andares' }, ...options.floors.map((f) => ({ value: f.id, label: f.name }))]}
        aria-label="Filtrar por andar"
      />
      <Select
        value={filters.sectorId ?? ''}
        onChange={(e) => set('sectorId', e.target.value)}
        options={[{ value: '', label: 'Todos os setores' }, ...sectors.map((s) => ({ value: s._id, label: s.name }))]}
        aria-label="Filtrar por setor"
      />
      <Select
        value={filters.agentId ?? ''}
        onChange={(e) => set('agentId', e.target.value)}
        options={[{ value: '', label: 'Todos os agentes' }, ...agents.map((a) => ({ value: a._id, label: a.name }))]}
        aria-label="Filtrar por agente"
      />
      <Select value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)} options={statusOptionsFor(tab)} aria-label="Filtrar por estado" />
    </div>
  )
}

// The mobile filter SHEET — a real overlay, not a hidden div: it dims the page,
// closes on Escape or on the backdrop, locks the background scroll while it is open,
// and only applies what the user chose when they say so. Desktop never sees it; the
// filters stay inline there.
function FilterSheet({
  open,
  tab,
  filters,
  options,
  onApply,
  onClose,
}: {
  open: boolean
  tab: ExecutionTab
  filters: ExecutionFilters
  options: FilterOptions
  onApply: (next: ExecutionFilters) => void
  onClose: () => void
}) {
  // Edited in the sheet, committed on "Aplicar" — a phone should not refetch on
  // every tap of a picker.
  const [draft, setDraft] = useState<ExecutionFilters>(filters)
  useEffect(() => {
    if (open) setDraft(filters)
  }, [open, filters])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="lg:hidden" role="dialog" aria-modal="true" aria-label="Filtros" data-testid="filter-sheet" style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      <div onClick={onClose} data-testid="filter-sheet-backdrop" style={{ position: 'absolute', inset: 0, background: 'rgba(15,20,32,.5)' }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: '85dvh',
          overflowY: 'auto',
          display: 'grid',
          gap: 14,
          padding: '18px 16px calc(18px + var(--safe-bottom))',
          background: 'var(--surface-card)',
          borderTopLeftRadius: 'var(--radius-panel)',
          borderTopRightRadius: 'var(--radius-panel)',
          boxShadow: '0 -16px 40px rgba(22,24,31,.24)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: 'var(--text-heading)' }}>Filtros</span>
          <button
            onClick={onClose}
            aria-label="Fechar filtros"
            data-testid="close-filter-sheet"
            style={{ display: 'grid', placeItems: 'center', width: 'var(--hit-min)', height: 'var(--hit-min)', background: 'transparent', border: 0, color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        <Filters tab={tab} filters={draft} options={options} onChange={setDraft} />

        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            block
            onClick={() => {
              onApply(draft)
              onClose()
            }}
            data-testid="apply-filters"
          >
            Aplicar
          </Button>
          <Button
            block
            variant="ghost"
            onClick={() => setDraft({})}
            data-testid="clear-filters"
          >
            Limpar
          </Button>
        </div>
      </div>
    </div>
  )
}

export function Executions() {
  const building = useOptionalBuildingContext()
  const [tab, setTab] = useState<ExecutionTab>('scheduled')
  const [filters, setFilters] = useState<ExecutionFilters>({})
  const [page, setPage] = useState(0)
  const [items, setItems] = useState<(ScheduledItem | TriggerItem | RunItem)[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [summary, setSummary] = useState<ExecutionSummary | null>(null)
  const [options, setOptions] = useState<FilterOptions>({ floors: [], sectors: [], agents: [] })
  // Mobile keeps the filters behind a sheet so the list owns the screen.
  const [filtersOpen, setFiltersOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [listed, counters] = await Promise.all([
        listExecutions<ScheduledItem | TriggerItem | RunItem>(tab, filters, { limit: PAGE_SIZE, skip: page * PAGE_SIZE }),
        // The same filters: the header describes the set the rows come from.
        getExecutionSummary(filters),
      ])
      setItems(listed.items)
      setTotal(listed.total)
      setSummary(counters)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [tab, filters, page])

  useEffect(() => {
    void load()
  }, [load])

  // Filter options: floors come from the building context; sectors and agents are
  // owner-scoped listings the backend already exposes.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API_URL}/api/agents`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_URL}/api/sectors`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([agents, sectors]) => {
        if (!cancelled) setOptions((prev) => ({ ...prev, agents, sectors }))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setOptions((prev) => ({ ...prev, floors: (building?.floors ?? []).map((f) => ({ id: f.id, name: f.name })) }))
  }, [building?.floors])

  const changeTab = (next: ExecutionTab) => {
    setTab(next)
    setPage(0)
    // A run status means nothing on the schedules tab, and vice versa.
    setFilters((f) => ({ ...f, status: undefined }))
  }

  const changeFilters = (next: ExecutionFilters) => {
    setFilters(next)
    setPage(0)
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const empty = EMPTY[tab]

  const counters = useMemo(
    () => [
      { key: 'next24h', label: 'Próximas 24h', value: summary ? String(summary.next24h) : '—', icon: 'clock' },
      { key: 'triggers', label: 'Gatilhos ativos', value: summary ? String(summary.activeTriggers) : '—', icon: 'webhook' },
      { key: 'inflight', label: 'Em fila / execução', value: summary ? String(summary.inFlight) : '—', icon: 'loader' },
      {
        key: 'tokens',
        label: summary ? `Tokens em ${summary.windowDays} dias` : 'Tokens',
        value: summary ? tokensLabel(summary.tokensWindow) : '—',
        icon: 'coins',
        // The sample behind the number, so it reads as a measurement, not a forecast.
        hint: summary ? `${summary.runsWindow} execução(ões) no período` : undefined,
      },
    ],
    [summary],
  )

  return (
    <AppLayout
      current="/executions"
      title="Execuções"
      subtitle="Tudo o que os agentes fazem sozinhos: agendado, aguardando evento, em andamento e concluído."
      actions={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/settings/logs" style={{ textDecoration: 'none' }}>
            <Button variant="ghost" size="sm" icon="scroll-text" data-testid="open-logs">
              Ver logs
            </Button>
          </Link>
          <Button variant="secondary" size="sm" icon="refresh-cw" onClick={() => void load()} data-testid="refresh-executions">
            Atualizar
          </Button>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        {/* Counters — measured, never estimated. */}
        <Card padding="16px" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))' }} data-testid="execution-counters">
          {counters.map((c) => (
            <div key={c.key}>
              <MetricStat label={c.label} value={c.value} icon={c.icon} />
              {c.hint ? <p style={{ ...faint, marginTop: 2 }}>{c.hint}</p> : null}
            </div>
          ))}
        </Card>

        {/* Tabs — horizontally scrollable on a phone instead of wrapping. */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius-control)', background: 'var(--surface-sunken)', overflowX: 'auto', maxWidth: '100%' }} role="tablist" data-testid="execution-tabs">
            {EXECUTION_TABS.map((key) => (
              <button
                key={key}
                role="tab"
                aria-selected={key === tab}
                onClick={() => changeTab(key)}
                data-testid={`tab-${key}`}
                style={{
                  minHeight: 36,
                  padding: '0 14px',
                  borderRadius: 'var(--radius-xs)',
                  border: 0,
                  whiteSpace: 'nowrap',
                  background: key === tab ? 'var(--surface-card)' : 'transparent',
                  boxShadow: key === tab ? 'var(--shadow-flat)' : 'none',
                  color: key === tab ? 'var(--text-heading)' : 'var(--text-muted)',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {TAB_LABEL[key]}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" icon="sliders-horizontal" onClick={() => setFiltersOpen(true)} className="lg:hidden" data-testid="toggle-filters">
            Filtros{activeFilterCount(filters) ? ` (${activeFilterCount(filters)})` : ''}
          </Button>
        </div>

        {/* Desktop: filters always visible. Mobile: inside the sheet below. */}
        <div className="hidden lg:block">
          <Filters tab={tab} filters={filters} options={options} onChange={changeFilters} />
        </div>
        <FilterSheet open={filtersOpen} tab={tab} filters={filters} options={options} onApply={changeFilters} onClose={() => setFiltersOpen(false)} />

        {loading ? (
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }} data-testid="executions-loading">
            Carregando…
          </p>
        ) : error ? (
          <Card padding="20px" style={{ display: 'grid', gap: 10, justifyItems: 'start' }} data-testid="executions-error">
            <p style={{ margin: 0, fontSize: 14, color: 'var(--status-blocked)' }}>Não foi possível carregar as execuções.</p>
            <Button size="sm" variant="secondary" icon="refresh-cw" onClick={() => void load()}>
              Tentar de novo
            </Button>
          </Card>
        ) : items.length === 0 ? (
          <div data-testid="executions-empty">
            <EmptyState icon={empty.icon} title={empty.title} body={empty.body} />
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }} data-testid="executions-list">
            {items.map((item) =>
              'kind' in item && item.kind === 'schedule' ? (
                <ScheduledRow key={item.id} item={item as ScheduledItem} onChanged={() => void load()} />
              ) : 'kind' in item && item.kind === 'webhook' ? (
                <TriggerRow key={item.id} item={item as TriggerItem} onChanged={() => void load()} />
              ) : (
                <RunRow key={item.id} item={item as RunItem} />
              ),
            )}
          </div>
        )}

        {!loading && !error && total > PAGE_SIZE ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <Icon name="chevron-left" size={16} /> Anterior
            </Button>
            <span style={muted}>
              Página {page + 1} de {pages} · {total} no total
            </span>
            <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
              Próxima <Icon name="chevron-right" size={16} />
            </Button>
          </div>
        ) : null}
      </div>
    </AppLayout>
  )
}
