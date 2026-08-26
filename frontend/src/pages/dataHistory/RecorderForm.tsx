import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AppLayout } from '../../components/AppLayout'
import { Button, Card, Field, Input, Select, Textarea } from '../../ui'
import { MODE_HINT, MODE_LABEL, OP_LABEL, SOURCE_LABEL, createRecorder, emptyRecorder, previewRecorder } from '../../lib/dataHistory'
import type { AggregationOp, PreviewResult, RecorderMode, SourceKind } from '../../lib/dataHistory'

/**
 * Criar um histórico, na ordem em que a pergunta aparece na cabeça de quem cria:
 * como se chama, de onde vem, o que identifica cada coisa, quando guardar, o que
 * guardar, por quanto tempo — e só então testar e ativar.
 *
 * A prévia roda o MOTOR de verdade contra amostras coladas por quem está configurando.
 * É de propósito: uma prévia que simulasse por conta própria prometeria um resultado
 * que o servidor não daria.
 */
const MODOS: RecorderMode[] = ['every_event', 'on_change', 'snapshot_interval', 'schedule_snapshot', 'window_aggregate', 'condition']
const OPS: AggregationOp[] = ['first', 'last', 'min', 'max', 'avg', 'sum', 'count']
const INTERVALOS = [
  { ms: 60_000, label: '1 minuto' },
  { ms: 300_000, label: '5 minutos' },
  { ms: 900_000, label: '15 minutos' },
  { ms: 3_600_000, label: '1 hora' },
  { ms: 86_400_000, label: '1 dia' },
]

const AMOSTRA_EXEMPLO = `[
  { "symbol": "BTCUSDT", "price": 100, "volume": 3 },
  { "symbol": "BTCUSDT", "price": 110, "volume": 2 }
]`

