import { useEffect, useState } from 'react'
import { listConnections, pauseWsStream, resumeWsStream, startConnection, stopWsStream } from '../../lib/websocketApp'
import type { WsConnection } from '../../lib/websocketApp'
import { Button, Card } from '../../ui'
import { SemConexao, WsPage, quando } from './shared'
import { ConnectionForm } from './ConnectionForm'

/**
 * O estado de cada conexão, em uma tela.
 *
 * O que se pergunta sobre uma integração que fica aberta é sempre o mesmo: está de pé?
 * chegou alguma coisa? o que quebrou? As três primeiras linhas de cada cartão são isso;
 * a configuração fica atrás de um botão, porque depois de pronta ninguém mexe nela.
 */
const ESTADO: Record<string, string> = {
  connected: 'Recebendo',
  connecting: 'Conectando',
  reconnecting: 'Reconectando',
  paused: 'Pausado',
  error: 'Com erro',
  disconnected: 'Desligado',
}

export function WebSocketOverview() {
  const [conexoes, setConexoes] = useState<WsConnection[]>([])
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = () =>
    listConnections()
      .then(setConexoes)
      .catch(() => setErro('Não foi possível carregar as conexões.'))
      .finally(() => setCarregando(false))

  useEffect(() => {
    void carregar()
  }, [])

  const agir = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    setErro(null)
    try {
      await fn()
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <WsPage current="/apps/websocket/overview" title="WebSocket · Visão geral" subtitle="Conexões, estado e o que chegou.">
      {erro ? <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--coral-600, #d92d20)' }}>{erro}</p> : null}
      {carregando ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando…</p>
      ) : conexoes.length === 0 ? (
        <SemConexao />
      ) : (
        <div style={{ display: 'grid', gap: 12 }} data-testid="ws-connections">
          {conexoes.map((c) => (
            <Card key={c.id} padding="16px" style={{ display: 'grid', gap: 10 }} data-testid="ws-connection-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 15.5, fontWeight: 800, color: 'var(--text-heading)' }}>{c.name}</span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: c.stream?.state === 'connected' ? 'var(--intent-brand)' : 'var(--text-muted)',
                  }}
                  data-testid="ws-state"
                >
                  {ESTADO[c.stream?.state ?? 'disconnected'] ?? 'Desligado'}
                </span>
              </div>

              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="ws-endpoint">
                {c.config?.endpoint || 'sem endereço configurado'}
              </p>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="ws-counts">
                {c.messages.total} mensagem(ns) · {c.messages.accepted} aproveitada(s) · última {quando(c.messages.lastAt)}
              </p>
              {c.stream?.lastError ? (
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--coral-600, #d92d20)' }} data-testid="ws-error">
                  {c.stream.lastError.message}
                </p>
              ) : null}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!c.stream ? (
                  <Button size="sm" icon="play" disabled={busy === c.id || !c.config} onClick={() => void agir(c.id, () => startConnection(c.id))} data-testid="ws-start">
                    Ligar
                  </Button>
                ) : c.stream.state === 'paused' ? (
                  <Button size="sm" icon="play" disabled={busy === c.id} onClick={() => void agir(c.id, () => resumeWsStream(c.stream!.id))} data-testid="ws-resume">
                    Retomar
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" icon="pause" disabled={busy === c.id} onClick={() => void agir(c.id, () => pauseWsStream(c.stream!.id))} data-testid="ws-pause">
                    Pausar
                  </Button>
                )}
                {c.stream ? (
                  <Button size="sm" variant="ghost" icon="power" disabled={busy === c.id} onClick={() => void agir(c.id, () => stopWsStream(c.stream!.id))} data-testid="ws-stop">
                    Desligar
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" icon="settings" onClick={() => setEditando(editando === c.id ? null : c.id)} data-testid="ws-configure">
                  {editando === c.id ? 'Fechar' : 'Configurar'}
                </Button>
              </div>

              {editando === c.id ? (
                <ConnectionForm
                  connection={c}
                  onSaved={() => {
                    setEditando(null)
                    void carregar()
                  }}
                />
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </WsPage>
  )
}
