import { useEffect, useState } from 'react'
import { Button, Card, EmptyState, Field, Input } from '../../ui'
import { listConnections, listLive, sendFrame } from '../../lib/websocketApp'
import type { WsConnection, WsLiveValue } from '../../lib/websocketApp'
import {GRADE, SemConexao, duracao} from './shared'

/**
 * O DADO AO VIVO: o último valor de cada chave.
 *
 * É exatamente o que os agentes de código leem por `liveData.*` — a tela mostra o que o
 * cálculo vai ver, e não uma segunda versão da verdade. É por isso que ela existe: sem
 * ela, "meu agente não acha o preço" não tem onde ser conferido.
 *
 * E o envio de um quadro avulso, que é a ferramenta de quem está descobrindo o formato
 * de um serviço novo — sem ela, a única forma era salvar, reconectar e olhar.
 */
export function WebSocketLive() {
  const [conexoes, setConexoes] = useState<WsConnection[] | null>(null)
  const [escolhida, setEscolhida] = useState<string>('')
  const [prefixo, setPrefixo] = useState('')
  const [itens, setItens] = useState<WsLiveValue[]>([])
  const [quadro, setQuadro] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    listConnections()
      .then((cs) => {
        setConexoes(cs)
        setEscolhida((atual) => atual || cs[0]?.id || '')
      })
      .catch((e: Error) => {
        setConexoes([])
        setErro(e.message)
      })
  }, [])

  useEffect(() => {
    if (!escolhida) return
    let vivo = true
    const carregar = () =>
      listLive(escolhida, prefixo)
        .then((r) => vivo && setItens(r.items))
        .catch(() => vivo && setItens([]))
    void carregar()
    // Sondagem curta: o dado muda sozinho, e uma tela parada sobre dado de tempo real
    // é uma tela que mente. Cinco segundos é ritmo de quem está olhando, não de quem
    // está calculando — o cálculo lê direto pelo `liveData.*`.
    const t = setInterval(carregar, 5_000)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [escolhida, prefixo])

  async function enviar() {
    setAviso(null)
    setErro(null)
    try {
      const r = await sendFrame(escolhida, quadro)
      setAviso(r.message)
      if (r.sent) setQuadro('')
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  if (conexoes !== null && conexoes.length === 0) {
    return (
      <>
        <SemConexao />
      </>
    )
  }

  return (
    <>
      <div style={{ display: 'grid', gap: 12 }} data-testid="ws-live">
        <Card padding="16px" style={{ display: 'grid', gap: 10 }}>
          <div style={GRADE}>
            <Field label="Conexão">
              <select
                style={{ width: '100%', minHeight: 40, borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', padding: '0 10px', fontSize: 13.5 }}
                value={escolhida}
                onChange={(e) => setEscolhida(e.target.value)}
                data-testid="ws-live-connection"
              >
                {(conexoes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Filtrar por início da chave">
              <Input value={prefixo} placeholder="AAP" onChange={(e) => setPrefixo(e.target.value)} data-testid="ws-live-prefix" />
            </Field>
          </div>
        </Card>

        {itens.length === 0 ? (
          <EmptyState
            icon="activity"
            title="Nada ao vivo ainda"
            body="O dado ao vivo aparece quando a conexão estiver de pé e a configuração tiver um mapeamento com a chave — normalmente symbol."
          />
        ) : (
          <Card padding="0" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} data-testid="ws-live-table">
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 12 }}>
                  <th style={{ padding: '10px 12px' }}>Chave</th>
                  <th style={{ padding: '10px 12px' }}>Valor</th>
                  <th style={{ padding: '10px 12px' }}>Atualizações</th>
                  <th style={{ padding: '10px 12px' }}>Desde</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.key} style={{ borderTop: '1px solid var(--border-subtle)' }} data-testid={`ws-live-row-${i.key}`}>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{i.key}</td>
                    <td style={{ padding: '10px 12px', overflowWrap: 'anywhere', maxWidth: 320 }}>{JSON.stringify(i.value)}</td>
                    <td style={{ padding: '10px 12px' }}>{i.updates}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{duracao(i.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <Card padding="16px" style={{ display: 'grid', gap: 10 }}>
          <Field label="Enviar uma mensagem" hint="Sai pela conexão que está aberta. O conteúdo não é registrado em log.">
            <Input value={quadro} placeholder='{"action":"subscribe","params":{"symbols":"AAPL"}}' onChange={(e) => setQuadro(e.target.value)} data-testid="ws-send-frame" />
          </Field>
          {aviso ? (
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="ws-send-result">
              {aviso}
            </p>
          ) : null}
          {erro ? (
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--coral-600, #d92d20)' }} role="alert" data-testid="ws-send-error">
              {erro}
            </p>
          ) : null}
          <div>
            <Button size="sm" onClick={() => void enviar()} disabled={!quadro.trim() || !escolhida} data-testid="ws-send">
              Enviar
            </Button>
          </div>
        </Card>
      </div>
    </>
  )
}