export function RecorderForm() {
  const [form, setForm] = useState(emptyRecorder())
  const [amostras, setAmostras] = useState(AMOSTRA_EXEMPLO)
  const [previa, setPrevia] = useState<PreviewResult | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const navigate = useNavigate()

  const set = <K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) => setForm((f) => ({ ...f, [campo]: valor }))

  /** O corpo que vai para o servidor — o mesmo na prévia e na criação. */
  const corpo = () => ({
    ...form,
    entityKeyPath: form.entityKeyPath || null,
    occurredAtPath: form.occurredAtPath || null,
    changePath: form.changePath || null,
    selectedFields: form.selectedFields.length ? form.selectedFields : null,
  })

  async function testar() {
    setErro(null)
    setOcupado(true)
    try {
      const lista = JSON.parse(amostras) as unknown
      if (!Array.isArray(lista)) throw new Error('as amostras precisam ser uma lista JSON.')
      setPrevia(await previewRecorder(corpo(), lista))
    } catch (e) {
      setPrevia(null)
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  async function ativar() {
    setErro(null)
    setOcupado(true)
    try {
      const r = await createRecorder(corpo())
      navigate(`/historicos/${r.id}`)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <AppLayout current="/historicos" title="Novo histórico" subtitle="Nada é gravado antes de você ativar.">
      <div className="flex flex-col gap-4" data-testid="recorder-form">
        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nome" hint="Como você vai reconhecer este histórico.">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Preço do BTC a cada 5 minutos" data-testid="recorder-name" />
            </Field>
            <Field label="Guardar por" hint="Depois disso, o registro é apagado sozinho.">
              <Select
                value={String(form.retentionDays)}
                onChange={(e) => set('retentionDays', Number(e.target.value))}
                data-testid="recorder-retention"
                options={[7, 30, 90, 180, 365].map((d) => ({ value: String(d), label: `${d} dias` }))}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="De onde vem o dado">
              <Select
                value={form.source.kind}
                onChange={(e) => set('source', { ...form.source, kind: e.target.value as SourceKind })}
                data-testid="recorder-source-kind"
                options={(['live_data', 'event', 'manual'] as SourceKind[]).map((k) => ({ value: k, label: SOURCE_LABEL[k] }))}
              />
            </Field>
            <Field
              label={form.source.kind === 'live_data' ? 'Qual conexão' : form.source.kind === 'event' ? 'Qual evento' : 'Nome da origem'}
              hint={form.source.kind === 'event' ? 'Ex.: market.candle.closed' : undefined}
            >
              <Input value={form.source.ref} onChange={(e) => set('source', { ...form.source, ref: e.target.value })} data-testid="recorder-source-ref" />
            </Field>
            <Field label="O que identifica cada série" hint="Ex.: symbol, sku, sensorId. Em branco, tudo vira uma série só.">
              <Input value={form.entityKeyPath} onChange={(e) => set('entityKeyPath', e.target.value)} placeholder="symbol" data-testid="recorder-entity" />
            </Field>
            <Field label="Onde está a data do fato" hint="Em branco, vale o instante em que chegou.">
              <Input value={form.occurredAtPath} onChange={(e) => set('occurredAtPath', e.target.value)} placeholder="at" data-testid="recorder-occurred" />
            </Field>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-3">
            <Field label="Quando guardar" hint={MODE_HINT[form.mode]}>
              <Select
                value={form.mode}
                onChange={(e) => set('mode', e.target.value as RecorderMode)}
                data-testid="recorder-mode"
                options={MODOS.map((m) => ({ value: m, label: MODE_LABEL[m] }))}
              />
            </Field>

            {(form.mode === 'snapshot_interval' || form.mode === 'window_aggregate') && (
              <Field label="Período">
                <Select
                  value={String(form.intervalMs)}
                  onChange={(e) => set('intervalMs', Number(e.target.value))}
                  data-testid="recorder-interval"
                  options={INTERVALOS.map((i) => ({ value: String(i.ms), label: i.label }))}
                />
              </Field>
            )}

            {form.mode === 'schedule_snapshot' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Hora (UTC)">
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={String(form.schedule.hour)}
                    onChange={(e) => set('schedule', { ...form.schedule, hour: Number(e.target.value) })}
                    data-testid="recorder-hour"
                  />
                </Field>
                <Field label="Minuto">
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    value={String(form.schedule.minute)}
                    onChange={(e) => set('schedule', { ...form.schedule, minute: Number(e.target.value) })}
                    data-testid="recorder-minute"
                  />
                </Field>
              </div>
            )}

            {form.mode === 'on_change' && (
              <Field label="Qual campo observar" hint="Em branco, qualquer mudança no valor conta.">
                <Input value={form.changePath} onChange={(e) => set('changePath', e.target.value)} placeholder="price" data-testid="recorder-change" />
              </Field>
            )}
          </div>
        </Card>

        {form.mode === 'window_aggregate' && (
          <Card>
            <div className="flex flex-col gap-3">
              <Field label="O que calcular no período" hint="Ex.: price com “primeiro” vira a abertura; price com “maior” vira a máxima.">
                <div className="flex flex-col gap-2" data-testid="aggregation-list">
                  {form.aggregations.map((a, i) => (
                    <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_1fr_auto]" data-testid="aggregation-row">
                      <Input
                        value={a.from}
                        placeholder="price"
                        aria-label="Campo de origem"
                        onChange={(e) => set('aggregations', form.aggregations.map((x, j) => (i === j ? { ...x, from: e.target.value } : x)))}
                      />
                      <Select
                        value={a.op}
                        aria-label="Operação"
                        onChange={(e) => set('aggregations', form.aggregations.map((x, j) => (i === j ? { ...x, op: e.target.value as AggregationOp } : x)))}
                        options={OPS.map((o) => ({ value: o, label: OP_LABEL[o] }))}
                      />
                      <Input
                        value={a.to}
                        placeholder="open"
                        aria-label="Nome do resultado"
                        onChange={(e) => set('aggregations', form.aggregations.map((x, j) => (i === j ? { ...x, to: e.target.value } : x)))}
                      />
                      <Button variant="ghost" size="sm" onClick={() => set('aggregations', form.aggregations.filter((_, j) => j !== i))}>
                        Remover
                      </Button>
                    </div>
                  ))}
                </div>
              </Field>
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => set('aggregations', [...form.aggregations, { from: '', op: 'last', to: '' }])}
                  data-testid="add-aggregation"
                >
                  Adicionar cálculo
                </Button>
              </div>
            </div>
          </Card>
        )}

        <Card>
          <div className="flex flex-col gap-3">
            <Field label="Testar com dados de exemplo" hint="Cole algumas mensagens como elas chegam. Nada é gravado.">
              <Textarea rows={6} value={amostras} onChange={(e) => setAmostras(e.target.value)} data-testid="recorder-samples" />
            </Field>
            {erro && (
              <p role="alert" style={{ color: 'var(--intent-danger)', fontSize: 13 }} data-testid="recorder-error">
                {erro}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void testar()} disabled={ocupado} data-testid="recorder-preview">
                Testar configuração
              </Button>
              <Button onClick={() => void ativar()} disabled={ocupado || !form.name.trim()} data-testid="recorder-activate">
                Ativar
              </Button>
            </div>

            {previa && (
              <div className="flex flex-col gap-2" data-testid="recorder-preview-result">
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>O que aconteceria com estas amostras</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-muted)' }}>
                  {previa.decisions.map((d) => (
                    <li key={d.index}>
                      amostra {d.index + 1}: <strong>{d.resultado}</strong>
                    </li>
                  ))}
                </ul>
                {previa.records.length > 0 && (
                  <pre
                    style={{ margin: 0, overflowX: 'auto', fontSize: 12, background: 'var(--surface-sunken)', padding: 10, borderRadius: 8 }}
                    data-testid="preview-records"
                  >
                    {JSON.stringify(previa.records.map((r) => r.value), null, 2)}
                  </pre>
                )}
                {previa.windows.length > 0 && (
                  <pre
                    style={{ margin: 0, overflowX: 'auto', fontSize: 12, background: 'var(--surface-sunken)', padding: 10, borderRadius: 8 }}
                    data-testid="preview-windows"
                  >
                    {JSON.stringify(previa.windows, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>
    </AppLayout>
  )
}
