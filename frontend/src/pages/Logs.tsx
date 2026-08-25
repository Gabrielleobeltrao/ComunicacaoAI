import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { useOptionalBuildingContext } from '../contexts/BuildingContext'
import { API_URL } from '../lib/api'
import { absoluteWhen, relativeWhen, RUN_STATUS_LABEL, RUN_STATUS_PILL, tokensLabel } from '../lib/executions'
import {
  auditLink,
  describeAudit,
  durationLabel,
  getRunLogDetail,
  listAuditLogs,
  listRunLogs,
  TRIGGER_LABEL,
  type AuditLogFilters,
  type AuditLogItem,
  type LogTab,
  type RunLogDetail,
  type RunLogFilters,
  type RunLogItem,
} from '../lib/logs'
import { Button, Card, Dialog, EmptyState, Field, Input, Select, StatusPill, Tag } from '../ui'

// O tipo técnico da etapa em português. O trace é lido por quem configurou o fluxo,
// não por quem escreveu o runner.
const STEP_LABEL: Record<string, string> = {
  'source.rss': 'Fonte RSS',
  'source.http': 'Fonte web',
  'agent.execute': 'IA',
  'transform.template': 'Preparar dado',
  'delivery.send': 'Entrega',
  'memory.write': 'Guardar na memória',
  'memory.search': 'Consultar memória',
  'memory.delete': 'Apagar da memória',
  'app.execute': 'Ação de App',
  'event.publish': 'Publicar evento',
}

// LOGS E AUDITORIA — the account's timeline, in two halves:
//   Execuções: what the agents ran, read from the runs themselves;
//   Alterações: what people changed, read from the append-only audit trail.
//
// Nothing here reveals content: no prompt, no payload, no output, no credential.
// An execution's detail explains WHAT HAPPENED — steps, timings, tokens, deliveries,
// artifact metadata and a bounded error — never what was said.

const PAGE_SIZE = 25

const muted: React.CSSProperties = { margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }
const faint: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--text-faint)' }

const TAB_LABEL: Record<LogTab, string> = { runs: 'Execuções', audit: 'Alterações' }

// A local date input ("2026-08-15") → the instant the API filters by.
const startOf = (value: string): string | undefined => (value ? new Date(`${value}T00:00:00`).toISOString() : undefined)
const endOf = (value: string): string | undefined => (value ? new Date(`${value}T23:59:59.999`).toISOString() : undefined)

