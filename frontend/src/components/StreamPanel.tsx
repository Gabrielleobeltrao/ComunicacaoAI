import { useState } from 'react'
import { deleteStream, pauseStream, reconnectStream, resumeStream, saveStream, STREAM_STATE_COLOR, STREAM_STATE_LABEL } from '../lib/streams'
import type { MarketStream } from '../lib/streams'
import { Button, Card, Field, Icon, Input } from '../ui'

/**
 * Antes de existir stream, o que existe é um CONVITE.
 *
 * A conexão pode receber tempo real e não recebe até alguém dizer quais ativos. Sem
 * este passo, `ensureStream` existia no backend e nenhuma tela chamava — o recurso
 * estava pronto e inalcançável.
 */
export function StreamCTA({ installationId, onCreated }: { installationId: string; onCreated: (s: MarketStream) => void }) {
  const [aberto, setAberto] = useState(false)
  const [simbolos, setSimbolos] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const ligar = async () => {
    const lista = simbolos
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean)
    if (!lista.length) {
      setErro('Informe pelo menos um ativo.')
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      onCreated(await saveStream(installationId, lista))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ligar o tempo real.')
    } finally {
      setSalvando(false)
    }
  }

  if (!aberto) {
    return (
      <Button size="sm" variant="secondary" icon="activity" onClick={() => setAberto(true)} data-testid="stream-cta">
        Ativar tempo real
      </Button>
    )
  }

  return (
    <Card padding="12px 14px" style={{ display: 'grid', gap: 8 }} data-testid="stream-setup">
      <Field label="Ativos" hint="Separados por vírgula. Só os que você escolher são recebidos.">
        <Input value={simbolos} onChange={(e) => setSimbolos(e.target.value)} placeholder="AAPL, MSFT" data-testid="stream-symbols" />
      </Field>
      {erro ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--coral-600, #d92d20)' }} data-testid="stream-setup-error">{erro}</p> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" onClick={() => void ligar()} disabled={salvando} data-testid="stream-start">
          {salvando ? 'Ligando…' : 'Ligar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAberto(false)} disabled={salvando}>
          Cancelar
        </Button>
      </div>
    </Card>
  )
}

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

export function StreamPanel({ stream, onChange, onRemoved }: { stream: MarketStream; onChange: (s: MarketStream) => void; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [simbolos, setSimbolos] = useState(stream.symbols.join(', '))

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
        <div style={{ display: 'grid', gap: 8 }} data-testid="stream-details">
          {/* Trocar os ativos é a operação mais comum depois de ligar, e é a mesma rota
              do "ligar": pedir de novo com outra lista atualiza, não cria um segundo. */}
          <Field label="Ativos">
            <Input value={simbolos} onChange={(e) => setSimbolos(e.target.value)} data-testid="stream-edit-symbols" />
          </Field>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void agir(() =>
                  saveStream(
                    stream.installationId,
                    simbolos
                      .split(',')
                      .map((t) => t.trim().toUpperCase())
                      .filter(Boolean),
                  ),
                )
              }
              data-testid="stream-update"
            >
              Atualizar ativos
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="trash-2"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void deleteStream(stream.id)
                  .then(onRemoved)
                  .catch((e) => setErro(e instanceof Error ? e.message : 'Não foi possível desligar.'))
                  .finally(() => setBusy(false))
              }}
              data-testid="stream-delete"
            >
              Desligar tempo real
            </Button>
          </div>
          <dl style={{ margin: 0, display: 'grid', gap: 3, fontSize: 12.5, color: 'var(--text-muted)' }}>
            <div>Ambiente: {stream.environment === 'paper' ? 'simulação' : stream.environment}</div>
            <div>Eventos recebidos: {stream.eventCount}</div>
          </dl>
        </div>
      ) : null}
    </div>
  )
}
