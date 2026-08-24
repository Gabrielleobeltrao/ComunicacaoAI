import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useActiveFloorId } from '../contexts/BuildingContext'
import { floorAgent } from '../lib/floorRoutes'
import { SectorPlayground } from './SectorPlayground'
import {
  duration,
  getSectorExecution,
  listSectorExecutions,
  tokens as fmtTokens,
  PERIOD_LABEL,
  ROLE_LABEL,
  STATUS_LABEL,
} from '../lib/sectorExecutions'
import type { ExecutionPeriod, SectorExecutionRow, SectorTimelineStep } from '../lib/sectorExecutions'
import type { AgentSummary, SectorSummary } from '../lib/types'

// The sector's Execuções tab: what actually ran, and — last, clearly labelled — a
// way to try it. The KPI block that used to open this tab now lives on Visão geral,
// where the question "is this working?" is asked.

export function SectorExecutions({ sector, agents }: { sector: SectorSummary; agents: AgentSummary[] }) {
  const [period, setPeriod] = useState<ExecutionPeriod>('30d')
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
      const list = await listSectorExecutions(sector._id, { period, status: status || undefined, agentId: agentFilter || undefined })
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
      {/* --- Histórico ------------------------------------------------------- */}
      <section style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Histórico</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* O período era do bloco de Desempenho, que subiu para a Visão geral. O
              histórico passa a ter o seu, em vez de ficar preso ao último filtro
              usado em outra tela. */}
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as ExecutionPeriod)}
            aria-label="Filtrar por período"
            data-testid="filter-period"
            style={SELECT}
          >
            {(['7d', '30d', 'all'] as ExecutionPeriod[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </select>
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

        {failed ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>
            Não foi possível carregar.{' '}
            <button type="button" onClick={() => void load()} style={LINK} data-testid="executions-retry">
              Tentar de novo
            </button>
          </p>
        ) : loading && rows.length === 0 ? (
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
          Isto é um teste: a execução é registrada como teste e fica fora do Desempenho e do histórico.
        </p>
        <SectorPlayground key={sector._id} sector={sector} />
      </section>
    </div>
  )
}

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
                {/*
                  COMO a etapa foi executada.
                  Sem isto, uma função determinística e uma inferência aparecem como duas
                  participações iguais — e a diferença entre zero token e uma chamada paga
                  fica invisível justamente para quem paga. Só aparece quando existe: uma
                  execução gravada antes desta fase continua desenhando como sempre.
                */}
                {step.executorKind && step.executorKind !== 'llm' ? (
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }} data-testid="step-executor">
                    {step.executorKind === 'function' ? 'Função' : 'Ferramenta'}
                    {step.ran ? ` · ${step.ran}` : ''}
                    {step.capability ? ` · ${step.capability}` : ''}
                  </span>
                ) : null}
                {step.inputValid === false || step.outputValid === false ? (
                  <span style={{ fontSize: 12, color: 'var(--coral-600, #d92d20)' }} data-testid="step-validation">
                    {/* Entrada e saída SEPARADAS: são dois defeitos, em lugares diferentes. */}
                    {step.inputValid === false ? 'Entrada não conferiu' : 'Saída não conferiu'}
                  </span>
                ) : null}
                {step.dependsOn?.length || step.inputOrigins?.length ? (
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }} data-testid="step-inputs">
                    {step.dependsOn?.length ? `depois de ${step.dependsOn.join(', ')}` : ''}
                    {step.inputOrigins?.length ? `${step.dependsOn?.length ? ' · ' : ''}${step.inputOrigins.join(' ')}` : ''}
                  </span>
                ) : null}
                {step.outputRepaired ? (
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }} data-testid="step-repaired">
                    Precisou de uma correção de formato — uma chamada a mais ao modelo.
                  </span>
                ) : null}
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
