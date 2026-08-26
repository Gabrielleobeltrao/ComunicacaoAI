import { useEffect, useState } from 'react'
import { listConnections, listLogs } from '../../lib/websocketApp'
import type { WsConnection, WsLog } from '../../lib/websocketApp'
import { Card, EmptyState } from '../../ui'
import {quando} from './shared'

/**
 * O diário da integração.
 *
 * Cada linha é uma frase escrita por nós sobre a configuração e o estado: conectou,
 * caiu, descartou, disparou. Nunca o cabeçalho, nunca a query, nunca a mensagem de
 * autenticação, nunca o conteúdo do que chegou — o log é lido por quem administra e às
 * vezes por quem dá suporte, e é o lugar mais fácil de vazar o que o resto protege.
 */
const COR: Record<string, string> = {
  connected: 'var(--intent-brand)',
  subscribed: 'var(--intent-brand)',
  triggered: 'var(--intent-brand)',
  reconnecting: 'var(--mango-600)',
  dropped: 'var(--text-faint)',
  disconnected: 'var(--text-faint)',
  invalid: 'var(--coral-600, #d92d20)',
  error: 'var(--coral-600, #d92d20)',
}

const ROTULO: Record<string, string> = {
  connected: 'Conectou',
  disconnected: 'Desconectou',
  reconnecting: 'Reconectando',
  subscribed: 'Assinou',
  dropped: 'Descartou',
  invalid: 'Recusou',
  triggered: 'Disparou',
  error: 'Erro',
}

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-card)',
  color: 'var(--text-body)',
  fontSize: 13,
}

export function WebSocketLogs() {
  const [conexoes, setConexoes] = useState<WsConnection[]>([])
  const [logs, setLogs] = useState<WsLog[]>([])
  const [conexao, setConexao] = useState('')
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    listConnections().then(setConexoes).catch(() => undefined)
  }, [])

  useEffect(() => {
    setCarregando(true)
    listLogs(conexao || undefined)
      .then(setLogs)
      .catch(() => undefined)
      .finally(() => setCarregando(false))
  }, [conexao])

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <select style={selectStyle} value={conexao} onChange={(e) => setConexao(e.target.value)} data-testid="ws-log-connection">
          <option value="">Todas as conexões</option>
          {conexoes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {carregando ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando…</p>
      ) : logs.length === 0 ? (
        <EmptyState icon="scroll-text" title="Nenhum registro" body="Os eventos de conexão aparecem aqui assim que algo acontecer." />
      ) : (
        <div style={{ display: 'grid', gap: 6 }} data-testid="ws-logs">
          {logs.map((l) => (
            <Card key={l.id} padding="10px 12px" style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }} data-testid="ws-log">
              <span style={{ fontSize: 12, fontWeight: 700, color: COR[l.kind] ?? 'var(--text-muted)', minWidth: 90 }}>{ROTULO[l.kind] ?? l.kind}</span>
              <span style={{ fontSize: 13, color: 'var(--text-body)', flex: 1, minWidth: 200 }}>{l.message}</span>
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{quando(l.createdAt)}</span>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
