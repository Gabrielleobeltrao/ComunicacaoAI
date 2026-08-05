import { useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { TeamMode, TeamSummary, ToolCall } from '../lib/types'
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
  mode?: TeamMode
  toolCalls?: ToolCall[]
}

// Stateless team test chat — nothing is persisted. Each reply shows which
// specialists were consulted (adaptive) or the active stage (pipeline). Reused
// by the Teams list modal and the team page.
export function TeamPlayground({ team }: { team: TeamSummary }) {
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
      const res = await fetch(`${API_URL}/api/teams/${team._id}/playground`, {
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
      <p className="mb-3 text-xs text-slate-500">
        {team.mode === 'pipeline'
          ? 'Conversa de teste — nada é salvo. Cada resposta mostra em qual etapa do fluxo o atendimento está.'
          : 'Conversa de teste — nada é salvo. Cada resposta mostra quais especialistas o orquestrador consultou.'}
      </p>
      <div className="flex h-96 flex-col rounded-lg border border-slate-800 bg-slate-950/50">
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {messages.length === 0 && (
            <p className="text-sm text-slate-400">Envie uma mensagem como se fosse o visitante.</p>
          )}
          {messages.map((message, index) => (
            <div key={index} className={message.role === 'user' ? '' : 'flex flex-col items-start'}>
              <div
                className={
                  message.role === 'user'
                    ? 'ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-white px-3 py-2 text-sm text-slate-950'
                    : 'max-w-[85%] rounded-2xl rounded-tl-sm bg-slate-800 px-3 py-2 text-sm'
                }
              >
                <MessageContent content={message.content} />
              </div>
              {message.role === 'assistant' && (
                <span className="mt-0.5 text-[10px] text-slate-500">
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
          {sending && <p className="text-sm text-slate-500">Orquestrando...</p>}
        </div>
        <form onSubmit={handleSend} className="flex gap-2 border-t border-slate-800 p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Mensagem do visitante..."
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
          >
            Enviar
          </button>
        </form>
      </div>
    </div>
  )
}
