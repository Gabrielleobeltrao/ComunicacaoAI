import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { API_URL } from '../lib/api'
import { duration, num } from '../lib/sectorExecutions'
import { Button, Card, EmptyState, MetricStat, Tag } from '../ui'

// A channel App's "Visão geral": what is connected, what came in, and where to go
// next. Every number is measured by the backend from real conversations — a channel
// with no history shows "—", never a zero that would read as "it ran and produced
// nothing".

interface Overview {
  appKey: 'web_chat' | 'whatsapp'
  channels: { id: string; name: string; agentId: string | null; sectorId: string | null; ready: boolean }[]
  conversations: number
  conversations7d: number
  messages7d: number
  handoffs: number
  avgResponseMs: number | null
  lastMessageAt: string | null
}

const COPY = {
  web_chat: {
    title: 'Chat Web · Visão geral',
    channelsLabel: 'Widgets',
    manageLabel: 'Gerenciar widgets',
    managePath: '/apps/web-chat/widgets',
    conversationsPath: '/apps/web-chat/conversations',
    emptyTitle: 'Nenhum widget ainda',
    emptyBody: 'Crie um widget, escolha quem atende e cole o script no seu site.',
  },
  whatsapp: {
    title: 'WhatsApp · Visão geral',
    channelsLabel: 'Números',
    manageLabel: 'Gerenciar números',
    managePath: '/apps/whatsapp/channels',
    conversationsPath: '/apps/whatsapp/conversations',
    emptyTitle: 'Nenhum número conectado',
    emptyBody: 'Conecte um número e o provedor para começar a receber mensagens.',
  },
} as const

export function ChannelOverview({ appKey }: { appKey: 'web_chat' | 'whatsapp' }) {
  const [data, setData] = useState<Overview | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const copy = COPY[appKey]

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`${API_URL}/api/apps/${appKey}/overview`, { credentials: 'include' })
      if (!res.ok) throw new Error('falhou')
      setData((await res.json()) as Overview)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [appKey])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <AppLayout current={`/apps/${appKey.replace(/_/g, '-')}/overview`} title={copy.title}>
      <div style={{ display: 'grid', gap: 16 }} data-testid="channel-overview">
        {failed ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>
            Não foi possível carregar.{' '}
            <button
              type="button"
              onClick={() => void load()}
              data-testid="overview-retry"
              style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--intent-brand)', textDecoration: 'underline', cursor: 'pointer' }}
            >
              Tentar de novo
            </button>
          </p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }} data-testid="overview-metrics">
              <Card padding="16px" title={`${copy.channelsLabel} que podem receber`}>
                <MetricStat icon="share-2" label={copy.channelsLabel} value={num(data?.channels.filter((c) => c.ready).length)} />
              </Card>
              <Card padding="16px" title="Conversas com pelo menos uma mensagem">
                <MetricStat icon="messages-square" label="Conversas" value={num(data?.conversations)} />
              </Card>
              <Card padding="16px" title="Conversas que receberam mensagem nos últimos 7 dias">
                <MetricStat icon="activity" label="Conversas 7d" value={num(data?.conversations7d)} />
              </Card>
              <Card padding="16px" title="Mensagens trocadas nos últimos 7 dias">
                <MetricStat icon="message-circle" label="Mensagens 7d" value={num(data?.messages7d)} />
              </Card>
              <Card padding="16px" title="Tempo médio entre a mensagem do visitante e a resposta do agente (7 dias)">
                <MetricStat icon="timer" label="Resposta média" value={duration(data?.avgResponseMs)} />
              </Card>
              <Card padding="16px" title="Conversas aguardando uma pessoa">
                <MetricStat icon="user-check" label="Aguardando humano" value={num(data?.handoffs)} />
              </Card>
            </div>

            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }} data-testid="overview-last">
              {data?.lastMessageAt
                ? `Última mensagem em ${new Date(data.lastMessageAt).toLocaleString('pt-BR')}.`
                : 'Nenhuma mensagem recebida ainda.'}
            </p>

            <section style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>
                  {copy.channelsLabel}
                </h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Link to={copy.managePath}>
                    <Button size="sm" variant="secondary" data-testid="overview-manage">
                      {copy.manageLabel}
                    </Button>
                  </Link>
                  <Link to={copy.conversationsPath}>
                    <Button size="sm" variant="ghost" data-testid="overview-conversations">
                      Ver conversas
                    </Button>
                  </Link>
                </div>
              </div>

              {loading && !data ? (
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>Carregando…</p>
              ) : (data?.channels.length ?? 0) === 0 ? (
                <EmptyState
                  icon="share-2"
                  title={copy.emptyTitle}
                  body={copy.emptyBody}
                  action={
                    <Link to={copy.managePath}>
                      <Button size="sm">{copy.manageLabel}</Button>
                    </Link>
                  }
                />
              ) : (
                <div style={{ display: 'grid', gap: 8 }} data-testid="overview-channels">
                  {data?.channels.map((c) => (
                    <div
                      key={c.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 10 }}
                    >
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-heading)' }}>{c.name}</span>
                      <Tag>{c.ready ? 'Pode receber' : 'Incompleto'}</Tag>
                      {!c.agentId && !c.sectorId ? (
                        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Sem agente ou setor atendendo</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AppLayout>
  )
}
