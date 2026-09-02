import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { Badge, Card, Input } from '../ui'
import * as api from '../lib/resources'
import type { ResourceKind, ResourceSummary } from '../lib/resources'

// RECURSOS — "o que este escritório possui".
//
// Uma lista só, com o tipo como filtro em vez de quatro telas paralelas. A pergunta que
// alguém traz até aqui raramente é "quais Apps eu tenho": é "de onde vem essa resposta?"
// ou "o que existe sobre isso?", e essas duas atravessam os tipos.
//
// A tela mostra DONO e ESTADO. Elas são coisas diferentes, e a confusão entre as duas é o
// que faz alguém pensar que um App conectado está disponível para todo agente.

const FLAG_LABEL: Record<string, string> = {
  not_connected: 'sem conexão',
  disabled: 'desligada',
  index_error: 'erro ao indexar',
  expired: 'vencido',
  expiring_soon: 'vence em breve',
  due_for_review: 'revisão pendente',
  draft: 'rascunho',
  archived: 'arquivado',
}

const OWNER_LABEL: Record<string, string> = {
  platform: 'Plataforma',
  account: 'Escritório',
  building: 'Prédio',
  floor: 'Andar',
  sector: 'Setor',
  agent: 'Agente',
}

export function Resources() {
  const [params, setParams] = useSearchParams()
  const kind = (params.get('kind') as ResourceKind | null) ?? null
  const [busca, setBusca] = useState(params.get('q') ?? '')
  const [dados, setDados] = useState<{ items: ResourceSummary[]; byKind: Record<string, number>; kinds: ResourceKind[] } | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setDados(await api.listResources({ kind: kind ?? undefined, q: busca || undefined, limit: 200 }))
    } catch (e) {
      // O que estava na tela FICA: apagar por causa de uma falha de rede é a mesma
      // mentira de mostrar vazio.
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [kind, busca])

  useEffect(() => {
    const t = setTimeout(() => void carregar(), busca ? 300 : 0)
    return () => clearTimeout(t)
  }, [carregar, busca])

  const trocarTipo = (proximo: ResourceKind | null) => {
    const p = new URLSearchParams(params)
    if (proximo) p.set('kind', proximo)
    else p.delete('kind')
    setParams(p, { replace: true })
  }

  const tipos = dados?.kinds ?? []

  return (
    <AppLayout current="/resources" title="Recursos" subtitle="O que este escritório possui e quem pode usar">
      <div className="flex flex-col gap-3">
        <Card>
          <div className="flex flex-col gap-3">
            <Input
              value={busca}
              placeholder="Buscar por nome…"
              onChange={(e) => setBusca(e.target.value)}
              data-testid="resources-search"
              aria-label="Buscar recursos"
            />
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tipo de recurso">
              {[null, ...tipos].map((t) => (
                <button
                  key={t ?? 'todos'}
                  type="button"
                  role="tab"
                  aria-selected={kind === t}
                  onClick={() => trocarTipo(t)}
                  data-testid={`resources-tab-${t ?? 'all'}`}
                  style={{
                    minHeight: 40,
                    padding: '0 14px',
                    borderRadius: 999,
                    border: '1px solid var(--border-subtle)',
                    background: kind === t ? 'var(--intent-brand)' : 'var(--surface-card)',
                    color: kind === t ? '#fff' : 'var(--text-muted)',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {t ? api.KIND_LABEL[t] : 'Tudo'}
                  {t && dados?.byKind[t] !== undefined ? ` (${dados.byKind[t]})` : ''}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Quatro estados distintos: carregando, erro, vazio e lista. Um erro desenhado
            como vazio faz a pessoa concluir que não tem recurso nenhum. */}
        {carregando && !dados && <p style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="resources-loading">Carregando recursos…</p>}
        {erro && (
          <Card>
            <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger)' }} data-testid="resources-error">
              {erro}{' '}
              <button type="button" onClick={carregar} style={{ textDecoration: 'underline', background: 'none', border: 0, cursor: 'pointer', color: 'inherit' }}>
                Tentar de novo
              </button>
            </p>
          </Card>
        )}
        {dados && dados.items.length === 0 && !erro && (
          <Card>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="resources-empty">
              {busca ? 'Nada encontrado com esse nome.' : 'Este escritório ainda não tem recursos deste tipo.'}
            </p>
          </Card>
        )}

        {dados && dados.items.length > 0 && (
          <Card>
            <div className="flex flex-col gap-2" data-testid="resources-list">
              {dados.items.map((r) => (
                <div key={`${r.kind}:${r.id}`} className="flex flex-wrap items-start gap-2" data-testid={`resource-${r.kind}-${r.id}`}>
                  <Badge>{api.KIND_SINGULAR[r.kind]}</Badge>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: 'anywhere' }}>{r.name}</span>
                    {r.description && (
                      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{r.description}</p>
                    )}
                    <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                      Dono: {OWNER_LABEL[r.owner.ownerType] ?? r.owner.ownerType}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {(r.flags ?? []).map((f) => (
                      <Badge key={f} tone="warning">
                        {FLAG_LABEL[f] ?? f}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
