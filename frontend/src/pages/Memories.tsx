import { useCallback, useEffect, useState } from 'react'
import { clearMemories, deleteMemory, listMemoryScopes, searchMemories, type MemoryRecord, type MemoryScopeSummary } from '../lib/memories'
import { Button, Card, EmptyState, Field, Input, Select, Tag } from '../ui'

// O que o prédio guardou.
//
// Existe porque memória invisível é memória em que ninguém confia: sem uma tela, o
// dono não tem como saber se o webhook está gravando o que devia, se está gravando
// duas vezes, ou se está enchendo o banco com um campo que ele nem queria. Aqui ele
// vê, procura e apaga.
//
// Os lugares vêm do servidor já filtrados pela conta: a tela nunca monta um destino
// que o dono não tenha.

const ESCOPO_LABEL: Record<string, string> = {
  agent: 'Agente',
  sector: 'Setor',
  floor: 'Andar',
  building: 'Prédio',
}

const quando = (iso: string): string => new Date(iso).toLocaleString('pt-BR')

function Conteudo({ valor }: { valor: unknown }) {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor, null, 2)
  return (
    <pre
      style={{
        margin: 0,
        padding: 10,
        borderRadius: 8,
        background: 'var(--surface-sunken)',
        fontSize: 11.5,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 220,
        overflow: 'auto',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      {texto}
    </pre>
  )
}

export default function Memories() {
  const [scopes, setScopes] = useState<MemoryScopeSummary[]>([])
  const [scopeKey, setScopeKey] = useState('')
  const [busca, setBusca] = useState('')
  const [origem, setOrigem] = useState('')
  const [items, setItems] = useState<MemoryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [limpando, setLimpando] = useState(false)

  const carregarEscopos = useCallback(() => {
    listMemoryScopes()
      .then(setScopes)
      .catch(() => setScopes([]))
  }, [])

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const r = await searchMemories({
        scopeKey: scopeKey || null,
        q: busca.trim() || null,
        sourceType: origem || null,
        limit: 50,
      })
      setItems(r.items)
      setTotal(r.total)
    } catch {
      setErro('Não foi possível carregar as memórias agora.')
    } finally {
      setCarregando(false)
    }
  }, [scopeKey, busca, origem])

  useEffect(() => {
    carregarEscopos()
  }, [carregarEscopos])
  useEffect(() => {
    void carregar()
  }, [carregar])

  const apagar = async (id: string) => {
    await deleteMemory(id).catch(() => undefined)
    await carregar()
    carregarEscopos()
  }

  const limparDestino = async () => {
    if (!scopeKey) return
    setLimpando(true)
    try {
      await clearMemories(scopeKey)
      await carregar()
      carregarEscopos()
    } finally {
      setLimpando(false)
    }
  }

  const comRegistros = scopes.filter((s) => s.count > 0)

  return (
    <div style={{ display: 'grid', gap: 16 }} data-testid="memories-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Memória</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            O que os gatilhos e as rotinas guardaram. Nada aqui passou por IA — e consultar também não consome tokens.
          </p>
        </div>
        {scopeKey ? (
          <Button variant="secondary" size="sm" icon="trash-2" onClick={() => void limparDestino()} disabled={limpando} data-testid="clear-scope">
            {limpando ? 'Limpando…' : 'Limpar este destino'}
          </Button>
        ) : null}
      </div>

      {/* --- onde procurar ---------------------------------------------------- */}
      <Card padding="14px 16px" style={{ display: 'grid', gap: 12 }}>
        {/* Três colunas quando cabem três. Num celular de 320px os dois seletores
            ficavam com 77px, estreitos demais para ler a opção escolhida. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
          <Field label="Buscar" hint="Procura na chave e no conteúdo. Busca textual, sem IA.">
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: nome do cliente" data-testid="memory-search" />
          </Field>
          <Field label="Onde">
            <Select
              value={scopeKey}
              onChange={(e) => setScopeKey(e.target.value)}
              data-testid="memory-scope-filter"
              aria-label="Onde"
              options={[
                { value: '', label: `Tudo (${scopes.reduce((s, e) => s + e.count, 0)})` },
                ...comRegistros.map((s) => ({ value: s.scopeKey, label: `${ESCOPO_LABEL[s.scope]} · ${s.label} (${s.count})` })),
              ]}
            />
          </Field>
          <Field label="Origem">
            <Select
              value={origem}
              onChange={(e) => setOrigem(e.target.value)}
              data-testid="memory-source-filter"
              aria-label="Origem"
              options={[
                { value: '', label: 'Qualquer origem' },
                { value: 'webhook', label: 'Webhook' },
                { value: 'schedule', label: 'Rotina agendada' },
                { value: 'manual', label: 'Manual' },
              ]}
            />
          </Field>
        </div>
      </Card>

      {erro ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--status-blocked)' }} data-testid="memories-error">
          {erro}
        </p>
      ) : null}

      {carregando && items.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }} data-testid="memories-loading">
          Carregando…
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon="database"
          title="Nada guardado ainda"
          body="Quando um gatilho ou uma rotina salvar informação, ela aparece aqui. Configure o destino da memória na criação do gatilho."
        />
      ) : (
        <div style={{ display: 'grid', gap: 10 }} data-testid="memories-list">
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="memories-total">
            {total} registro{total === 1 ? '' : 's'}
            {items.length < total ? ` · mostrando os ${items.length} mais recentes` : ''}
          </p>
          {items.map((m) => (
            <Card key={m.id} padding="14px 16px" style={{ display: 'grid', gap: 8 }} data-testid="memory-card">
              <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14 }}>{m.key}</strong>
                    <Tag>{`${ESCOPO_LABEL[m.scope]}${m.scopeLabel ? ` · ${m.scopeLabel}` : ''}`}</Tag>
                    <Tag>{m.sourceType}</Tag>
                    {m.expiresAt ? <Tag>{`expira em ${quando(m.expiresAt)}`}</Tag> : null}
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {quando(m.createdAt)}
                    {m.updatedAt !== m.createdAt ? ` · atualizado ${quando(m.updatedAt)}` : ''}
                  </p>
                </div>
                <Button variant="ghost" size="sm" icon="trash-2" onClick={() => void apagar(m.id)} data-testid="delete-memory">
                  Apagar
                </Button>
              </div>
              <Conteudo valor={m.payload} />
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
