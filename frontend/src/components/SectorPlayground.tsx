import { useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { SectorMode, SectorSummary, ToolCall } from '../lib/types'
import { MessageContent } from './MessageContent'
import { ToolCalls } from './ToolCalls'

interface PlayMessage {
  role: 'user' | 'assistant'
  content: string
  specialists?: string[]
  clarify?: boolean
  stage?: string | null
  advanced?: boolean
  fromStage?: string | null
  mode?: SectorMode
  toolCalls?: ToolCall[]
}

// Stateless sector test chat — nothing is persisted. Each reply shows which
// specialists were consulted (adaptive) or the active stage (pipeline). Reused
// by the Setores list modal and the sector page.
export function SectorPlayground({ sector }: { sector: SectorSummary }) {
  const [messages, setMessages] = useState<PlayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [stageIndex, setStageIndex] = useState(0)

  async function handleSend(event: FormEvent) {
    event.preventDefault()
    if (!input.trim() || sending) return
    const next: PlayMessage[] = [...messages, { role: 'user', content: input.trim() }]
    setMessages(next)
    setInput('')
    setSending(true)
    try {
      const res = await fetch(`${API_URL}/api/sectors/${sector._id}/playground`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), stageIndex }),
      })
      if (res.ok) {
        const body = await res.json()
        if (typeof body.stageIndex === 'number') setStageIndex(body.stageIndex)
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: body.reply,
            specialists: body.specialists,
            clarify: body.clarify,
            stage: body.stage,
            advanced: body.advanced,
            fromStage: body.fromStage,
            mode: body.mode,
            toolCalls: body.toolCalls,
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
        {sector.mode === 'pipeline'
          ? 'Conversa de teste — nada é salvo. Cada resposta mostra em qual etapa do fluxo o atendimento está.'
          : 'Conversa de teste — nada é salvo. Cada resposta mostra quais especialistas o orquestrador consultou.'}
      </p>
      <div className="flex h-96 flex-col rounded-lg border border-(--border-subtle) bg-(--surface-card)/50">
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {messages.length === 0 && (
            <p className="text-sm text-(--text-muted)">Envie uma mensagem como se fosse o visitante.</p>
          )}
          {messages.map((message, index) => (
            <div key={index} className={message.role === 'user' ? '' : 'flex flex-col items-start'}>
              <div
                className={
                  message.role === 'user'
                    ? 'ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-(--intent-brand) px-3 py-2 text-sm text-white'
                    : 'max-w-[85%] rounded-2xl rounded-tl-sm bg-(--surface-sunken) px-3 py-2 text-sm'
                }
              >
                <MessageContent content={message.content} />
              </div>
              {message.role === 'assistant' && (
                <span className="mt-0.5 text-[10px] text-(--text-faint)">
                  {message.mode === 'pipeline'
                    ? message.advanced && message.fromStage
                      ? `↳ ${message.fromStage} → ${message.stage ?? '—'}`
                      : `↳ etapa: ${message.stage ?? '—'}`
                    : message.clarify
                      ? '↳ pediu esclarecimento'
                      : message.specialists && message.specialists.length > 0
                        ? `↳ consultou: ${message.specialists.join(', ')}`
                        : ''}
                </span>
              )}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="max-w-[85%]">
                  <ToolCalls calls={message.toolCalls} />
                </div>
              )}
            </div>
          ))}
          {sending && <p className="text-sm text-(--text-faint)">Orquestrando...</p>}
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
