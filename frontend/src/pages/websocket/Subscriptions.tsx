import { useEffect, useState } from 'react'
import {
  createSubscription,
  deleteSubscription,
  DESTINATION_LABEL,
  listConnections,
  listSubscriptions,
  listTargets,
  testSubscription,
  updateSubscription,
} from '../../lib/websocketApp'
import type { WsConnection, WsDestination, WsFilter, WsSubscription, WsTargets } from '../../lib/websocketApp'
import { Button, Card, EmptyState, Field, Input, Textarea } from '../../ui'
import { SemConexao, WsPage, quando, LINHA } from './shared'
import { DestinationFields } from './DestinationFields'

/**
 * O que ouvir, e o que fazer com isso.
 *
 * O destino é a decisão que custa: guardar é de graça, memória ocupa espaço, rotina e
 * agente custam tempo, e agente custa token. Por isso "Só guardar" é o que vem marcado —
 * quem quiser mais escolhe, sabendo, e a tela diz o preço de cada um.
 *
 * Criar e editar usam o MESMO formulário: eram dois, e o de edição sempre ficava um
 * campo atrás do de criação.
 */

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-card)',
  color: 'var(--text-body)',
  fontSize: 13.5,
}

interface Rascunho {
  id: string | null
  installationId: string
  name: string
  channel: string
  subscribeMessage: string
  unsubscribeMessage: string
  active: boolean
  destination: WsDestination
  /**
   * Os filtros DESTA assinatura — diferentes dos da conexão.
   *
   * Os da conexão decidem o que entra; estes decidem o que é desta assinatura. Duas
   * assinaturas na mesma conexão se distinguem por eles, e o backend já os suportava:
   * só a tela não deixava preenchê-los.
   */
  filters: WsFilter[]
}

const vazio = (installationId: string): Rascunho => ({
  id: null,
  installationId,
  name: '',
  channel: '',
  subscribeMessage: '',
  unsubscribeMessage: '',
  active: true,
  destination: { kind: 'history' },
  filters: [],
})

const deAssinatura = (s: WsSubscription): Rascunho => ({
  id: s.id,
  installationId: s.installationId,
  name: s.name,
  channel: s.channel,
  subscribeMessage: s.subscribeMessage,
  unsubscribeMessage: s.unsubscribeMessage,
  active: s.active,
  destination: s.destination,
  filters: s.filters ?? [],
})

