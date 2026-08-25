import { useEffect, useState } from 'react'
import {
  createSubscription,
  deleteSubscription,
  DESTINATION_LABEL,
  listConnections,
  listSubscriptions,
  updateSubscription,
} from '../../lib/websocketApp'
import type { WsConnection, WsDestinationKind, WsSubscription } from '../../lib/websocketApp'
import { Button, Card, EmptyState, Field, Input, Textarea } from '../../ui'
import { SemConexao, WsPage, quando } from './shared'

/**
 * O que ouvir, e o que fazer com isso.
 *
 * O destino é a decisão que custa: guardar é de graça, memória ocupa espaço, rotina e
 * agente custam tempo, e agente custa token. Por isso "Só guardar" é o que vem marcado —
 * quem quiser mais escolhe, sabendo.
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

const DESTINOS: WsDestinationKind[] = ['history', 'memory', 'routine', 'agent', 'sector']

const vazia = (installationId: string) => ({
  installationId,
  name: '',
  channel: '',
  subscribeMessage: '',
  unsubscribeMessage: '',
  destination: { kind: 'history' as WsDestinationKind },
})

export function WebSocketSubscriptions() {
  const [conexoes, setConexoes] = useState<WsConnection[]>([])
  const [assinaturas, setAssinaturas] = useState<WsSubscription[]>([])
  const [nova, setNova] = useState<ReturnType<typeof vazia> | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  const carregar = () =>
    Promise.all([listConnections(), listSubscriptions()])
      .then(([c, s]) => {
        setConexoes(c)
        setAssinaturas(s)
      })
      .catch(() => setErro('Não foi possível carregar.'))
      .finally(() => setCarregando(false))

  useEffect(() => {
    void carregar()
  }, [])

  const salvar = async () => {
    if (!nova) return
    setErro(null)
    try {
      await createSubscription({ ...nova, name: nova.name || 'Assinatura' })
      setNova(null)
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
    }
  }

  const alternar = async (s: WsSubscription) => {
    await updateSubscription(s.id, { active: !s.active }).catch(() => undefined)
    await carregar()
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
          {nova ? (
            <Card padding="16px" style={{ display: 'grid', gap: 10 }} data-testid="ws-new-subscription">
              <Field label="Conexão">
                <select style={selectStyle} value={nova.installationId} onChange={(e) => setNova({ ...nova, installationId: e.target.value })} data-testid="ws-sub-connection">
                  {conexoes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Nome">
                <Input value={nova.name} onChange={(e) => setNova({ ...nova, name: e.target.value })} placeholder="Ex.: Pedidos novos" data-testid="ws-sub-name" />
              </Field>
              <Field label="Canal" hint="Vazio aceita qualquer canal.">
                <Input value={nova.channel} onChange={(e) => setNova({ ...nova, channel: e.target.value })} data-testid="ws-sub-channel" />
              </Field>
              <Field label="Mensagem de inscrição" hint="JSON mandado ao entrar. Vazio se o serviço já envia tudo.">
                <Textarea rows={2} value={nova.subscribeMessage} onChange={(e) => setNova({ ...nova, subscribeMessage: e.target.value })} data-testid="ws-sub-subscribe" />
              </Field>
              <Field label="O que fazer com o que chegar">
                <select
                  style={selectStyle}
                  value={nova.destination.kind}
                  onChange={(e) => setNova({ ...nova, destination: { kind: e.target.value as WsDestinationKind } })}
                  data-testid="ws-sub-destination"
                >
                  {DESTINOS.map((d) => (
                    <option key={d} value={d}>
                      {DESTINATION_LABEL[d]}
                    </option>
                  ))}
                </select>
              </Field>
              {nova.destination.kind !== 'history' ? (
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }}>
                  {nova.destination.kind === 'memory'
                    ? 'Guardar na memória não passa por modelo nenhum: nenhum token é gasto.'
                    : 'O agente responsável decide o que pode ser feito — um evento não ganha permissão por ter vindo de fora.'}
                </p>
              ) : null}
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" onClick={() => void salvar()} data-testid="ws-sub-save">
                  Criar assinatura
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNova(null)}>
                  Cancelar
                </Button>
              </div>
            </Card>
          ) : (
            <div>
              <Button variant="secondary" icon="plus" onClick={() => setNova(vazia(conexoes[0]?.id ?? ''))} data-testid="ws-new-sub">
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
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button size="sm" variant="ghost" icon={s.active ? 'pause' : 'play'} onClick={() => void alternar(s)} data-testid="ws-sub-toggle">
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
