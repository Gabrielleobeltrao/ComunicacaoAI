import { useEffect, useState } from 'react'
import { EVENT_TYPES, TIMEFRAMES, emptyMarketPlan, emptySignalPlan } from '../lib/agentRoutines'
import type { MarketTriggerPlan, PlatformEventType, SignalPlan, Timeframe } from '../lib/agentRoutines'
import { listAppCatalog, listInstallations } from '../lib/apps'
import type { AppInstallation } from '../lib/apps'
import { Field, Icon, Input } from '../ui'

/**
 * A ORIGEM do gatilho: chamada de fora, ou um fato da própria plataforma.
 *
 * São duas coisas diferentes de verdade, e não duas configurações do mesmo: o webhook
 * tem endereço público, credencial e assinatura; o evento interno não tem endereço
 * nenhum — ninguém de fora consegue dispará-lo, nem por engano.
 *
 * O formulário mostra três perguntas (o quê, quais ativos, qual período) e esconde o
 * resto. Filtro técnico, tamanho de série e conexão específica são de quem já sabe o
 * que está fazendo, e ficam em "Avançado".
 */

const EVENT_LABEL: Record<PlatformEventType, string> = {
  'market.candle.closed': 'Vela fechou',
  'market.price.updated': 'Preço mudou',
  'market.signal.detected': 'Sinal detectado',
  'trade.order.created': 'Ordem criada',
  'trade.order.filled': 'Ordem executada',
  'trade.stop.triggered': 'Stop disparado',
  'trade.position.closed': 'Posição encerrada',
}

const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  '1m': '1 minuto',
  '5m': '5 minutos',
  '15m': '15 minutos',
  '1h': '1 hora',
  '4h': '4 horas',
  '1D': '1 dia',
}

/** A frase de conferência. Ler é mais rápido do que descobrir depois do primeiro disparo. */
export function describeMarketTrigger(market: MarketTriggerPlan, signal: SignalPlan): string {
  if (!market.enabled) return 'Dispara quando outro sistema chamar o endereço deste gatilho.'
  const quais = market.symbols.length ? market.symbols.join(', ') : 'qualquer ativo'
  const periodo = market.timeframe ? ` de ${TIMEFRAME_LABEL[market.timeframe]}` : ''
  const serie = market.includeSeries ? ` Recebe as últimas ${market.seriesLength} velas fechadas.` : ''
  const sinal = signal.enabled
    ? signal.condition
      ? ' Publica um sinal quando a condição for verdadeira.'
      : ' Publica um sinal em todo evento.'
    : ''
  return `Dispara quando ${EVENT_LABEL[market.eventType].toLowerCase()}${periodo}, para ${quais}.${serie}${sinal}`
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-card)',
  color: 'var(--text-body)',
  fontSize: 13.5,
}

