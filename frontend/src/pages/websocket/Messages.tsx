import { useEffect, useState } from 'react'
import { listConnections, listMessages, STATUS_LABEL } from '../../lib/websocketApp'
import type { WsConnection, WsMessage, WsMessageStatus } from '../../lib/websocketApp'
import { Card, EmptyState, Button } from '../../ui'
import { StatusTag, WsPage, quando } from './shared'

/**
 * O que chegou — inclusive o que foi recusado, e por quê.
 *
 * Mostrar só o que passou esconderia metade do que se precisa saber ao configurar uma
 * integração: uma tela vazia porque o filtro está errado é indistinguível de uma tela
 * vazia porque o serviço não mandou nada. Aqui a diferença aparece.
 */
const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-card)',
  color: 'var(--text-body)',
  fontSize: 13,
}

const POR_PAGINA = 25

export function WebSocketMessages() {
  const [conexoes, setConexoes] = useState<WsConnection[]>([])
  const [itens, setItens] = useState<WsMessage[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [conexao, setConexao] = useState('')
  const [status, setStatus] = useState('')
  const [canal, setCanal] = useState('')
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    listConnections().then(setConexoes).catch(() => undefined)
  }, [])

  useEffect(() => {
    setCarregando(true)
    listMessages({ installationId: conexao, status, channel: canal, skip: pagina * POR_PAGINA, limit: POR_PAGINA })
      .then((r) => {
        setItens(r.items)
        setTotal(r.total)
      })
      .catch(() => undefined)
      .finally(() => setCarregando(false))
  }, [conexao, status, canal, pagina])

  const paginas = Math.ceil(total / POR_PAGINA)

  return (
    <WsPage current="/apps/websocket/messages" title="WebSocket · Mensagens" subtitle="O que chegou, e o que foi descartado.">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select
          style={selectStyle}
          value={conexao}
          onChange={(e) => {
            setConexao(e.target.value)
            setPagina(0)
          }}
          data-testid="ws-filter-connection"
        >
          <option value="">Todas as conexões</option>
          {conexoes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          style={selectStyle}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPagina(0)
          }}
          data-testid="ws-filter-status"
        >
          <option value="">Qualquer situação</option>
          {(Object.keys(STATUS_LABEL) as WsMessageStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          style={selectStyle}
          value={canal}
          onChange={(e) => {
            setCanal(e.target.value)
            setPagina(0)
          }}
          placeholder="Canal"
          data-testid="ws-filter-channel"
        />
      </div>

      {carregando ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando…</p>
      ) : itens.length === 0 ? (
        <EmptyState icon="inbox" title="Nada por aqui" body="Nenhuma mensagem bate com estes filtros." />
      ) : (
        <div style={{ display: 'grid', gap: 8 }} data-testid="ws-messages">
          {itens.map((m) => (
            <Card key={m.id} padding="10px 12px" style={{ display: 'grid', gap: 4 }} data-testid="ws-message">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusTag status={m.status} label={STATUS_LABEL[m.status]} />
                {m.channel ? <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{m.channel}</span> : null}
                <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>{quando(m.receivedAt)}</span>
              </div>
              {/* Um trecho, e não a mensagem: ela vem de fora e ninguém a revisou. */}
              <pre
                style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-muted)' }}
                data-testid="ws-message-preview"
              >
                {m.preview || '(vazio)'}
              </pre>
            </Card>
          ))}
        </div>
      )}

      {paginas > 1 ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }} data-testid="ws-pagination">
          <Button size="sm" variant="ghost" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} data-testid="ws-prev">
            Anterior
          </Button>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {pagina + 1} de {paginas}
          </span>
          <Button size="sm" variant="ghost" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)} data-testid="ws-next">
            Próxima
          </Button>
        </div>
      ) : null}
    </WsPage>
  )
}
