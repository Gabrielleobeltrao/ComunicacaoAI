import { useCallback, useEffect, useState } from 'react'
import { AppLayout } from '../components/AppLayout'
import { Badge, Button, Card, Select } from '../ui'
import * as api from '../lib/activity'
import { SOURCE_LABEL, STATUS_LABEL, cadeia, duracao, useActivityPulse } from '../lib/activity'
import type { ActivityFilters, ActivityItem } from '../lib/activity'

// ATIVIDADE — o que aconteceu, do começo ao fim, em uma linha por execução.
//
// A tela mostra a CADEIA: o monitor que reconheceu a transição, o Flow que rodou, as
// etapas e as entregas. O que ela não mostra é conteúdo — payload, prompt, resposta e
// documento continuam onde já moram, sob a permissão deles. Uma linha do tempo que
// guardasse o conteúdo seria uma segunda cópia de tudo, com outra regra de acesso.

const TOM: Record<api.ActivityStatus, 'success' | 'danger' | 'warning' | 'neutral'> = {
  succeeded: 'success',
  failed: 'danger',
  canceled: 'warning',
  running: 'neutral',
  queued: 'neutral',
}

export function Activity() {
  const [itens, setItens] = useState<ActivityItem[] | null>(null)
  const [proxima, setProxima] = useState<string | null>(null)
  const [filtros, setFiltros] = useState<ActivityFilters>({})
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const r = await api.listActivity(filtros)
      setItens(r.items)
      setProxima(r.nextBefore)
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [filtros])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // Tempo real pelo socket que já existe: um evento significa "algo andou".
  useActivityPulse(() => void carregar())

  const mais = async () => {
    if (!proxima) return
    try {
      const r = await api.listActivity(filtros, proxima)
      setItens((antes) => [...(antes ?? []), ...r.items])
      setProxima(r.nextBefore)
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  return (
    <AppLayout current="/activity" title="Atividade" subtitle="O que aconteceu no escritório, do começo ao fim">
      <div className="flex flex-col gap-3">
        {erro && (
          <Card>
            <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger)' }} data-testid="activity-error">
              {erro}
            </p>
          </Card>
        )}

        <div className="flex flex-wrap gap-2" data-testid="activity-filtros">
          {(filtros.monitorId || filtros.flowId) && (
            <Button
              variant="ghost"
              onClick={() => setFiltros({ status: filtros.status, source: filtros.source })}
              data-testid="activity-limpar-recorte"
            >
              Ver tudo de novo
            </Button>
          )}
          <Select
            value={filtros.status ?? ''}
            onChange={(e) => setFiltros({ ...filtros, status: (e.target.value || undefined) as api.ActivityStatus | undefined })}
            style={{ maxWidth: 200 }}
            data-testid="activity-status"
          >
            <option value="">Qualquer estado</option>
            {(Object.keys(STATUS_LABEL) as api.ActivityStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select
            value={filtros.source ?? ''}
            onChange={(e) => setFiltros({ ...filtros, source: (e.target.value || undefined) as api.ActivitySource | undefined })}
            style={{ maxWidth: 200 }}
            data-testid="activity-origem"
          >
            <option value="">Qualquer origem</option>
            {(Object.keys(SOURCE_LABEL) as api.ActivitySource[]).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>

        {itens?.length === 0 && (
          <Card>
            <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
              Nada aconteceu ainda com esses filtros. Quando um monitor disparar ou uma operação rodar, a linha aparece aqui.
            </p>
          </Card>
        )}

        {itens?.map((item) => (
          <Card key={item.executionKey}>
            <div className="flex flex-col gap-2" data-testid="activity-item">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TOM[item.status]}>{STATUS_LABEL[item.status]}</Badge>
                {item.environment === 'test' && <Badge tone="neutral">teste</Badge>}
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{new Date(item.createdAt).toLocaleString('pt-BR')}</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>· {duracao(item.durationMs)}</span>
              </div>

              {/* A cadeia: de onde veio até onde chegou. Clicar recorta por aquela peça —
                  é a pergunta seguinte que quem lê uma linha sempre faz. */}
              <p style={{ fontSize: 14 }} data-testid="activity-cadeia">
                {cadeia(item).join(' → ')}
              </p>
              <div className="flex flex-wrap gap-2">
                {item.origin?.kind === 'monitor' && (
                  <button
                    type="button"
                    onClick={() => setFiltros({ ...filtros, monitorId: (item.origin as { kind: 'monitor'; id: string }).id })}
                    style={{ fontSize: 12, textDecoration: 'underline', background: 'none', border: 0, cursor: 'pointer', color: 'var(--text-muted)', minHeight: 'var(--hit-min, 44px)' }}
                    data-testid="activity-filtrar-monitor"
                  >
                    só deste monitor
                  </button>
                )}
                {item.flow && (
                  <button
                    type="button"
                    onClick={() => setFiltros({ ...filtros, flowId: item.flow!.id })}
                    style={{ fontSize: 12, textDecoration: 'underline', background: 'none', border: 0, cursor: 'pointer', color: 'var(--text-muted)', minHeight: 'var(--hit-min, 44px)' }}
                    data-testid="activity-filtrar-flow"
                  >
                    só desta operação
                  </button>
                )}
              </div>

              {item.steps.length > 0 && (
                <ul className="flex flex-wrap gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {item.steps.map((p) => (
                    <li
                      key={`${p.stepId}-${p.stepType}`}
                      title={p.skipReason ?? undefined}
                      style={{
                        fontSize: 12,
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-control)',
                        border: '1px solid var(--border-subtle)',
                        color: p.status === 'failed' ? 'var(--intent-danger)' : 'var(--text-muted)',
                      }}
                    >
                      {p.stepType} · {p.status}
                      {p.durationMs === null ? '' : ` · ${duracao(p.durationMs)}`}
                    </li>
                  ))}
                </ul>
              )}

              {item.errorKind && (
                <p role="alert" style={{ fontSize: 12.5, color: 'var(--intent-danger)' }}>
                  Terminou com erro: {item.errorKind}
                </p>
              )}

              {(item.usage.inputTokens > 0 || item.usage.outputTokens > 0) && (
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {item.usage.inputTokens + item.usage.outputTokens} tokens
                </p>
              )}
            </div>
          </Card>
        ))}

        {proxima && (
          <div>
            <Button variant="ghost" onClick={mais} data-testid="activity-mais">
              Ver mais
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
