import { useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { AgentSummary, ToolCall } from '../lib/types'
import { MessageContent } from './MessageContent'
import { ToolCalls } from './ToolCalls'

// Stateless test chat for a single agent — nothing is persisted and the agent's
// memory is not used. Reused by the Agents list modal and the agent page.
export function AgentPlayground({ agent }: { agent: AgentSummary }) {
  const [messages, setMessages] = useState<
    {
      role: 'user' | 'assistant'
      content: string
      handoff?: boolean
      toolCalls?: ToolCall[]
      diagnostics?: { outputValid?: boolean; outputRepaired?: boolean; outputProblem?: string; runConfigDropped?: string }
    }[]
  >([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend(event: FormEvent) {
    event.preventDefault()
    if (!input.trim() || sending) return

    const next = [...messages, { role: 'user' as const, content: input.trim() }]
    setMessages(next)
    setInput('')
    setSending(true)

    try {
      const res = await fetch(`${API_URL}/api/agents/${agent._id}/playground`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
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
            diagnostics: body.diagnostics,
          },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: 'Não foi possível gerar a resposta — verifique a chave de API em Configurações.',
          },
        ])
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <p className="mb-3 text-xs text-(--text-faint)">
        Conversa de teste — nada é salvo e a memória do agente não é usada. Ideal pra ajustar o
        objetivo, estilo e guardrails.
      </p>
      <div className="flex h-96 flex-col rounded-lg border border-(--border-subtle) bg-(--surface-card)/50">
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {messages.length === 0 && (
            <p className="text-sm text-(--text-muted)">Envie uma mensagem como se fosse o visitante.</p>
          )}
          {messages.map((message, index) => (
            <div key={index}>
              <div
                className={
                  message.role === 'user'
                    ? 'ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-(--intent-brand) px-3 py-2 text-sm text-white'
                    : 'max-w-[85%] rounded-2xl rounded-tl-sm bg-(--surface-sunken) px-3 py-2 text-sm'
                }
              >
                <MessageContent content={message.content} />
              </div>
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="max-w-[85%]">
                  <ToolCalls calls={message.toolCalls} />
                </div>
              )}
              {/* O Playground é onde se testa: uma resposta fora do contrato aparece aqui,
                  com o motivo, em vez de sumir. Numa conversa real ela não seria enviada. */}
              {message.diagnostics?.outputValid === false && (
                <p className="mt-1 text-xs font-medium text-amber-400">
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
        <form onSubmit={handleSend} className="flex gap-2 border-t border-(--border-subtle) p-3">
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
        </form>
      </div>
    </div>
  )
}
