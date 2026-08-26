import { useEffect, useState } from 'react'
import { listConnections, pauseWsStream, resumeWsStream, startConnection, stopWsStream, testConnection } from '../../lib/websocketApp'
import type { WsConnection } from '../../lib/websocketApp'
import { Button, Card } from '../../ui'
import {SemConexao, duracao, quando} from './shared'
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
  const [testando, setTestando] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Record<string, { ok: boolean; message: string }>>({})

  /**
   * O resultado é o VERDADEIRO: abriu, o serviço recusou, o prazo estourou ou a
   * configuração é inválida. Antes daqui o botão dizia "configuração lida com sucesso"
   * sem ter aberto nada — a resposta certa para a pergunta errada.
   */
  async function testar(id: string) {
    setTestando(id)
    setResultado((atual) => ({ ...atual, [id]: undefined as never }))
    try {
      const r = await testConnection(id)
      setResultado((atual) => ({ ...atual, [id]: r }))
    } catch (e) {
      setResultado((atual) => ({ ...atual, [id]: { ok: false, message: (e as Error).message } }))
    } finally {
      setTestando(null)
    }
  }
  const [busy, setBusy] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = () =>
    listConnections()
      .then(setConexoes)
      .catch(() => setErro('Não foi possível carregar as conexões.'))
      .finally(() => setCarregando(false))

  /**
   * O estado se atualiza sozinho.
   *
   * Uma tela parada sobre conexão de tempo real mente: ela dizia "Recebendo" enquanto o
   * stream já estava reconectando, e a contagem de mensagens ficava congelada no que
   * havia quando a página abriu. Cinco segundos é o ritmo de quem está olhando.
   *
   * Três cuidados que a diferença entre um polling útil e um incômodo:
   *
   * ABA OCULTA NÃO CONSULTA. Uma aba esquecida em segundo plano bateria no servidor a
   * cada cinco segundos por horas — e o que ela mostra ninguém está vendo.
   *
   * SEM CHAMADAS SOBREPOSTAS. Uma resposta lenta faria a próxima sair antes de a
   * anterior voltar, e a mais antiga poderia chegar por último e sobrescrever o estado
   * novo com o velho.
   *
   * O QUE A PESSOA ESTÁ FAZENDO É PRESERVADO. Só a lista de conexões é trocada:
   * formulário aberto, resultado do teste e cartão em edição são estado desta tela e
   * não vêm do servidor, então não há como uma atualização apagá-los.
   */
  useEffect(() => {
    let vivo = true
    let emVoo = false
    void carregar()

    const tick = async () => {
      if (!vivo || emVoo || document.visibilityState === 'hidden') return
      emVoo = true
      try {
        const novas = await listConnections()
        if (vivo) setConexoes(novas)
      } catch {
        // Uma falha de rede não vira erro na tela: a próxima volta em cinco segundos, e
        // um aviso vermelho piscando a cada falha seria pior do que o silêncio.
      } finally {
        emVoo = false
      }
    }

    const timer = setInterval(() => void tick(), 5_000)
    // Voltar para a aba atualiza na hora, em vez de esperar o próximo intervalo.
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      vivo = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
    // `carregar` é estável por construção (só usa setters); reagendar a cada render
    // criaria um intervalo novo por render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <>
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
                {c.config?.endpoint || (c.needsFix ? 'endereço não exibido' : 'sem endereço configurado')}
              </p>
              {/* Configuração antiga com a credencial no endereço: ela não é mostrada, e
                  a tela diz o que fazer em vez de exibir a chave de novo. */}
              {c.needsFix ? (
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mango-600, #b54708)' }} data-testid="ws-needs-fix">
                  Esta conexão guarda a credencial dentro do endereço. Abra Configurar, tire o parâmetro do endereço e informe o valor no campo de
                  credencial — a conexão continua funcionando igual.
                </p>
              ) : null}
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="ws-counts">
                {c.messages.total} mensagem(ns) · {c.messages.accepted} aproveitada(s) · última {quando(c.messages.lastAt)}
                {c.stream?.state === 'connected' && c.stream.lastConnectedAt ? ` · no ar ${duracao(c.stream.lastConnectedAt)}` : ''}
              </p>
              {/* O resultado do teste, anunciado: quem usa leitor de tela precisa saber
                  que a resposta chegou, e ela chega depois de segundos de espera. */}
              {resultado[c.id] ? (
                <p
                  role="status"
                  style={{ margin: 0, fontSize: 12.5, color: resultado[c.id]!.ok ? 'var(--mint-600, #12805c)' : 'var(--coral-600, #d92d20)' }}
                  data-testid="ws-test-result"
                >
                  {resultado[c.id]!.message}
                </p>
              ) : null}
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
                {/* Testar fica ao lado de Ligar porque é a pergunta que vem ANTES dele:
                    "este endereço e esta credencial funcionam?". Ele abre a conexão de
                    verdade, com a configuração de verdade, e fecha. */}
                <Button
                  size="sm"
                  variant="secondary"
                  icon="plug"
                  disabled={testando === c.id || !c.config}
                  onClick={() => void testar(c.id)}
                  data-testid="ws-test-connection"
                >
                  {testando === c.id ? 'Testando…' : 'Testar conexão'}
                </Button>
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
    </>
  )
}
