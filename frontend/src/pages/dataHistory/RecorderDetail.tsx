import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { AppLayout } from '../../components/AppLayout'
import { Badge, Button, Card, EmptyState, Field, Input, Select, Switch } from '../../ui'
import { KIND_LABEL, MODE_LABEL, OP_LABEL, SOURCE_LABEL, aggregateRecords, getRecorder, listKeys, listRecords, retentionLabel, updateRecorder } from '../../lib/dataHistory'
import type { DataRecorder, HistoryRecord, RecordKind } from '../../lib/dataHistory'

/**
 * Um histórico: o que ele guarda, e o que já guardou.
 *
 * A consulta é por chave e por período, que é como as duas perguntas reais aparecem —
 * "quanto estava o BTC ontem à tarde" e "quantos pedidos entraram na semana passada"
 * são a mesma consulta com nomes diferentes.
 */
export function RecorderDetail() {
  const { recorderId = '' } = useParams()
  const [rec, setRec] = useState<DataRecorder | null>(null)
  const [chaves, setChaves] = useState<(string | null)[]>([])
  const [registros, setRegistros] = useState<HistoryRecord[] | null>(null)
  const [resumo, setResumo] = useState<Record<string, unknown> | null>(null)
  const [chave, setChave] = useState('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [tipo, setTipo] = useState<RecordKind | ''>('')
  const [ordem, setOrdem] = useState<'asc' | 'desc'>('desc')
  const [pagina, setPagina] = useState(0)
  const [total, setTotal] = useState(0)
  /** Qual linha está aberta em JSON. Uma de cada vez: a tabela é para varrer. */
  const [aberto, setAberto] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const POR_PAGINA = 100

  const consultar = useCallback(
    async (salto = 0) => {
      setErro(null)
      try {
        const q = { entityKey: chave || undefined, from: de || undefined, to: ate || undefined, recordKind: tipo || undefined }
        const [r, a] = await Promise.all([
          listRecords(recorderId, { ...q, limit: POR_PAGINA, skip: salto, order: ordem }),
          aggregateRecords(recorderId, q),
        ])
        setRegistros(r.items)
        setTotal(r.total)
        setPagina(salto)
        setResumo(a.result)
      } catch (e) {
        setErro((e as Error).message)
      }
    },
    [recorderId, chave, de, ate, tipo, ordem],
  )

  useEffect(() => {
    getRecorder(recorderId).then(setRec).catch((e) => setErro((e as Error).message))
    listKeys(recorderId).then(setChaves).catch(() => setChaves([]))
    void consultar()
    // A consulta inicial é a sem filtro: abrir a tela já mostra o que existe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderId])

  async function alternar(ativo: boolean) {
    try {
      setRec(await updateRecorder(recorderId, { enabled: ativo }))
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  return (
    <AppLayout current="/historicos" title={rec?.name ?? 'Histórico'} subtitle={rec ? `${SOURCE_LABEL[rec.source.kind]} · ${rec.source.ref}` : undefined}>
      <div className="flex flex-col gap-4" data-testid="recorder-detail">
        {erro && (
          <p role="alert" style={{ color: 'var(--intent-danger-text)', fontSize: 13 }} data-testid="detail-error">
            {erro}
          </p>
        )}

        {rec && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={rec.enabled ? 'success' : 'neutral'}>{rec.enabled ? 'Ativo' : 'Desligado'}</Badge>
                <Badge tone="brand">{MODE_LABEL[rec.mode]}</Badge>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="recorder-storage-info">
                  {rec.recordCount.toLocaleString('pt-BR')} registro(s) · {rec.storage?.kind === 'internal' ? 'Banco interno' : rec.storage?.kind} ·{' '}
                  {retentionLabel(rec.retention)}
                </span>
              </div>
              <Switch checked={rec.enabled} onChange={(v) => void alternar(v)} label="Ativo" data-testid="toggle-recorder" />
            </div>
            {rec.aggregations.length > 0 && (
              <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--text-muted)' }} data-testid="recorder-rules">
                {rec.aggregations.map((a) => `${a.from || 'ocorrências'} → ${OP_LABEL[a.op]} → ${a.to}`).join(' · ')}
              </p>
            )}
          </Card>
        )}

        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Chave">
              <Select
                value={chave}
                onChange={(e) => setChave(e.target.value)}
                data-testid="filter-key"
                options={[{ value: '', label: 'Todas' }, ...chaves.filter(Boolean).map((c) => ({ value: String(c), label: String(c) }))]}
              />
            </Field>
            <Field label="De">
              <Input type="datetime-local" value={de} onChange={(e) => setDe(e.target.value)} data-testid="filter-from" />
            </Field>
            <Field label="Até">
              <Input type="datetime-local" value={ate} onChange={(e) => setAte(e.target.value)} data-testid="filter-to" />
            </Field>
            {/* Separar por tipo importa: somar um tique e o resumo da hora conta o
                mesmo dado duas vezes. */}
            <Field label="Tipo de registro">
              <Select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as RecordKind | '')}
                data-testid="filter-kind"
                options={[
                  { value: '', label: 'Todos' },
                  { value: 'raw', label: KIND_LABEL.raw },
                  { value: 'aggregate', label: KIND_LABEL.aggregate },
                  { value: 'snapshot', label: KIND_LABEL.snapshot },
                ]}
              />
            </Field>
            <Field label="Ordem">
              <Select
                value={ordem}
                onChange={(e) => setOrdem(e.target.value as 'asc' | 'desc')}
                data-testid="filter-order"
                options={[
                  { value: 'desc', label: 'Mais recente primeiro' },
                  { value: 'asc', label: 'Mais antigo primeiro' },
                ]}
              />
            </Field>
            <div className="flex items-end">
              <Button onClick={() => void consultar(0)} data-testid="filter-apply" style={{ width: '100%' }}>
                Consultar
              </Button>
            </div>
          </div>
        </Card>

        {resumo && Object.keys(resumo).length > 0 && (
          <Card>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>No período escolhido</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="period-summary">
              {Object.entries(resumo).map(([k, v]) => (
                <div key={k}>
                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{k}</p>
                  <p style={{ margin: 0, fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{String(v ?? '—')}</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {registros === null ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Carregando…</p>
        ) : registros.length === 0 ? (
          <EmptyState icon="database" title="Nada guardado neste período" body="Assim que a fonte produzir dado, ele aparece aqui." />
        ) : (
          <Card>
            {/* A tabela rola dentro do próprio cartão: a página não rola de lado. */}
            <div style={{ overflowX: 'auto' }} data-testid="records-table">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>Aconteceu</th>
                    <th style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>Gravado</th>
                    <th style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>Tipo</th>
                    <th style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>Chave</th>
                    <th style={{ padding: '6px 8px' }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map((r) => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border-subtle)' }} data-testid="record-row">
                      {/* Os dois instantes lado a lado: um evento atrasado meia hora não
                          é um evento de agora, e a diferença fica à vista. */}
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(r.occurredAt).toLocaleString('pt-BR')}
                      </td>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                        {new Date(r.recordedAt).toLocaleString('pt-BR')}
                      </td>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                        <Badge tone={r.recordKind === 'aggregate' ? 'brand' : r.recordKind === 'snapshot' ? 'warning' : 'neutral'}>
                          {KIND_LABEL[r.recordKind]}
                        </Badge>
                      </td>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.entityKey ?? '—'}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <button
                          type="button"
                          onClick={() => setAberto(aberto === r.id ? null : r.id)}
                          style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
                          data-testid="record-toggle"
                        >
                          <code style={{ fontSize: 12 }}>{aberto === r.id ? '▾' : '▸'} {JSON.stringify(r.value).slice(0, 80)}</code>
                        </button>
                        {aberto === r.id && (
                          <pre
                            style={{ margin: '6px 0 0', fontSize: 11.5, background: 'var(--surface-sunken)', padding: 8, borderRadius: 6, overflowX: 'auto' }}
                            data-testid="record-json"
                          >
                            {JSON.stringify(r.value, null, 2)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > registros.length && (
              <div className="flex flex-wrap items-center justify-between gap-2" style={{ marginTop: 10 }} data-testid="pagination">
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {pagina + 1}–{pagina + registros.length} de {total.toLocaleString('pt-BR')}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={pagina === 0} onClick={() => void consultar(Math.max(0, pagina - POR_PAGINA))} data-testid="page-prev">
                    Anteriores
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pagina + registros.length >= total}
                    onClick={() => void consultar(pagina + POR_PAGINA)}
                    data-testid="page-next"
                  >
                    Próximos
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
