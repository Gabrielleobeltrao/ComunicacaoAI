import { useCallback, useEffect, useState } from 'react'
import {
  duration,
  getSectorSummary,
  num,
  percent,
  tokens as fmtTokens,
  PERIOD_LABEL,
  ROLE_LABEL,
} from '../lib/sectorExecutions'
import type { ExecutionPeriod, SectorExecutionSummary } from '../lib/sectorExecutions'
import type { AgentSummary, SectorSummary } from '../lib/types'
import { Card, MetricStat } from '../ui'

// How the sector is actually doing. It lives on Visão geral because it answers the
// first question someone opens the sector with — is this working? — and it used to
// sit inside the executions tab, two clicks away from that question.
//
// Every number comes from telemetry the backend measured. Nothing is estimated, and
// a missing measurement is "—" rather than a zero that would read as "it ran and
// produced nothing".

const PERIODS: ExecutionPeriod[] = ['7d', '30d', 'all']

export function SectorPerformance({ sector, agents }: { sector: SectorSummary; agents: AgentSummary[] }) {
  // Its own period, its own fetch: this block no longer shares state with the
  // history list, so filtering one does not silently re-scope the other.
  const [period, setPeriod] = useState<ExecutionPeriod>('30d')
  const [summary, setSummary] = useState<SectorExecutionSummary | null>(null)
  const [failed, setFailed] = useState(false)

  const nameOf = useCallback((agentId: string) => agents.find((a) => a._id === agentId)?.name ?? 'Agente removido', [agents])

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setSummary(await getSectorSummary(sector._id, period))
    } catch {
      setFailed(true)
    }
  }, [sector._id, period])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section style={{ display: 'grid', gap: 12 }} data-testid="sector-performance">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Desempenho</h3>
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius-control)', background: 'var(--surface-sunken)' }}>
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              data-testid={`period-${p}`}
              style={{
                height: 32,
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
          <button type="button" onClick={() => void load()} style={LINK} data-testid="performance-retry">
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
          {/* `?.` de propósito: este bloco agora aparece em TODAS as abas do setor, e
              uma resposta sem `byParticipant` derrubava a página inteira em vez de
              apenas não desenhar a tabela. */}
          {summary?.byParticipant?.length ? (
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
                  {(summary?.byParticipant ?? []).map((p) => (
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
