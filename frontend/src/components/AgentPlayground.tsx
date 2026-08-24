import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import { novaTrilha, useExecutionTrace } from '../lib/executionTrace'
import { ExecutionTrace } from './ExecutionTrace'
import type { AgentSummary, ToolCall } from '../lib/types'
import { MessageContent } from './MessageContent'
import { ToolCalls } from './ToolCalls'

// A conversa de teste de um agente, que agora sobrevive à troca de aba.
//
// Duas coisas diferentes se chamavam "nada é salvo". A MEMÓRIA DO AGENTE continua fora:
// ele não lembra de um teste ao atender um visitante de verdade. A TELA, não: sair da
// aba apagava a conversa, e voltar ao ponto onde se estava exigia repetir as mesmas
// perguntas — o que custa tokens de verdade. O que está guardado é o que se vê, com o
// que cada resposta custou. Reaproveitado pelo modal da lista e pela página do agente.
export function AgentPlayground({ agent }: { agent: AgentSummary }) {
  const [messages, setMessages] = useState<
    {
      role: 'user' | 'assistant'
      content: string
      handoff?: boolean
      toolCalls?: ToolCall[]
      /** O DADO, separado do texto — quando o agente produz dado. */
      data?: unknown
      /** Este turno é uma PERGUNTA do agente — a marca volta no próximo envio. */
      clarification?: boolean
      /** As alternativas oferecidas — devolvidas no próximo envio para "2" virar a opção. */
      clarificationOptions?: string[]
      diagnostics?: {
        outputValid?: boolean
        outputRepaired?: boolean
        outputProblem?: string
        runConfigDropped?: string
        // O que rodou de fato, e a que preço.
        model?: string | null
        modelChoice?: 'auto' | 'manual' | 'default'
        modelReason?: string | null
        inputTokens?: number
        outputTokens?: number
        durationMs?: number
      }
    }[]
  >([])
  const [input, setInput] = useState('')
  /**
   * A entrada ESTRUTURADA, para um agente que declara contrato de entrada.
   *
   * Testar com prosa um agente que recebe campos testa outra coisa: em produção ele nunca
   * vai ver uma frase, e o que se aprende aqui não vale para lá.
   */
  const schemaDeEntrada = agent.contract?.inputJsonSchema ?? null
  const [inputJson, setInputJson] = useState('')
  const [erroDeEntrada, setErroDeEntrada] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [limpando, setLimpando] = useState(false)
  // A trilha é criada ANTES do envio: é o que permite o painel acompanhar sem esperar a
  // resposta final. Um id por envio — a execução anterior fica no histórico do painel.
  const [traceId, setTraceId] = useState<string | null>(null)
  const trilha = useExecutionTrace(traceId)

  // O que já foi conversado, ao abrir. Uma falha aqui não pode impedir o teste: começa
  // vazio e segue.
  useEffect(() => {
    let vivo = true
    fetch(`${API_URL}/api/agents/${agent._id}/playground`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { turns: [] }))
      .then((corpo) => {
        if (vivo && Array.isArray(corpo?.turns)) setMessages(corpo.turns)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [agent._id])

  async function limpar() {
    setLimpando(true)
    try {
      await fetch(`${API_URL}/api/agents/${agent._id}/playground`, { method: 'DELETE', credentials: 'include' })
      setMessages([])
    } finally {
      setLimpando(false)
    }
  }

  async function enviar(texto: string) {
    const limpo = texto.trim()
    if (!limpo || sending) return

    // Conferido AQUI antes de sair: um JSON quebrado não precisa de uma ida ao servidor
    // para ser reconhecido como quebrado.
    let dadosDeEntrada: unknown
    if (schemaDeEntrada && inputJson.trim()) {
      try {
        dadosDeEntrada = JSON.parse(inputJson)
      } catch {
        setErroDeEntrada('Isso não é um JSON válido.')
        return
      }
    }
    setErroDeEntrada(null)
    const next = [...messages, { role: 'user' as const, content: limpo }]
    setMessages(next)
    setInput('')
    setSending(true)
    // Uma trilha por envio, criada antes do pedido sair.
    const novoTrace = novaTrilha()
    setTraceId(novoTrace)

    try {
      const res = await fetch(`${API_URL}/api/agents/${agent._id}/playground`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // A marca de "isto foi uma pergunta" volta junto: é dela que o servidor conta
        // quantas vezes já se perguntou nesta conversa, e é o que impede o agente de
        // perguntar sem parar.
        body: JSON.stringify({
          traceId: novoTrace,
          ...(dadosDeEntrada !== undefined ? { input: dadosDeEntrada } : {}),
          messages: next.map(({ role, content, clarification, clarificationOptions }) => ({
            role,
            content,
            ...(clarification ? { clarification } : {}),
            // As alternativas voltam para o servidor poder ler "2" como a segunda delas.
            ...(clarificationOptions?.length ? { clarificationOptions } : {}),
          })),
        }),
      })
      if (res.ok) {
        const body = await res.json()
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: body.reply,
            handoff: body.handoff,
            toolCalls: body.toolCalls,
            data: body.data,
            diagnostics: body.diagnostics,
            clarification: Boolean(body.clarification),
            clarificationOptions: body.clarification?.options ?? [],
          },
        ])
      } else {
        // A recusa por contrato de entrada é do DONO para o dono: ela diz qual campo está
        // errado, e mostrá-la como "erro de chave de API" mandaria procurar no lugar errado.
        const corpo = await res.json().catch(() => null)
        if (corpo?.code === 'invalid_input') {
          const caminhos = Array.isArray(corpo.errors)
            ? corpo.errors.map((e: { path?: string; message?: string }) => `${e.path ? `${e.path}: ` : ''}${e.message ?? ''}`).join('; ')
            : ''
          setErroDeEntrada(`${corpo.error}${caminhos ? ` (${caminhos})` : ''}`)
        } else {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: 'Não foi possível gerar a resposta — verifique a chave de API em Configurações.',
            },
          ])
        }
      }
    } finally {
      setSending(false)
    }
  }

  const handleSend = (event: FormEvent) => {
    event.preventDefault()
    void enviar(input)
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-(--text-faint)">
          Conversa de teste — fica salva aqui pra você não repetir as perguntas. A memória do agente
          não é usada, e nada disto chega a um visitante.
        </p>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => void limpar()}
            disabled={limpando}
            data-testid="playground-clear"
            className="rounded-lg border border-(--border-strong) px-2.5 py-1 text-xs text-(--text-muted) transition hover:text-(--text-heading) disabled:opacity-50"
          >
            Limpar conversa
          </button>
        )}
      </div>
      {/* `contain: inline-size` decide uma discussão de largura a favor da PÁGINA.
          Sem isto a largura do chat era negociada pelo que o agente respondia: um bloco
          de código, uma URL de 120 caracteres ou a linha da ferramenta (que é `truncate`,
          e portanto `nowrap`) pediam 1116px de largura mínima. A aba é um grid de coluna
          automática, então a coluna crescia para 1116px dentro de um cartão de 320px — a
          conversa saía da área e a página inteira ganhava rolagem lateral. Com a
          contenção, o chat recebe a largura de fora e o conteúdo se vira por dentro:
          texto quebra, código rola no próprio bloco, a linha da ferramenta corta. */}
      <div className="grid gap-3 lg:grid-cols-2" style={{ gridTemplateColumns: undefined }} data-testid="playground-with-trace">
        <div
          className="flex h-96 min-w-0 flex-col rounded-lg border border-(--border-subtle) bg-(--surface-card)/50"
          style={{ contain: 'inline-size' }}
        >
        <div className="flex-1 space-y-2 overflow-y-auto p-3" data-testid="playground-messages">
          {messages.length === 0 && (
            <p className="text-sm text-(--text-muted)">Envie uma mensagem como se fosse o visitante.</p>
          )}
          {messages.map((message, index) => (
            <div key={index}>
              <div
                className={
                  message.role === 'user'
                    ? 'ml-auto max-w-[85%] min-w-0 break-words rounded-2xl rounded-tr-sm bg-(--intent-brand) px-3 py-2 text-sm text-white'
                    : 'max-w-[85%] min-w-0 break-words rounded-2xl rounded-tl-sm bg-(--surface-sunken) px-3 py-2 text-sm'
                }
              >
                <MessageContent content={message.content} />
              </div>
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="max-w-[85%] min-w-0">
                  <ToolCalls calls={message.toolCalls} />
                </div>
              )}
              {/* O Playground é onde se testa: uma resposta fora do contrato aparece aqui,
                  com o motivo, em vez de sumir. Numa conversa real ela não seria enviada. */}
              {/* O que rodou, e a que preço. Com "Automático" a escolha é uma regra —
                  e uma regra em que se confia sem conferir é um palpite com passos
                  extras. */}
              {/* As alternativas NÃO viram botão: elas já estão escritas na resposta,
                  numeradas, porque a mesma conversa vai para WhatsApp, e-mail e outros
                  canais que só transportam texto. O visitante responde "2" e o servidor
                  entende, sem gastar inferência para adivinhar. */}

              {/*
                DADO e TEXTO em painéis separados.
                Colados, o dado aparece como JSON cru no meio de uma conversa e o texto
                aparece como se fosse o resultado — e quem testa não consegue dizer qual
                dos dois o próximo consumidor vai receber.
              */}
              {message.data !== undefined && (
                <pre
                  className="mt-2 max-h-56 overflow-auto rounded-lg border border-(--border-subtle) p-2 font-mono text-[11px] text-(--text-muted)"
                  data-testid="playground-data"
                >
                  {JSON.stringify(message.data, null, 2)}
                </pre>
              )}
              {message.diagnostics?.model && (
                <span className="mt-1 text-[10px] text-(--text-faint)" data-testid="playground-run-info">
                  ↳ {message.diagnostics.model}
                  {message.diagnostics.modelChoice === 'auto'
                    ? ` (automático${message.diagnostics.modelReason ? `: ${message.diagnostics.modelReason}` : ''})`
                    : message.diagnostics.modelChoice === 'default'
                      ? ' (padrão do sistema)'
                      : ''}
                  {' · '}
                  {(message.diagnostics.inputTokens ?? 0) + (message.diagnostics.outputTokens ?? 0)} tokens
                  {message.diagnostics.durationMs
                    ? ` · ${message.diagnostics.durationMs < 1000 ? `${message.diagnostics.durationMs} ms` : `${(message.diagnostics.durationMs / 1000).toFixed(1)} s`}`
                    : ''}
                </span>
              )}

              {message.diagnostics?.outputValid && (
                <p className="mt-1 text-[10px] text-(--text-faint)" data-testid="playground-validation-ok">
                  Contrato de saída conferido.
                </p>
              )}
              {message.diagnostics?.outputValid === false && (
                <p className="mt-1 text-xs font-medium text-amber-400" data-testid="playground-validation-error">
                  ⚠ A resposta não cumpriu o formato JSON configurado
                  {message.diagnostics.outputProblem ? ` (${message.diagnostics.outputProblem})` : ''} — num
                  canal real ela não seria enviada.
                </p>
              )}
              {message.diagnostics?.outputRepaired && message.diagnostics.outputValid !== false && (
                <p className="mt-1 text-xs text-(--text-faint)">
                  A resposta precisou de uma correção de formato — custou uma chamada extra ao modelo.
                </p>
              )}
              {message.diagnostics?.runConfigDropped && (
                <p className="mt-1 text-xs text-(--text-faint)">
                  Parâmetros ignorados por este modelo — {message.diagnostics.runConfigDropped}.
                </p>
              )}
              {message.handoff && (
                <p className="mt-1 text-xs font-medium text-amber-400">
                  ⚠ Handoff acionado — numa conversa real, o agente pararia de responder aqui.
                </p>
              )}
            </div>
          ))}
          {sending && <p className="text-sm text-(--text-faint)">Digitando...</p>}
        </div>
        <form onSubmit={handleSend} className="space-y-2 border-t border-(--border-subtle) p-3">
        {schemaDeEntrada && (
          <div>
            <label className="mb-1 block text-xs text-(--text-muted)" htmlFor="playground-input-json">
              Entrada (JSON) — este agente declara um contrato de entrada
            </label>
            <textarea
              id="playground-input-json"
              value={inputJson}
              onChange={(e) => setInputJson(e.target.value)}
              rows={4}
              spellCheck={false}
              aria-invalid={Boolean(erroDeEntrada)}
              placeholder={JSON.stringify(exemploDoSchema(schemaDeEntrada), null, 2)}
              className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 font-mono text-xs outline-none focus:border-(--border-focus)"
              data-testid="playground-input-json"
            />
            {erroDeEntrada && (
              <p className="mt-1 text-xs" style={{ color: 'var(--status-blocked)' }} data-testid="playground-input-error">
                {erroDeEntrada}
              </p>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Mensagem do visitante..."
            className="flex-1 rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-lg bg-(--intent-brand) px-4 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover) disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
        </form>
        </div>
        <ExecutionTrace events={trilha.events} live={trilha.live} onClear={trilha.clear} />
      </div>
    </div>
  )
}

/**
 * Um exemplo a partir do contrato — só os NOMES dos campos e o tipo.
 *
 * Serve de placeholder: quem testa não deveria precisar abrir o formulário noutra aba
 * para lembrar como o objeto se chama.
 */
function exemploDoSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const props = schema.properties
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {}
  const exemplo: Record<string, unknown> = {}
  for (const [campo, def] of Object.entries(props as Record<string, unknown>)) {
    const tipo = (def as { type?: unknown })?.type
    exemplo[campo] = tipo === 'number' || tipo === 'integer' ? 0 : tipo === 'boolean' ? false : tipo === 'array' ? [] : tipo === 'object' ? {} : ''
  }
  return exemplo
}
