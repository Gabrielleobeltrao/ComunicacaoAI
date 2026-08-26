import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_URL } from '../lib/api'
import { duration, num, percent, tokens as fmtTokens, PERIOD_LABEL } from '../lib/sectorExecutions'
import type { ExecutionPeriod } from '../lib/sectorExecutions'
import { Card, MetricStat } from '../ui'

// The building's (or a floor's) execution analysis.
//
// Every number here comes from ONE backend service, so this page cannot disagree
// with the agent page or the sector page. Two of them are deliberately separate and
// labelled as different things: the end-to-end duration of a request, and the summed
// active time of the agents inside it — with parallelism the second exceeds the first,
// and reporting them as one number is how a dashboard starts lying.

interface Analytics {
  scope: string
  period: ExecutionPeriod
  telemetrySince: string | null
  executions: number
  succeeded: number
  failed: number
  canceled: number
  running: number
  successRate: number | null
  avgDurationMs: number | null
  p95DurationMs: number | null
  avgQueueMs: number | null
  activeTimeMs: number
  totalTokens: number
  avgTokensPerExecution: number | null
  participations: number
  participatedExecutions: number
  partialTelemetry: number
}

interface BreakdownRow {
  id: string
  label: string
  executions: number
  successRate: number | null
  totalTokens: number
  participations: number
}

type GroupBy = 'floor' | 'agent'

const get = async <T,>(path: string): Promise<T> => {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error('falhou')
  return (await res.json()) as T
}