export function WebSocketSubscriptions() {
  const [conexoes, setConexoes] = useState<WsConnection[]>([])
  const [assinaturas, setAssinaturas] = useState<WsSubscription[]>([])
  const [alvos, setAlvos] = useState<WsTargets | null>(null)
  const [rascunho, setRascunho] = useState<Rascunho | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [teste, setTeste] = useState<{ id: string; ok: boolean; message: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  const carregar = () =>
    Promise.all([listConnections(), listSubscriptions(), listTargets()])
      .then(([c, s, t]) => {
        setConexoes(c)
        setAssinaturas(s)
        setAlvos(t)
      })
      .catch(() => setErro('Não foi possível carregar.'))
      .finally(() => setCarregando(false))

  useEffect(() => {
    void carregar()
  }, [])

  const salvar = async () => {
    if (!rascunho) return
    setErro(null)
    setOcupado('salvar')
    try {
      const corpo = {
        installationId: rascunho.installationId,
        name: rascunho.name || 'Assinatura',
        channel: rascunho.channel,
        subscribeMessage: rascunho.subscribeMessage,
        unsubscribeMessage: rascunho.unsubscribeMessage,
        active: rascunho.active,
        destination: rascunho.destination,
        filters: rascunho.filters,
      }
      if (rascunho.id) await updateSubscription(rascunho.id, corpo)
      else await createSubscription(corpo)
      setRascunho(null)
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setOcupado(null)
    }
  }

  const setFiltro = (i: number, patch: Partial<WsFilter>) => {
    if (!rascunho) return
    setRascunho({ ...rascunho, filters: rascunho.filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) })
  }

  const alternar = async (s: WsSubscription) => {
    setOcupado(s.id)
    // Ligar manda a inscrição; desligar manda o cancelamento — os dois no servidor.
    await updateSubscription(s.id, { active: !s.active }).catch(() => undefined)
    await carregar()
    setOcupado(null)
  }

  const provar = async (s: WsSubscription) => {
    setOcupado(s.id)
    setTeste(null)
    try {
      const r = await testSubscription(s.id)
      setTeste({ id: s.id, ...r })
    } catch (e) {
      setTeste({ id: s.id, ok: false, message: e instanceof Error ? e.message : 'Não foi possível testar.' })
    } finally {
      setOcupado(null)
    }
  }

  return (
    <WsPage current="/apps/websocket/subscriptions" title="WebSocket · Assinaturas" subtitle="O que ouvir em cada conexão, e para onde mandar.">
      {erro ? <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--coral-600, #d92d20)' }} data-testid="ws-sub-error">{erro}</p> : null}
      {carregando ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando…</p>
      ) : conexoes.length === 0 ? (
        <SemConexao />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {rascunho ? (
            <Card padding="16px" style={{ display: 'grid', gap: 10 }} data-testid="ws-subscription-form">
              <Field label="Conexão">
                <select
                  style={selectStyle}
                  value={rascunho.installationId}
                  onChange={(e) => setRascunho({ ...rascunho, installationId: e.target.value })}
                  data-testid="ws-sub-connection"
                >
                  {conexoes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Nome">
                <Input value={rascunho.name} onChange={(e) => setRascunho({ ...rascunho, name: e.target.value })} placeholder="Ex.: Pedidos novos" data-testid="ws-sub-name" />
              </Field>
              <Field label="Canal" hint="Vazio aceita qualquer canal.">
                <Input value={rascunho.channel} onChange={(e) => setRascunho({ ...rascunho, channel: e.target.value })} data-testid="ws-sub-channel" />
              </Field>
              <Field label="Mensagem de inscrição" hint="Mandada ao conectar e a cada reconexão. Vazio se o serviço já envia tudo.">
                <Textarea rows={2} value={rascunho.subscribeMessage} onChange={(e) => setRascunho({ ...rascunho, subscribeMessage: e.target.value })} data-testid="ws-sub-subscribe" />
              </Field>
              <Field label="Mensagem de cancelamento" hint="Mandada ao pausar ou remover.">
                <Textarea rows={2} value={rascunho.unsubscribeMessage} onChange={(e) => setRascunho({ ...rascunho, unsubscribeMessage: e.target.value })} data-testid="ws-sub-unsubscribe" />
              </Field>

              <Field label="Filtros da assinatura" hint="Só o que casar com todos pertence a esta assinatura. Vazio aceita tudo que passar pela conexão.">
                <div style={{ display: 'grid', gap: 6 }}>
                  {rascunho.filters.map((f, i) => (
                    <div key={i} style={LINHA}>
                      <Input
                        value={f.path}
                        onChange={(e) => setFiltro(i, { path: e.target.value })}
                        placeholder="data.tipo"
                        data-testid={`ws-sub-filter-path-${i}`}
                      />
                      <select
                        style={selectStyle}
                        value={f.operator}
                        onChange={(e) => setFiltro(i, { operator: e.target.value as 'equals' | 'contains' })}
                        data-testid={`ws-sub-filter-op-${i}`}
                      >
                        <option value="equals">é igual a</option>
                        <option value="contains">contém</option>
                      </select>
                      <Input value={f.value} onChange={(e) => setFiltro(i, { value: e.target.value })} data-testid={`ws-sub-filter-value-${i}`} />
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash-2"
                        onClick={() => setRascunho({ ...rascunho, filters: rascunho.filters.filter((_, idx) => idx !== i) })}
                      />
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="plus"
                    onClick={() => setRascunho({ ...rascunho, filters: [...rascunho.filters, { path: '', operator: 'equals', value: '' }] })}
                    data-testid="ws-sub-add-filter"
                  >
                    Adicionar filtro
                  </Button>
                </div>
              </Field>

              <DestinationFields destination={rascunho.destination} targets={alvos} onChange={(d) => setRascunho({ ...rascunho, destination: d })} />

              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" onClick={() => void salvar()} disabled={ocupado === 'salvar'} data-testid="ws-sub-save">
                  {rascunho.id ? 'Salvar alterações' : 'Criar assinatura'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRascunho(null)} data-testid="ws-sub-cancel">
                  Cancelar
                </Button>
              </div>
            </Card>
          ) : (
            <div>
              <Button variant="secondary" icon="plus" onClick={() => setRascunho(vazio(conexoes[0]?.id ?? ''))} data-testid="ws-new-sub">
                Nova assinatura
              </Button>
            </div>
          )}

          {assinaturas.length === 0 ? (
            <EmptyState icon="list" title="Nenhuma assinatura" body="Crie uma para escolher o que ouvir e para onde mandar o que chegar." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }} data-testid="ws-subscriptions">
              {assinaturas.map((s) => (
                <Card key={s.id} padding="12px 14px" style={{ display: 'grid', gap: 6 }} data-testid="ws-subscription">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-heading)' }}>{s.name}</span>
                    <span style={{ fontSize: 12.5, color: s.active ? 'var(--intent-brand)' : 'var(--text-faint)' }} data-testid="ws-sub-state">
                      {s.active ? 'Ativa' : 'Pausada'}
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>→ {DESTINATION_LABEL[s.destination.kind]}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {s.channel ? `Canal ${s.channel} · ` : ''}
                    {s.messageCount} mensagem(ns) · última {quando(s.lastMessageAt)}
                  </p>
                  {/* A relação com a automação gerenciada fica à vista: ela existe por
                      causa desta assinatura, e some com ela. */}
                  {s.managedAutomationId ? (
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }} data-testid="ws-sub-managed">
                      Roda por um gatilho criado por esta assinatura. Removê-la arquiva o gatilho.
                    </p>
                  ) : null}
                  {teste?.id === s.id ? (
                    <p
                      style={{ margin: 0, fontSize: 12.5, color: teste.ok ? 'var(--intent-brand)' : 'var(--coral-600, #d92d20)' }}
                      data-testid="ws-sub-test-result"
                    >
                      {teste.message}
                    </p>
                  ) : null}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button size="sm" variant="ghost" icon="pencil" onClick={() => setRascunho(deAssinatura(s))} data-testid="ws-sub-edit">
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" icon="plug-zap" disabled={ocupado === s.id} onClick={() => void provar(s)} data-testid="ws-sub-test">
                      {ocupado === s.id ? 'Testando…' : 'Testar assinatura'}
                    </Button>
                    <Button size="sm" variant="ghost" icon={s.active ? 'pause' : 'play'} disabled={ocupado === s.id} onClick={() => void alternar(s)} data-testid="ws-sub-toggle">
                      {s.active ? 'Pausar' : 'Ativar'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="trash-2"
                      onClick={() => void deleteSubscription(s.id).then(carregar)}
                      data-testid="ws-sub-delete"
                    >
                      Remover
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </WsPage>
  )
}
