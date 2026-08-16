import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useActiveFloorId } from '../contexts/BuildingContext'
import { floorAgent } from '../lib/floorRoutes'
import { SectorPlayground } from './SectorPlayground'
import {
  duration,
  getSectorExecution,
  getSectorSummary,
  listSectorExecutions,
  num,
  percent,
  tokens as fmtTokens,
  PERIOD_LABEL,
  ROLE_LABEL,
  STATUS_LABEL,
} from '../lib/sectorExecutions'
import type { ExecutionPeriod, SectorExecutionRow, SectorExecutionSummary, SectorTimelineStep } from '../lib/sectorExecutions'
import type { AgentSummary, SectorSummary } from '../lib/types'
import { Card, MetricStat } from '../ui'

// The sector's Execuções tab: Desempenho, Histórico and — last, clearly labelled —
// Testar. Every number comes from telemetry the backend measured; nothing is
// estimated, and a missing measurement is "—" rather than a zero.

const PERIODS: ExecutionPeriod[] = ['7d', '30d', 'all']

export function SectorExecutions({ sector, agents }: { sector: SectorSummary; agents: AgentSummary[] }) {
  const [period, setPeriod] = useState<ExecutionPeriod>('30d')
  const [summary, setSummary] = useState<SectorExecutionSummary | null>(null)
  const [rows, setRows] = useState<SectorExecutionRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const nameOf = useCallback((agentId: string) => agents.find((a) => a._id === agentId)?.name ?? 'Agente removido', [agents])

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const [s, list] = await Promise.all([
        getSectorSummary(sector._id, period),
        listSectorExecutions(sector._id, { period, status: status || undefined, agentId: agentFilter || undefined }),
      ])
      setSummary(s)
      setRows(list.items)
      setCursor(list.nextCursor)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [sector._id, period, status, agentFilter])

  useEffect(() => {
    void load()
  }, [load])

  const loadMore = async () => {
    if (!cursor) return
    const next = await listSectorExecutions(sector._id, { period, status: status || undefined, agentId: agentFilter || undefined, cursor })
    setRows((r) => [...r, ...next.items])
    setCursor(next.nextCursor)
  }

  return (
    <div style={{ display: 'grid', gap: 24 }} data-testid="sector-executions">
      {/* --- Desempenho ----------------------------------------------------- */}
      <section style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Desempenho</h3>
          <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius-control)', background: 'var(--surface-sunken)' }}>
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                data-testid={`period-${p}`}
                style={{
                  height: 28,
                  padding: '0 12px',
                  borderRadius: 'var(--radius-xs)',
                  border: 0,
                  background: p === period ? 'var(--surface-card)' : 'transparent',
                  boxShadow: p === period ? 'var(--shadow-flat)' : 'none',
                  color: p === period ? 'var(--text-heading)' : 'var(--text-muted)',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        {failed ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>
            Não foi possível carregar.{' '}
            <button type="button" onClick={() => void load()} style={LINK} data-testid="executions-retry">
              Tentar de novo
            </button>
          </p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }} data-testid="sector-metrics">
              <Card padding="16px" title="Fluxos completos do setor no período — cada execução conta uma vez">
                <MetricStat icon="activity" label="Execuções" value={num(summary?.executions)} />
              </Card>
              <Card padding="16px" title="Execuções bem-sucedidas / execuções encerradas">
                <MetricStat icon="check-circle" label="Sucesso" value={percent(summary?.successRate)} />
              </Card>
              <Card padding="16px" title="Duração ponta a ponta média do fluxo">
                <MetricStat icon="gauge" label="Duração média" value={duration(summary?.avgDurationMs)} />
              </Card>
              <Card padding="16px" title="Soma do tempo dos agentes; com paralelismo pode superar a duração do fluxo">
                <MetricStat icon="timer" label="Tempo ativo somado" value={duration(summary?.activeTimeMs)} />
              </Card>
              <Card padding="16px" title="Tokens de entrada + saída dos agentes participantes">
                <MetricStat icon="coins" label="Tokens" value={fmtTokens(summary?.totalTokens)} />
              </Card>
              <Card padding="16px" title="Tokens médios por execução do setor">
                <MetricStat icon="calculator" label="Tokens médios" value={fmtTokens(summary?.avgTokensPerExecution)} />
              </Card>
              <Card padding="16px" title="Quantos agentes/etapas o fluxo percorre em média">
                <MetricStat icon="users-round" label="Agentes por execução" value={num(summary?.avgParticipants)} />
              </Card>
              <Card padding="16px" title="Execuções ainda em andamento agora">
                <MetricStat icon="loader" label="Em andamento" value={num(summary?.running)} />
              </Card>
            </div>

            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }} data-testid="telemetry-since">
              {summary?.telemetrySince
                ? `Telemetria disponível desde ${new Date(summary.telemetrySince).toLocaleDateString('pt-BR')}.`
                : 'Ainda não há telemetria deste setor.'}
            </p>

            {/* --- por agente/etapa ------------------------------------------ */}
            {summary && summary.byParticipant.length > 0 ? (
              <div style={{ overflowX: 'auto' }} data-testid="by-participant">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={TH}>Agente</th>
                      <th style={TH}>Papel / etapa</th>
                      <th style={TH}>Participações</th>
                      <th style={TH}>Sucesso</th>
                      <th style={TH}>Tokens</th>
                      <th style={TH}>Tempo ativo</th>
                      <th style={TH}>Duração média</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byParticipant.map((p) => (
                      <tr key={`${p.agentId}:${p.stageId ?? ''}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <td style={TD}>{nameOf(p.agentId)}</td>
                        <td style={TD}>{p.stageName ?? (p.role ? ROLE_LABEL[p.role] : '—')}</td>
                        <td style={TD}>{p.participations}</td>
                        <td style={TD}>{p.participations ? `${Math.round((p.succeeded / p.participations) * 100)}%` : '—'}</td>
                        <td style={TD}>{fmtTokens(p.tokens)}</td>
                        <td style={TD}>{duration(p.activeTimeMs)}</td>
                        <td style={TD}>{duration(p.avgDurationMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* --- Histórico ------------------------------------------------------- */}
      <section style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Histórico</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por status" data-testid="filter-status" style={SELECT}>
            <option value="">Todos os status</option>
            <option value="succeeded">Concluídas</option>
            <option value="failed">Falhas</option>
            <option value="canceled">Canceladas</option>
            <option value="running">Em andamento</option>
          </select>
          <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} aria-label="Filtrar por agente" data-testid="filter-agent" style={SELECT}>
            <option value="">Todos os agentes</option>
            {agents.map((a) => (
              <option key={a._id} value={a._id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        {loading && rows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>Carregando…</p>
        ) : rows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }} data-testid="history-empty">
            Nenhuma execução neste período. O setor executa quando um agente o chama, uma rotina o aciona ou um canal atendido por ele recebe uma
            mensagem.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }} data-testid="execution-history">
            {rows.map((row) => (
              <ExecutionRow key={row.id} sectorId={sector._id} row={row} nameOf={nameOf} />
            ))}
            {cursor ? (
              <button type="button" onClick={() => void loadMore()} style={LINK} data-testid="load-more">
                Carregar mais
              </button>
            ) : null}
          </div>
        )}
      </section>

      {/* --- Testar ---------------------------------------------------------- */}
      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Testar setor</h3>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="playground-note">
          Isto é um teste: a execução é registrada como teste e fica fora das métricas acima.
        </p>
        <SectorPlayground key={sector._id} sector={sector} />
      </section>
    </div>
  )
}

const TH: React.CSSProperties = { padding: '6px 10px', fontWeight: 700, whiteSpace: 'nowrap' }
const TD: React.CSSProperties = { padding: '6px 10px', color: 'var(--text-body)' }
const SELECT: React.CSSProperties = {
  height: 34,
  padding: '0 10px',
  borderRadius: 'var(--radius-control)',
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-card)',
  fontSize: 13,
}
const LINK: React.CSSProperties = {
  background: 'none',
  border: 0,
  padding: 0,
  font: 'inherit',
  color: 'var(--intent-brand)',
  textDecoration: 'underline',
  cursor: 'pointer',
}

function ExecutionRow({ sectorId, row, nameOf }: { sectorId: string; row: SectorExecutionRow; nameOf: (id: string) => string }) {
  const [open, setOpen] = useState(false)
  const [steps, setSteps] = useState<SectorTimelineStep[] | null>(null)
  const [loading, setLoading] = useState(false)
  const fid = useActiveFloorId()

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && !steps) {
      setLoading(true)
      try {
        setSteps((await getSectorExecution(sectorId, row.id)).steps)
      } catch {
        setSteps([])
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, overflow: 'hidden' }} data-testid="execution-row">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '10px 12px',
          background: 'transparent',
          border: 0,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)' }}>{new Date(row.startedAt).toLocaleString('pt-BR')}</span>
        <span style={{ fontSize: 12.5, color: row.status === 'failed' ? 'var(--coral-600, #d92d20)' : 'var(--text-muted)' }}>
          {STATUS_LABEL[row.status] ?? row.status}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{row.source}</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{duration(row.durationMs)}</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{fmtTokens(row.tokens)} tokens</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {row.participants} {row.participants === 1 ? 'agente' : 'agentes'}
        </span>
      </button>

      {open ? (
        <div style={{ padding: '0 12px 12px', display: 'grid', gap: 8 }} data-testid="execution-timeline">
          {loading ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Carregando…</p>
          ) : steps && steps.length > 0 ? (
            steps.map((step, i) => (
              <div key={`${step.agentId}:${i}`} style={{ display: 'grid', gap: 2, paddingLeft: 12, borderLeft: '2px solid var(--border-subtle)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)' }}>
                  {step.stageOrder ? `${step.stageOrder}. ` : ''}
                  {step.stageName ?? (step.role ? ROLE_LABEL[step.role] : 'Participação')}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {fid ? (
                    <Link to={floorAgent(fid, step.agentId)} style={{ color: 'var(--intent-brand)' }}>
                      {nameOf(step.agentId)}
                    </Link>
                  ) : (
                    nameOf(step.agentId)
                  )}{' '}
                  · {STATUS_LABEL[step.status] ?? step.status} · {duration(step.durationMs)} · {fmtTokens(step.tokens)} tokens ·{' '}
                  {step.toolCalls} {step.toolCalls === 1 ? 'ferramenta' : 'ferramentas'}
                  {step.attempts > 1 ? ` · ${step.attempts} tentativas` : ''}
                </span>
                {step.errorKind ? (
                  <span style={{ fontSize: 12.5, color: 'var(--coral-600, #d92d20)' }}>Parou aqui: {step.errorKind}</span>
                ) : null}
              </div>
            ))
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              Sem participações registradas — telemetria parcial desta execução.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
