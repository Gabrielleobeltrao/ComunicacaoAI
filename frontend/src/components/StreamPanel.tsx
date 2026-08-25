import { useState } from 'react'
import { pauseStream, reconnectStream, resumeStream, STREAM_STATE_COLOR, STREAM_STATE_LABEL } from '../lib/streams'
import type { MarketStream } from '../lib/streams'
import { Button, Icon } from '../ui'

/**
 * O stream de uma conexão, em uma tira.
 *
 * O que uma conexão de longa duração precisa responder é sempre a mesma coisa: está
 * de pé? falou comigo há pouco? o que quebrou? As três primeiras linhas são isso. O
 * resto — símbolos, contagem, ambiente — fica em "Detalhes", porque na maior parte
 * dos dias ninguém precisa.
 */

const quando = (iso: string | null): string => {
  if (!iso) return 'nunca'
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutos < 1) return 'agora há pouco'
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.round(minutos / 60)
  if (horas < 24) return `há ${horas} h`
  return new Date(iso).toLocaleDateString('pt-BR')
}

export function StreamPanel({ stream, onChange }: { stream: MarketStream; onChange: (s: MarketStream) => void }) {
  const [busy, setBusy] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const agir = async (acao: () => Promise<MarketStream>) => {
    setBusy(true)
    setErro(null)
    try {
      onChange(await acao())
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{ display: 'grid', gap: 6, padding: '10px 12px', borderRadius: 10, background: 'var(--surface-sunken, rgba(0,0,0,0.03))' }}
      data-testid="stream-panel"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: 999, background: STREAM_STATE_COLOR[stream.state], flexShrink: 0 }}
        />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)' }} data-testid="stream-state">
          {STREAM_STATE_LABEL[stream.state]}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {/* Último EVENTO, não último "ok": um stream conectado e mudo é o pior caso,
              e é exatamente ele que esta linha denuncia. */}
          último dado {quando(stream.lastEventAt)} · conectou {quando(stream.lastConnectedAt)}
        </span>
      </div>

      {stream.lastError ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--coral-600, #d92d20)' }} data-testid="stream-error">
          {stream.lastError.message}
        </p>
      ) : null}
      {erro ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--coral-600, #d92d20)' }}>{erro}</p> : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {stream.state === 'paused' ? (
          <Button size="sm" variant="secondary" icon="play" disabled={busy} onClick={() => void agir(() => resumeStream(stream.id))} data-testid="stream-resume">
            Retomar
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon="pause" disabled={busy} onClick={() => void agir(() => pauseStream(stream.id))} data-testid="stream-pause">
            Pausar
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon="refresh-cw"
          disabled={busy || stream.state === 'paused'}
          onClick={() => void agir(() => reconnectStream(stream.id))}
          data-testid="stream-reconnect"
        >
          Reconectar
        </Button>
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
          data-testid="stream-details-toggle"
        >
          <Icon name={aberto ? 'chevron-up' : 'chevron-down'} size={13} />
          Detalhes
        </button>
      </div>

      {aberto ? (
        <dl style={{ margin: 0, display: 'grid', gap: 3, fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="stream-details">
          <div>Ambiente: {stream.environment === 'paper' ? 'simulação' : stream.environment}</div>
          <div>Símbolos: {stream.symbols.length ? stream.symbols.join(', ') : 'nenhum'}</div>
          <div>Eventos recebidos: {stream.eventCount}</div>
        </dl>
      ) : null}
    </div>
  )
}