function RunDetail({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<RunLogDetail | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(false)
    getRunLogDetail(runId)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [runId])

  return (
    <Dialog open title="Detalhe da execução" subtitle="O que aconteceu — sem conteúdo, prompt ou payload." width={640} onClose={onClose}>
      {error ? (
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--status-blocked)' }} data-testid="run-detail-error">
          Não foi possível carregar esta execução.
        </p>
      ) : !detail ? (
        <p style={muted} data-testid="run-detail-loading">
          Carregando…
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 16 }} data-testid="run-detail">
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusPill status={RUN_STATUS_PILL[detail.status]} label={RUN_STATUS_LABEL[detail.status]} pulse={false} />
              <Tag>{TRIGGER_LABEL[detail.triggerType] ?? detail.triggerType}</Tag>
              <Tag>versão {detail.automationVersion}</Tag>
            </div>
            {detail.requestId ? (
              <p style={faint} data-testid="run-detail-request">
                Correlação: {detail.requestId}
              </p>
            ) : null}
            <p style={muted}>
              Fila: {absoluteWhen(detail.queuedAt)} · Início: {absoluteWhen(detail.startedAt)} · Fim: {absoluteWhen(detail.finishedAt)}
            </p>
            <p style={muted}>
              Duração: {durationLabel(detail.durationMs)} · Tokens: {tokensLabel(detail.usage.inputTokens + detail.usage.outputTokens)} (
              {tokensLabel(detail.usage.inputTokens)} entrada / {tokensLabel(detail.usage.outputTokens)} saída)
            </p>
            {detail.error ? (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--status-blocked)' }} data-testid="run-detail-error-message">
                Falha ({detail.error.kind}): {detail.error.message}
              </p>
            ) : null}
          </div>

          <div>
            <p style={{ ...faint, fontWeight: 700, marginBottom: 6 }}>ETAPAS ({detail.steps.length})</p>
            {detail.steps.length === 0 ? (
              <p style={muted}>Nenhuma etapa registrada.</p>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {detail.steps.map((s) => (
                  <Card key={s.id} padding="10px 12px" style={{ display: 'grid', gap: 2 }} data-testid="run-step">
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)' }}>
                      {s.stepId} · {STEP_LABEL[s.stepType] ?? s.stepType}
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      {s.status} · tentativa {s.attempt} · {absoluteWhen(s.finishedAt ?? s.startedAt)}
                    </span>
                    {/* Uma etapa pulada sem motivo é indistinguível de uma etapa
                        esquecida — e o motivo que mais importa é o de não ter chamado
                        o modelo. */}
                    {s.skipReason ? (
                      <span style={{ fontSize: 12, color: 'var(--text-faint)' }} data-testid="run-step-skip">
                        Não rodou: {s.skipReason}
                      </span>
                    ) : null}
                    {s.error ? <span style={{ fontSize: 12, color: 'var(--status-blocked)' }}>{s.error.kind}: {s.error.message}</span> : null}
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div>
            <p style={{ ...faint, fontWeight: 700, marginBottom: 6 }}>ENTREGAS ({detail.deliveries.length})</p>
            {detail.deliveries.length === 0 ? (
              <p style={muted}>Nenhuma entrega.</p>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {detail.deliveries.map((d) => (
                  <Card key={d.id} padding="10px 12px" style={{ display: 'grid', gap: 2 }} data-testid="run-delivery">
                    <span style={{ fontSize: 13, color: 'var(--text-heading)' }}>
                      {d.provider} → {d.destinationMasked}
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      {d.status} · {absoluteWhen(d.sentAt ?? d.createdAt)}
                    </span>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div>
            <p style={{ ...faint, fontWeight: 700, marginBottom: 6 }}>ARQUIVOS GERADOS ({detail.artifacts.length})</p>
            {detail.artifacts.length === 0 ? (
              <p style={muted}>Nenhum arquivo.</p>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {detail.artifacts.map((a) => (
                  <Card key={a.id} padding="10px 12px" style={{ display: 'grid', gap: 2 }} data-testid="run-artifact">
                    <span style={{ fontSize: 13, color: 'var(--text-heading)' }}>{a.name}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      {a.kind} · {a.sizeBytes} bytes · {absoluteWhen(a.createdAt)}
                    </span>
                  </Card>
                ))}
              </div>
            )}
            <p style={{ ...faint, marginTop: 6 }}>Só os metadados: o conteúdo do arquivo não faz parte da auditoria.</p>
          </div>
        </div>
      )}
    </Dialog>
  )
}

function RunRow({ item, onOpen }: { item: RunLogItem; onOpen: () => void }) {
  return (
    <Card padding="14px 16px" style={{ display: 'grid', gap: 8 }} data-testid="run-log-row">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div style={{ minWidth: 0, display: 'grid', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--text-heading)' }}>{item.name}</span>
            <StatusPill status={RUN_STATUS_PILL[item.status]} label={RUN_STATUS_LABEL[item.status]} pulse={item.status === 'running'} />
            <Tag>{TRIGGER_LABEL[item.triggerType] ?? item.triggerType}</Tag>
            {item.agent ? <Tag>{item.agent.name}</Tag> : null}
          </div>
          {item.place.floorName || item.place.sectorName ? <p style={faint}>{[item.place.floorName, item.place.sectorName].filter(Boolean).join(' · ')}</p> : null}
          <p style={muted}>
            {relativeWhen(item.finishedAt ?? item.startedAt ?? item.queuedAt)} · {absoluteWhen(item.queuedAt)} · {durationLabel(item.durationMs)}
          </p>
          <p style={faint}>
            {item.steps} etapa(s) · {item.deliveries} entrega(s) · {item.artifacts} arquivo(s) · {item.tokens > 0 ? `${tokensLabel(item.tokens)} tokens` : 'sem consumo'}
            {item.errorKind ? ` · falha: ${item.errorKind}` : ''}
          </p>
        </div>
        <Button size="sm" variant="secondary" icon="search" onClick={onOpen} data-testid="open-run-detail">
          Ver detalhe
        </Button>
      </div>
    </Card>
  )
}

function AuditRow({ item }: { item: AuditLogItem }) {
  const link = auditLink(item)
  const entries = Object.entries(item.metadata).filter(([key]) => key !== 'statusCode' && key !== 'method')
  return (
    <Card padding="14px 16px" style={{ display: 'grid', gap: 6 }} data-testid="audit-log-row">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--text-heading)' }}>{describeAudit(item)}</span>
        {item.result === 'failure' ? <Tag>falhou</Tag> : null}
      </div>
      <p style={muted}>
        {relativeWhen(item.occurredAt)} · {absoluteWhen(item.occurredAt)}
      </p>
      {entries.length ? <p style={faint}>{entries.map(([key, value]) => `${key}: ${value}`).join(' · ')}</p> : null}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={faint}>requisição {item.requestId.slice(0, 8)}</span>
        {link ? (
          <Link to={link} style={{ fontSize: 12.5, color: 'var(--intent-brand)' }} data-testid="audit-link">
            abrir
          </Link>
        ) : null}
      </div>
    </Card>
  )
}

export function Logs() {
  const building = useOptionalBuildingContext()
  const [tab, setTab] = useState<LogTab>('runs')
  const [runs, setRuns] = useState<RunLogItem[]>([])
  const [audit, setAudit] = useState<AuditLogItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [agents, setAgents] = useState<{ _id: string; name: string; floorId?: string }[]>([])
  const [sectors, setSectors] = useState<{ _id: string; name: string; floorId?: string; members?: { agentId: string }[] }[]>([])

  // Shared period + scope; each tab adds its own.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [floorId, setFloorId] = useState('')
  const [sectorId, setSectorId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [actorType, setActorType] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [triggerType, setTriggerType] = useState('')
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [result, setResult] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API_URL}/api/agents`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_URL}/api/sectors`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([agentList, sectorList]) => {
        if (cancelled) return
        setAgents(agentList)
        setSectors(sectorList)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(
    async (nextCursor?: string) => {
      setLoading(true)
      setError(false)
      try {
        if (tab === 'runs') {
          const filters: RunLogFilters = {
            floorId: floorId || undefined,
            sectorId: sectorId || undefined,
            agentId: agentId || undefined,
            status: status || undefined,
            triggerType: triggerType || undefined,
            from: startOf(from),
            to: endOf(to),
          }
          const page = await listRunLogs(filters, { limit: PAGE_SIZE, cursor: nextCursor })
          setRuns((prev) => (nextCursor ? [...prev, ...page.items] : page.items))
          setCursor(page.nextCursor)
        } else {
          const filters: AuditLogFilters = {
            floorId: floorId || undefined,
            actorType: actorType || undefined,
            action: action || undefined,
            entityType: entityType || undefined,
            result: result || undefined,
            q: search.trim() || undefined,
            from: startOf(from),
            to: endOf(to),
          }
          const page = await listAuditLogs(filters, { limit: PAGE_SIZE, cursor: nextCursor })
          setAudit((prev) => (nextCursor ? [...prev, ...page.items] : page.items))
          setCursor(page.nextCursor)
        }
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    },
    [tab, floorId, sectorId, agentId, actorType, status, triggerType, action, entityType, result, search, from, to],
  )

  useEffect(() => {
    void load()
  }, [load])

  const changeTab = (next: LogTab) => {
    setTab(next)
    setCursor(null)
    // A run status means nothing among changes, and an action means nothing among runs.
    setStatus('')
    setTriggerType('')
    setAction('')
    setEntityType('')
    setResult('')
  }

  const clearAll = () => {
    setFrom('')
    setTo('')
    setFloorId('')
    setSectorId('')
    setAgentId('')
    setActorType('')
    setSearch('')
    setStatus('')
    setTriggerType('')
    setAction('')
    setEntityType('')
    setResult('')
  }

  const items = tab === 'runs' ? runs : audit
  const empty = tab === 'runs'
    ? { icon: 'history', title: 'Nenhuma execução no período', body: 'Ajuste o período ou os filtros para ver o que os agentes executaram.' }
    : { icon: 'scroll-text', title: 'Nenhuma alteração no período', body: 'Criar, editar, pausar, mover ou excluir algo aparece aqui.' }

  return (
    <AppLayout
      current="/settings/logs"
      title="Logs e auditoria"
      subtitle="Tudo o que foi executado e tudo o que foi alterado nesta conta."
      actions={
        <Link to="/executions" style={{ textDecoration: 'none' }}>
          <Button variant="ghost" size="sm" icon="activity">
            Central de execuções
          </Button>
        </Link>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius-control)', background: 'var(--surface-sunken)', width: 'fit-content', maxWidth: '100%', overflowX: 'auto' }} role="tablist" data-testid="log-tabs">
          {(['runs', 'audit'] as LogTab[]).map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={key === tab}
              onClick={() => changeTab(key)}
              data-testid={`log-tab-${key}`}
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

        <Card padding="14px 16px" style={{ display: 'grid', gap: 10 }} data-testid="log-filters">
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))' }}>
            <Field label="De">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="log-from" />
            </Field>
            <Field label="Até">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="log-to" />
            </Field>
            <Field label="Andar">
              <Select
                value={floorId}
                onChange={(e) => setFloorId(e.target.value)}
                options={[{ value: '', label: 'Todos' }, ...(building?.floors ?? []).map((f) => ({ value: f.id, label: f.name }))]}
              />
            </Field>
            {tab === 'runs' ? (
              <>
                <Field label="Setor">
                  <Select
                    value={sectorId}
                    onChange={(e) => setSectorId(e.target.value)}
                    options={[{ value: '', label: 'Todos' }, ...sectors.filter((sec) => !floorId || !sec.floorId || sec.floorId === floorId).map((sec) => ({ value: sec._id, label: sec.name }))]}
                    data-testid="log-sector"
                  />
                </Field>
                <Field label="Agente">
                  <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} options={[{ value: '', label: 'Todos' }, ...agents.map((a) => ({ value: a._id, label: a.name }))]} />
                </Field>
                <Field label="Origem">
                  <Select
                    value={triggerType}
                    onChange={(e) => setTriggerType(e.target.value)}
                    options={[{ value: '', label: 'Todas' }, { value: 'manual', label: 'Manual' }, { value: 'schedule', label: 'Agendada' }, { value: 'webhook', label: 'Evento' }]}
                    data-testid="log-origin"
                  />
                </Field>
                <Field label="Resultado">
                  <Select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    options={[
                      { value: '', label: 'Todos' },
                      { value: 'succeeded', label: 'Concluída' },
                      { value: 'failed', label: 'Falhou' },
                      { value: 'canceled', label: 'Cancelada' },
                      { value: 'running', label: 'Executando' },
                      { value: 'queued', label: 'Na fila' },
                    ]}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Quem fez">
                  <Select
                    value={actorType}
                    onChange={(e) => setActorType(e.target.value)}
                    options={[
                      { value: '', label: 'Todos' },
                      { value: 'user', label: 'Pessoa' },
                      { value: 'system', label: 'Sistema' },
                      { value: 'agent', label: 'Agente' },
                    ]}
                    data-testid="log-actor"
                  />
                </Field>
                <Field label="Buscar entidade" hint="Nome ou identificador.">
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ex.: Pesquisador Político" data-testid="log-search" />
                </Field>
                <Field label="Ação">
                  <Select
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                    options={[
                      { value: '', label: 'Todas' },
                      { value: 'create', label: 'Criação' },
                      { value: 'update', label: 'Edição' },
                      { value: 'delete', label: 'Exclusão' },
                      { value: 'activate', label: 'Ativação' },
                      { value: 'pause', label: 'Pausa' },
                      { value: 'archive', label: 'Arquivamento' },
                      { value: 'rotate', label: 'Nova credencial' },
                    ]}
                    data-testid="log-action"
                  />
                </Field>
                <Field label="Entidade">
                  <Select
                    value={entityType}
                    onChange={(e) => setEntityType(e.target.value)}
                    options={[
                      { value: '', label: 'Todas' },
                      { value: 'agent', label: 'Agente' },
                      { value: 'sector', label: 'Setor' },
                      { value: 'floor', label: 'Andar' },
                      { value: 'tool', label: 'Ferramenta' },
                      { value: 'channel', label: 'Canal' },
                      { value: 'connection', label: 'Conexão' },
                      { value: 'routine', label: 'Rotina' },
                      { value: 'event_trigger', label: 'Gatilho' },
                      { value: 'settings', label: 'Configurações' },
                    ]}
                    data-testid="log-entity"
                  />
                </Field>
                <Field label="Resultado">
                  <Select value={result} onChange={(e) => setResult(e.target.value)} options={[{ value: '', label: 'Todos' }, { value: 'success', label: 'Sucesso' }, { value: 'failure', label: 'Falha' }]} />
                </Field>
              </>
            )}
          </div>
          <div>
            <Button size="sm" variant="ghost" icon="eraser" onClick={clearAll} data-testid="clear-log-filters">
              Limpar filtros
            </Button>
          </div>
        </Card>

        {loading && items.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }} data-testid="logs-loading">
            Carregando…
          </p>
        ) : error ? (
          <Card padding="20px" style={{ display: 'grid', gap: 10, justifyItems: 'start' }} data-testid="logs-error">
            <p style={{ margin: 0, fontSize: 14, color: 'var(--status-blocked)' }}>Não foi possível carregar os logs.</p>
            <Button size="sm" variant="secondary" icon="refresh-cw" onClick={() => void load()}>
              Tentar de novo
            </Button>
          </Card>
        ) : items.length === 0 ? (
          <div data-testid="logs-empty">
            <EmptyState icon={empty.icon} title={empty.title} body={empty.body} />
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }} data-testid="logs-list">
            {tab === 'runs'
              ? runs.map((item) => <RunRow key={item.id} item={item} onOpen={() => setOpenRun(item.id)} />)
              : audit.map((item) => <AuditRow key={item.id} item={item} />)}
          </div>
        )}

        {cursor && !error ? (
          <div>
            <Button variant="secondary" size="sm" onClick={() => void load(cursor)} disabled={loading} data-testid="load-more-logs">
              {loading ? 'Carregando…' : 'Carregar mais'}
            </Button>
          </div>
        ) : null}

        <p style={faint}>Os registros de alteração são somente-leitura e não são apagados pelo aplicativo.</p>
      </div>

      {openRun ? <RunDetail runId={openRun} onClose={() => setOpenRun(null)} /> : null}
    </AppLayout>
  )
}