export function ExecutionAnalytics({
  floorId,
  floors,
  agents,
}: {
  // Absent = the whole building.
  floorId?: string
  floors: { id: string; name: string }[]
  agents: { _id: string; name: string }[]
}) {
  const [period, setPeriod] = useState<ExecutionPeriod>('30d')
  const [groupBy, setGroupBy] = useState<GroupBy>('floor')
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [rows, setRows] = useState<BreakdownRow[]>([])
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [a, b] = await Promise.all([
        get<Analytics>(floorId ? `/api/floors/${floorId}/executions/analytics?period=${period}` : `/api/executions/analytics?period=${period}`),
        get<BreakdownRow[]>(`/api/executions/breakdown?groupBy=${groupBy}&period=${period}${floorId ? `&floorId=${floorId}` : ''}`),
      ])
      setAnalytics(a)
      setRows(b)
    } catch {
      setFailed(true)
    }
  }, [floorId, period, groupBy])

  useEffect(() => {
    void load()
  }, [load])

  const labelFor = useCallback(
    (row: BreakdownRow) => {
      if (groupBy === 'floor') return floors.find((f) => f.id === row.id)?.name ?? (row.id === 'sem-andar' ? 'Sem andar' : 'Andar removido')
      return agents.find((a) => a._id === row.id)?.name ?? 'Agente removido'
    },
    [groupBy, floors, agents],
  )

  // A bottleneck is where work concentrates or fails, said plainly. It is derived
  // from the same rows on screen — never a second calculation.
  const bottlenecks = useMemo(() => {
    const out: string[] = []
    const busiest = [...rows].sort((a, b) => b.participations - a.participations)[0]
    const worst = [...rows].filter((r) => r.successRate !== null).sort((a, b) => (a.successRate ?? 1) - (b.successRate ?? 1))[0]
    if (busiest && busiest.participations > 0) out.push(`${labelFor(busiest)} concentra ${busiest.participations} participação(ões).`)
    if (worst && (worst.successRate ?? 1) < 1) out.push(`${labelFor(worst)} tem a menor taxa de sucesso: ${percent(worst.successRate)}.`)
    return out
  }, [rows, labelFor])

  return (
    <div style={{ display: 'grid', gap: 16 }} data-testid="execution-analytics">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>
          {floorId ? 'Execuções deste andar' : 'Execuções do prédio'}
        </h3>
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius-control)', background: 'var(--surface-sunken)' }}>
          {(['7d', '30d', 'all'] as ExecutionPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              data-testid={`analytics-period-${p}`}
              style={{
                height: 32,
                padding: '0 12px',
                borderRadius: 'var(--radius-xs)',
                border: 0,
                background: p === period ? 'var(--surface-card)' : 'transparent',
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
          <button type="button" onClick={() => void load()} style={LINK} data-testid="analytics-retry">
            Tentar de novo
          </button>
        </p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }} data-testid="analytics-metrics">
            <Card
              padding="16px"
              title={
                floorId
                  ? 'Pedidos que COMEÇARAM neste andar. Somar os andares dá o total do prédio — participações são contadas à parte.'
                  : 'Pedidos completos no período — cada um conta uma vez, mesmo cruzando andares e agentes'
              }
            >
              <MetricStat icon="activity" label={floorId ? 'Originadas aqui' : 'Execuções'} value={num(analytics?.executions)} />
            </Card>
            <Card padding="16px" title="Execuções bem-sucedidas / execuções encerradas">
              <MetricStat icon="check-circle" label="Sucesso" value={percent(analytics?.successRate)} />
            </Card>
            <Card padding="16px" title="Duração ponta a ponta média do pedido">
              <MetricStat icon="gauge" label="Duração média" value={duration(analytics?.avgDurationMs)} />
            </Card>
            <Card padding="16px" title="95% das execuções terminaram em até este tempo">
              <MetricStat icon="trending-up" label="P95" value={duration(analytics?.p95DurationMs)} />
            </Card>
            <Card padding="16px" title="Tempo entre criar a execução e um worker pegá-la">
              <MetricStat icon="hourglass" label="Tempo em fila" value={duration(analytics?.avgQueueMs)} />
            </Card>
            <Card padding="16px" title="Soma do tempo dos agentes; com paralelismo pode superar a duração do pedido">
              <MetricStat icon="timer" label="Tempo ativo somado" value={duration(analytics?.activeTimeMs)} />
            </Card>
            <Card padding="16px" title="Tokens de entrada + saída das inferências folha">
              <MetricStat icon="coins" label="Tokens" value={fmtTokens(analytics?.totalTokens)} />
            </Card>
            <Card padding="16px" title="Execuções ainda em andamento">
              <MetricStat icon="loader" label="Em andamento" value={num(analytics?.running)} />
            </Card>
            {floorId ? (
              // For a floor these are two different questions, and mixing them is how
              // a dashboard starts lying: a floor can take part in work that started
              // somewhere else.
              <Card padding="16px" title="Pedidos que este andar atendeu, mas que começaram em outro lugar">
                <MetricStat icon="users-round" label="Participou de" value={num(analytics?.participatedExecutions)} />
              </Card>
            ) : null}
          </div>

          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }} data-testid="analytics-telemetry">
            {analytics?.telemetrySince
              ? `Telemetria disponível desde ${new Date(analytics.telemetrySince).toLocaleDateString('pt-BR')}.`
              : 'Ainda não há telemetria correlacionada.'}
            {analytics && analytics.partialTelemetry > 0
              ? ` ${analytics.partialTelemetry} registro(s) antigo(s) sem correlação ficam fora das execuções e aparecem apenas como telemetria parcial.`
              : ''}
          </p>

          {bottlenecks.length > 0 ? (
            <div style={{ padding: 12, borderRadius: 10, background: 'var(--surface-sunken)' }} data-testid="analytics-bottlenecks">
              <p style={{ margin: '0 0 4px', fontSize: 12.5, fontWeight: 700, color: 'var(--text-heading)' }}>Onde o trabalho aperta</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {bottlenecks.map((b) => (
                  <li key={b} style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Detalhar por</span>
              {(['floor', 'agent'] as GroupBy[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGroupBy(g)}
                  data-testid={`group-${g}`}
                  aria-pressed={groupBy === g}
                  style={{
                    height: 32,
                    padding: '0 10px',
                    borderRadius: 999,
                    border: `1px solid ${groupBy === g ? 'var(--intent-brand)' : 'var(--border-strong)'}`,
                    background: groupBy === g ? 'var(--surface-sunken)' : 'transparent',
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  {g === 'floor' ? 'Andar' : 'Agente'}
                </button>
              ))}
            </div>

            {rows.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }} data-testid="breakdown-empty">
                Nenhuma execução registrada neste período.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }} data-testid="analytics-breakdown">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={TH}>{groupBy === 'floor' ? 'Andar' : 'Agente'}</th>
                      <th style={TH}>Execuções</th>
                      <th style={TH}>Participações</th>
                      <th style={TH}>Sucesso</th>
                      <th style={TH}>Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <td style={TD}>{labelFor(row)}</td>
                        <td style={TD}>{row.executions}</td>
                        <td style={TD}>{row.participations}</td>
                        <td style={TD}>{percent(row.successRate)}</td>
                        <td style={TD}>{fmtTokens(row.totalTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
                  Execuções são pedidos distintos; participações são as vezes que aquele {groupBy === 'floor' ? 'andar' : 'agente'} entrou em
                  algum deles. Somar participações não dá o total de execuções — e não deve.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const TH: React.CSSProperties = { padding: '6px 10px', fontWeight: 700, whiteSpace: 'nowrap' }
const TD: React.CSSProperties = { padding: '6px 10px', color: 'var(--text-body)' }
const LINK: React.CSSProperties = {
  background: 'none',
  border: 0,
  padding: 0,
  font: 'inherit',
  color: 'var(--intent-brand)',
  textDecoration: 'underline',
  cursor: 'pointer',
}