export function MarketTriggerFields({
  market,
  signal,
  onChange,
  idPrefix = '',
}: {
  market: MarketTriggerPlan
  signal: SignalPlan
  onChange: (market: MarketTriggerPlan, signal: SignalPlan) => void
  idPrefix?: string
}) {
  const [conexoes, setConexoes] = useState<AppInstallation[]>([])
  const [avancado, setAvancado] = useState(false)

  useEffect(() => {
    let vivo = true
    // Só quem tem dado de mercado. Uma conexão de CRM na lista de "evento de mercado"
    // é uma escolha que nunca vai disparar — e nada na tela explicaria por quê.
    Promise.all([listInstallations(), listAppCatalog()])
      .then(([lista, catalogo]) => {
        if (!vivo) return
        const comMercado = new Set(catalogo.filter((a) => a.streamable).map((a) => a.key))
        setConexoes(lista.filter((c) => c.status === 'connected' && comMercado.has(c.appKey)))
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [])

  const setMarket = (patch: Partial<MarketTriggerPlan>) => onChange({ ...market, ...patch }, signal)
  const setSignal = (patch: Partial<SignalPlan>) => onChange(market, { ...signal, ...patch })

  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="market-trigger-fields">
      <Field label="Quando disparar">
        <select
          id={`${idPrefix}trigger-origem`}
          style={selectStyle}
          value={market.enabled ? 'market' : 'webhook'}
          onChange={(e) =>
            e.target.value === 'market'
              ? onChange({ ...emptyMarketPlan(), enabled: true }, signal)
              : onChange(emptyMarketPlan(), emptySignalPlan())
          }
          data-testid="trigger-origin"
        >
          <option value="webhook">Quando outro sistema chamar (webhook)</option>
          <option value="market">Evento de mercado</option>
        </select>
      </Field>

      {market.enabled ? (
        <>
          <Field label="Evento">
            <select
              style={selectStyle}
              value={market.eventType}
              onChange={(e) => setMarket({ eventType: e.target.value as PlatformEventType })}
              data-testid="market-event-type"
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Ativos" hint="Separados por vírgula. Vazio recebe todos.">
            <Input
              value={market.symbols.join(', ')}
              onChange={(e) =>
                setMarket({
                  symbols: e.target.value
                    .split(',')
                    .map((s) => s.trim().toUpperCase())
                    .filter(Boolean),
                })
              }
              placeholder="PETR4, VALE3"
              data-testid="market-symbols"
            />
          </Field>

          <Field label="Período da vela">
            <select
              style={selectStyle}
              value={market.timeframe ?? ''}
              onChange={(e) => setMarket({ timeframe: (e.target.value || null) as Timeframe | null })}
              data-testid="market-timeframe"
            >
              <option value="">Qualquer período</option>
              {TIMEFRAMES.map((t) => (
                <option key={t} value={t}>
                  {TIMEFRAME_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>

          <button
            type="button"
            onClick={() => setAvancado((v) => !v)}
            style={{ justifySelf: 'start', background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            data-testid="market-advanced-toggle"
          >
            <Icon name={avancado ? 'chevron-up' : 'chevron-down'} size={13} />
            Avançado
          </button>

          {avancado ? (
            <div style={{ display: 'grid', gap: 10, paddingLeft: 10, borderLeft: '2px solid var(--border-subtle)' }} data-testid="market-advanced">
              <Field label="Conexão" hint="Vazio aceita qualquer conexão desta conta.">
                <select
                  style={selectStyle}
                  value={market.installationId ?? ''}
                  onChange={(e) => setMarket({ installationId: e.target.value || null })}
                  data-testid="market-installation"
                >
                  <option value="">Qualquer conexão</option>
                  {conexoes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.environment && c.environment !== 'default' ? ' · simulação' : ''}
                    </option>
                  ))}
                </select>
              </Field>

              <label style={{ display: 'flex', gap: 8, alignItems: 'start', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={market.includeSeries}
                  onChange={(e) => setMarket({ includeSeries: e.target.checked })}
                  data-testid="market-include-series"
                />
                <span>
                  Entregar as velas fechadas anteriores
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)' }}>
                    Um evento traz uma vela só, e nenhum indicador significa algo com uma vela.
                  </span>
                </span>
              </label>

              {market.includeSeries ? (
                <Field label="Quantas velas">
                  <Input
                    type="number"
                    min={2}
                    max={200}
                    value={String(market.seriesLength)}
                    onChange={(e) => setMarket({ seriesLength: Math.min(Math.max(Number(e.target.value) || 2, 2), 200) })}
                    data-testid="market-series-length"
                  />
                </Field>
              ) : null}

              <label style={{ display: 'flex', gap: 8, alignItems: 'start', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={signal.enabled}
                  onChange={(e) => setSignal({ enabled: e.target.checked })}
                  data-testid="signal-enabled"
                />
                <span>
                  Publicar um sinal quando valer a pena
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)' }}>
                    Outras rotinas podem reagir a ele. Sem condição, todo evento vira sinal — e um sinal que acontece sempre não é sinal.
                  </span>
                </span>
              </label>

              {signal.enabled ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Field label="Campo do resultado">
                    <Input
                      value={signal.condition?.path ?? ''}
                      onChange={(e) =>
                        setSignal({
                          condition: e.target.value
                            ? { source: 'acao', path: e.target.value, operator: signal.condition?.operator ?? 'equals', value: signal.condition?.value }
                            : null,
                        })
                      }
                      placeholder="opportunityFound"
                      data-testid="signal-path"
                    />
                  </Field>
                  <Field label="Igual a">
                    <Input
                      value={signal.condition?.value === undefined ? '' : String(signal.condition.value)}
                      onChange={(e) =>
                        setSignal({
                          condition: signal.condition
                            ? { ...signal.condition, operator: 'equals', value: e.target.value === 'true' ? true : e.target.value === 'false' ? false : e.target.value }
                            : null,
                        })
                      }
                      placeholder="true"
                      data-testid="signal-value"
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
