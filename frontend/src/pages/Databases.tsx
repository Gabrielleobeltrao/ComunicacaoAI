import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { Badge, Button, Card, Input, Textarea } from '../ui'
import * as api from '../lib/databases'
import { DatabaseGrants } from '../components/DatabaseGrants'
import type { DatabaseDetail, DatabaseSummary, DatasetSummary, QueryResult } from '../lib/databases'

// DATABASES — o sistema de registros do escritório.
//
// A tela existe para responder três coisas que ninguém conseguia responder antes: o que a
// empresa guarda, qual é a forma de cada conjunto, e quem consegue consultar. E ela diz
// ORIGEM e ATUALIZAÇÃO em voz alta — chamar dados de mercado de "memória" ou
// "conhecimento" é o começo de todo mal-entendido sobre o que o agente sabe.

export function Databases() {
  const [params, setParams] = useSearchParams()
  const aberto = params.get('id')
  const [lista, setLista] = useState<DatabaseSummary[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      setLista((await api.listDatabases()).items)
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const abrir = (id: string | null) => {
    const p = new URLSearchParams(params)
    if (id) p.set('id', id)
    else p.delete('id')
    setParams(p, { replace: true })
  }

  return (
    <AppLayout current="/databases" title="Databases" subtitle="O que este escritório guarda, e quem pode consultar">
      <div className="flex flex-col gap-3">
        {erro && (
          <Card>
            <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger-text)' }} data-testid="databases-error">
              {erro}{' '}
              <button type="button" onClick={carregar} style={{ textDecoration: 'underline', background: 'none', border: 0, cursor: 'pointer', color: 'inherit' }}>
                Tentar de novo
              </button>
            </p>
          </Card>
        )}

        {!aberto && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setCriando((v) => !v)} data-testid="databases-new">
                {criando ? 'Cancelar' : 'Criar database'}
              </Button>
            </div>
            {criando && <NovoDatabase onCriado={() => { setCriando(false); void carregar() }} />}

            {lista && lista.length === 0 && !erro && (
              <Card>
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="databases-empty">
                  Nenhum database ainda. Crie um para guardar registros estruturados — preço, pedido, ocorrência — sem misturá-los com conhecimento.
                </p>
              </Card>
            )}

            {lista && lista.length > 0 && (
              <Card>
                <div className="flex flex-col gap-2" data-testid="databases-list">
                  {lista.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => abrir(d.id)}
                      data-testid={`database-${d.id}`}
                      className="flex flex-wrap items-start gap-2"
                      style={{ textAlign: 'left', background: 'transparent', border: 0, padding: '8px 4px', cursor: 'pointer', minHeight: 'var(--hit-min, 44px)' }}
                    >
                      <Badge tone={d.status === 'active' ? 'success' : 'warning'}>{api.STATUS_LABEL[d.status]}</Badge>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{d.name}</span>
                        {d.description && <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{d.description}</p>}
                        {/* Origem em voz alta: mercado não é memória, e histórico não é RAG. */}
                        <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                          {api.ADAPTER_LABEL[d.adapterKind]} · {d.datasets} dataset(s)
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}

        {aberto && <DetalheDoDatabase id={aberto} onVoltar={() => abrir(null)} onMudou={carregar} />}
      </div>
    </AppLayout>
  )
}

function NovoDatabase({ onCriado }: { onCriado: () => void }) {
  const [nome, setNome] = useState('')
  const [adapter, setAdapter] = useState<api.AdapterKind>('data_history')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const salvar = async () => {
    setSalvando(true)
    setErro(null)
    try {
      await api.createDatabase({ name: nome, adapterKind: adapter })
      onCriado()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-2" data-testid="database-new-form">
        <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Nome
          <Input value={nome} onChange={(e) => setNome(e.target.value)} data-testid="database-new-name" />
        </label>
        <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          De onde vêm os dados
          <select
            value={adapter}
            onChange={(e) => setAdapter(e.target.value as api.AdapterKind)}
            data-testid="database-new-adapter"
            style={{ minHeight: 40, padding: '0 10px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', fontSize: 13 }}
          >
            {(Object.keys(api.ADAPTER_LABEL) as api.AdapterKind[]).map((k) => (
              <option key={k} value={k}>
                {api.ADAPTER_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {erro && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--intent-danger-text)' }} data-testid="database-new-error">
            {erro}
          </p>
        )}
        <div>
          <Button onClick={salvar} disabled={salvando || !nome.trim()} data-testid="database-new-save">
            {salvando ? 'Criando…' : 'Criar'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function DetalheDoDatabase({ id, onVoltar, onMudou }: { id: string; onVoltar: () => void; onMudou: () => void }) {
  const [detalhe, setDetalhe] = useState<DatabaseDetail | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [dataset, setDataset] = useState<DatasetSummary | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const d = await api.getDatabase(id)
      setDetalhe(d)
      setDataset((atual) => d.datasets.find((x) => x.key === atual?.key) ?? d.datasets[0] ?? null)
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [id])

  useEffect(() => {
    void carregar()
  }, [carregar])

  if (erro) {
    return (
      <Card>
        <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger-text)' }} data-testid="database-detail-error">
          {erro}
        </p>
      </Card>
    )
  }
  if (!detalhe) return null

  return (
    <div className="flex flex-col gap-3" data-testid="database-detail">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15 }}>{detalhe.name}</strong>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {api.ADAPTER_LABEL[detalhe.adapterKind]} · {api.STATUS_LABEL[detalhe.status]}
            </p>
          </div>
          <Button variant="secondary" onClick={onVoltar} data-testid="database-back">
            Voltar
          </Button>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-2" data-testid="database-datasets">
          <strong style={{ fontSize: 13 }}>Conjuntos de dados</strong>
          {detalhe.datasets.length === 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Nenhum dataset ainda.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {detalhe.datasets.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setDataset(d)}
                data-testid={`dataset-${d.key}`}
                style={{
                  minHeight: 40,
                  padding: '0 12px',
                  borderRadius: 999,
                  border: '1px solid var(--border-subtle)',
                  background: dataset?.key === d.key ? 'var(--intent-brand)' : 'var(--surface-card)',
                  color: dataset?.key === d.key ? '#fff' : 'var(--text-muted)',
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                {d.name} · {api.MUTABILITY_LABEL[d.mutability]}
              </button>
            ))}
          </div>
          <NovoDataset databaseId={id} onCriado={() => { void carregar(); onMudou() }} />
        </div>
      </Card>

      {dataset && <ConsultaDoDataset databaseId={id} dataset={dataset} />}

      <DatabaseGrants databaseId={id} />
    </div>
  )
}

function NovoDataset({ databaseId, onCriado }: { databaseId: string; onCriado: () => void }) {
  const [aberto, setAberto] = useState(false)
  const [chave, setChave] = useState('')
  const [campos, setCampos] = useState('preco:number\nticker:string')
  const [erro, setErro] = useState<string | null>(null)

  const salvar = async () => {
    setErro(null)
    try {
      // O schema é montado a partir de "campo:tipo" — o formato mais simples que ainda
      // produz um schema de verdade. JSON cru na tela seria pedir para errar.
      const properties: Record<string, { type: string }> = {}
      for (const linha of campos.split('\n')) {
        const [nome, tipo] = linha.split(':').map((x) => x.trim())
        if (!nome) continue
        properties[nome] = { type: ['string', 'number', 'boolean'].includes(tipo) ? tipo : 'string' }
      }
      if (Object.keys(properties).length === 0) throw new Error('declare ao menos um campo')
      await api.createDataset(databaseId, { key: chave, name: chave, schema: { type: 'object', properties } })
      setAberto(false)
      setChave('')
      onCriado()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  if (!aberto) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setAberto(true)} data-testid="dataset-new">
          Adicionar conjunto
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2" style={{ padding: 10, borderRadius: 10, background: 'var(--surface-sunken)' }} data-testid="dataset-new-form">
      <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Chave (letras minúsculas, números e _)
        <Input value={chave} onChange={(e) => setChave(e.target.value)} data-testid="dataset-new-key" />
      </label>
      <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Campos — um por linha, no formato nome:tipo
        <Textarea rows={4} value={campos} onChange={(e) => setCampos(e.target.value)} data-testid="dataset-new-fields" />
      </label>
      {erro && (
        <p role="alert" style={{ fontSize: 12.5, color: 'var(--intent-danger-text)' }} data-testid="dataset-new-error">
          {erro}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={salvar} disabled={!chave.trim()} data-testid="dataset-new-save">
          Salvar
        </Button>
        <Button variant="secondary" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

function ConsultaDoDataset({ databaseId, dataset }: { databaseId: string; dataset: DatasetSummary }) {
  const [resultado, setResultado] = useState<QueryResult | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  const consultar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setResultado(await api.queryDataset(databaseId, dataset.key, { limit: 20 }))
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [databaseId, dataset.key])

  useEffect(() => {
    void consultar()
  }, [consultar])

  return (
    <Card>
      <div className="flex flex-col gap-2" data-testid="dataset-query">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong style={{ fontSize: 13 }}>{dataset.name}</strong>
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            campos: {dataset.fields.join(', ') || '—'}
          </span>
        </div>

        {carregando && <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Consultando…</p>}
        {erro && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--intent-danger-text)' }} data-testid="dataset-query-error">
            {erro}
          </p>
        )}

        {resultado && (
          <>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }} data-testid="dataset-query-counts">
              {/* "Quantos existem" e "quantos vieram" são coisas diferentes — e a diferença
                  muda a conclusão de quem lê. */}
              {resultado.returned} de {resultado.total} registro(s)
              {resultado.freshness ? ` · atualizado em ${new Date(resultado.freshness).toLocaleString('pt-BR')}` : ' · sem registros ainda'}
            </p>
            {resultado.rows.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ fontSize: 12.5, borderCollapse: 'collapse', minWidth: '100%' }} data-testid="dataset-query-table">
                  <thead>
                    <tr>
                      {Object.keys(resultado.rows[0]).map((c) => (
                        <th key={c} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.rows.map((linha, i) => (
                      <tr key={i}>
                        {Object.values(linha).map((v, j) => (
                          <td key={j} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>
                            {v instanceof Object ? JSON.stringify(v) : String(v ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
