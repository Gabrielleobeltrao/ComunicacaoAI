import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { AppLayout } from '../../components/AppLayout'
import { Button, Card, Field, Input, Select, Textarea } from '../../ui'
import {
  MODE_HINT,
  MODE_LABEL,
  OPERATOR_LABEL,
  OP_LABEL,
  POLICY_HINT,
  POLICY_LABEL,
  RECURRENCES,
  SOURCE_LABEL,
  TIMEZONES,
  createRecorder,
  emptyRecorder,
  listSources,
  previewRecorder,
} from '../../lib/dataHistory'
import type { AggregationOp, FilterOperator, PersistPolicy, PreviewResult, RecorderMode, SourceCatalog, SourceKind } from '../../lib/dataHistory'

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
  /** As fontes desta conta. Ninguém deveria precisar copiar um id de banco. */
  const [fontes, setFontes] = useState<SourceCatalog | null>(null)
  const [buscaEvento, setBuscaEvento] = useState('')
  /**
   * "Outra (avançado)" precisa de estado PRÓPRIO.
   *
   * Deduzir isso do cron não funciona: quem escolhe avançado começa com a expressão que
   * já estava lá, que é uma das da lista — e o campo de texto nunca apareceria.
   */
  const [cronLivre, setCronLivre] = useState(false)
  const [amostras, setAmostras] = useState(AMOSTRA_EXEMPLO)
  const [previa, setPrevia] = useState<PreviewResult | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const navigate = useNavigate()

  const set = <K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) => setForm((f) => ({ ...f, [campo]: valor }))

  useEffect(() => {
    listSources()
      .then(setFontes)
      // Sem catálogo a tela ainda funciona: o campo vira texto livre. Melhor do que
      // travar a criação porque uma listagem falhou.
      .catch(() => setFontes({ live_data: [], event: [] }))
  }, [])

  const opcoes = form.source.kind === 'live_data' ? (fontes?.live_data ?? []) : form.source.kind === 'event' ? (fontes?.event ?? []) : []
  const eventosFiltrados = opcoes.filter((o) => !buscaEvento.trim() || o.label.toLowerCase().includes(buscaEvento.trim().toLowerCase()))

  /** O corpo que vai para o servidor — o mesmo na prévia e na criação. */
  const corpo = () => ({
    ...form,
    entityKeyPath: form.entityKeyPath || null,
    occurredAtPath: form.occurredAtPath || null,
    changePath: form.changePath || null,
    // Linhas em branco no editor não são configuração: elas são o cursor de quem ainda
    // está digitando, e mandá-las viraria erro de validação sem motivo.
    selectedFields: form.selectedFields.filter((c) => c.trim()).length ? form.selectedFields.filter((c) => c.trim()) : null,
    filters: form.filters.filter((f) => f.path.trim()),
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
              hint={
                form.source.kind === 'manual'
                  ? 'O nome que o seu código usa ao registrar o dado.'
                  : form.source.kind === 'live_data' && opcoes.length === 0
                    ? 'Nenhuma conexão de WebSocket nesta conta ainda.'
                    : undefined
              }
            >
              {form.source.kind === 'manual' || opcoes.length === 0 ? (
                <Input value={form.source.ref} onChange={(e) => set('source', { ...form.source, ref: e.target.value })} data-testid="recorder-source-ref" />
              ) : (
                <Select
                  value={form.source.ref}
                  onChange={(e) => set('source', { ...form.source, ref: e.target.value })}
                  data-testid="recorder-source-ref"
                  options={[
                    { value: '', label: 'Escolha…' },
                    ...eventosFiltrados.map((o) => ({ value: o.ref, label: o.hint ? `${o.label} — ${o.hint}` : o.label })),
                  ]}
                />
              )}
            </Field>
            {form.source.kind === 'event' && opcoes.length > 8 && (
              <Field label="Buscar evento">
                <Input value={buscaEvento} onChange={(e) => setBuscaEvento(e.target.value)} placeholder="market" data-testid="event-search" />
              </Field>
            )}
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
                <Field label="Quando">
                  <Select
                    value={cronLivre || !RECURRENCES.some((r) => r.cron === form.schedule.cron) ? 'custom' : form.schedule.cron}
                    onChange={(e) => {
                      const avancado = e.target.value === 'custom'
                      setCronLivre(avancado)
                      if (!avancado) set('schedule', { ...form.schedule, cron: e.target.value })
                    }}
                    data-testid="recorder-recurrence"
                    options={[...RECURRENCES.map((r) => ({ value: r.cron, label: r.label })), { value: 'custom', label: 'Outra (avançado)' }]}
                  />
                </Field>
                <Field label="Fuso horário" hint="O horário é o SEU, não o do servidor.">
                  <Select
                    value={form.schedule.timezone}
                    onChange={(e) => set('schedule', { ...form.schedule, timezone: e.target.value })}
                    data-testid="recorder-timezone"
                    options={TIMEZONES.map((t) => ({ value: t, label: t }))}
                  />
                </Field>
                {(cronLivre || !RECURRENCES.some((r) => r.cron === form.schedule.cron)) && (
                  <Field label="Recorrência (cron)" hint="Cinco campos: minuto, hora, dia, mês, dia da semana.">
                    <Input
                      value={form.schedule.cron}
                      onChange={(e) => set('schedule', { ...form.schedule, cron: e.target.value })}
                      placeholder="0 8 * * 1-5"
                      data-testid="recorder-cron"
                    />
                  </Field>
                )}
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

        {form.mode === 'window_aggregate' && (
          <Card>
            <Field label="O que guardar" hint={POLICY_HINT[form.persistPolicy]}>
              <Select
                value={form.persistPolicy}
                onChange={(e) => set('persistPolicy', e.target.value as PersistPolicy)}
                data-testid="recorder-policy"
                options={(['aggregate_only', 'raw_only', 'raw_and_aggregate'] as PersistPolicy[]).map((p) => ({ value: p, label: POLICY_LABEL[p] }))}
              />
            </Field>
          </Card>
        )}

        <Card>
          <div className="flex flex-col gap-3">
            {/* Os filtros valem para TODO modo — eles decidem o que sequer é considerado.
                No modo "só quando a condição bater" eles são obrigatórios, e a tela diz. */}
            <Field
              label="Só considerar quando"
              hint={
                form.mode === 'condition'
                  ? 'Obrigatório neste modo: sem nenhuma condição, tudo seria gravado.'
                  : 'Opcional. Sem nenhuma condição, tudo que chega é considerado.'
              }
            >
              <div className="flex flex-col gap-2" data-testid="filter-list">
                {form.filters.map((f, i) => (
                  <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px_1fr_auto]" data-testid="filter-row">
                    <Input
                      value={f.path}
                      placeholder="qty"
                      aria-label="Campo"
                      onChange={(e) => set('filters', form.filters.map((x, j) => (i === j ? { ...x, path: e.target.value } : x)))}
                    />
                    <Select
                      value={f.operator}
                      aria-label="Comparação"
                      onChange={(e) => set('filters', form.filters.map((x, j) => (i === j ? { ...x, operator: e.target.value as FilterOperator } : x)))}
                      options={(Object.keys(OPERATOR_LABEL) as FilterOperator[]).map((o) => ({ value: o, label: OPERATOR_LABEL[o] }))}
                    />
                    {/* `existe` não compara com nada: pedir um valor ali seria pedir algo
                        que não é usado, e quem preenchesse acharia que estava filtrando. */}
                    {f.operator === 'exists' ? (
                      <span style={{ fontSize: 13, color: 'var(--text-muted)', alignSelf: 'center' }}>—</span>
                    ) : (
                      <Input
                        value={String(f.value ?? '')}
                        placeholder="10"
                        aria-label="Valor"
                        onChange={(e) => set('filters', form.filters.map((x, j) => (i === j ? { ...x, value: e.target.value } : x)))}
                      />
                    )}
                    <Button variant="ghost" size="sm" onClick={() => set('filters', form.filters.filter((_, j) => j !== i))}>
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
                onClick={() => set('filters', [...form.filters, { path: '', operator: 'equals' as FilterOperator, value: '' }])}
                data-testid="add-filter"
              >
                Adicionar condição
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-3">
            <Field label="O que guardar de cada dado">
              <Select
                value={form.selectedFields.length ? 'alguns' : 'tudo'}
                onChange={(e) => set('selectedFields', e.target.value === 'tudo' ? [] : [''])}
                data-testid="fields-mode"
                options={[
                  { value: 'tudo', label: 'O dado inteiro' },
                  { value: 'alguns', label: 'Só os campos que eu escolher' },
                ]}
              />
            </Field>
            {form.selectedFields.length > 0 && (
              <div className="flex flex-col gap-2" data-testid="field-list">
                {form.selectedFields.map((c, i) => (
                  <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]" data-testid="field-row">
                    <Input
                      value={c}
                      placeholder="data.total"
                      aria-label={`Campo ${i + 1}`}
                      onChange={(e) => set('selectedFields', form.selectedFields.map((x, j) => (i === j ? e.target.value : x)))}
                    />
                    <Button variant="ghost" size="sm" onClick={() => set('selectedFields', form.selectedFields.filter((_, j) => j !== i))}>
                      Remover
                    </Button>
                  </div>
                ))}
                <div>
                  <Button size="sm" variant="secondary" onClick={() => set('selectedFields', [...form.selectedFields, ''])} data-testid="add-field">
                    Adicionar campo
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

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
                {/* O que o motor RESOLVEU, e não só o veredito: um caminho de chave
                    errado aparece aqui como "chave: —", que é a explicação inteira. */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }} data-testid="preview-decisions">
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '4px 6px' }}>#</th>
                        <th style={{ padding: '4px 6px' }}>Decisão</th>
                        <th style={{ padding: '4px 6px' }}>Chave</th>
                        <th style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>Quando</th>
                        <th style={{ padding: '4px 6px' }}>Valor gravado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previa.decisions.map((d) => (
                        <tr key={d.index} style={{ borderTop: '1px solid var(--border-subtle)' }} data-testid="preview-decision">
                          <td style={{ padding: '4px 6px' }}>{d.index + 1}</td>
                          <td style={{ padding: '4px 6px' }}>{d.motivo}</td>
                          <td style={{ padding: '4px 6px' }}>{d.entityKey ?? '—'}</td>
                          <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{new Date(d.occurredAt).toLocaleString('pt-BR')}</td>
                          <td style={{ padding: '4px 6px' }}>
                            <code style={{ fontSize: 11.5 }}>{d.valor ? JSON.stringify(d.valor) : '—'}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
