import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'

interface ConversationSummary {
  widgetId: string
  widgetName: string
  conversationId: string
  lastMessage: string
  lastRole: 'visitor' | 'agent'
  lastAt: string
  messageCount: number
}

interface ConversationMessage {
  _id: string
  role: 'visitor' | 'agent'
  content: string
  createdAt: string
}

export function ConversationsPanel() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ConversationSummary | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const res = await fetch(`${API_URL}/api/conversations`, { credentials: 'include' })
      if (res.ok && !cancelled) {
        setConversations(await res.json())
      }
      setLoading(false)
    }

    load()
    const interval = setInterval(load, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!selected) return
    let cancelled = false

    async function loadMessages() {
      const res = await fetch(
        `${API_URL}/api/widgets/${selected!.widgetId}/conversations/${selected!.conversationId}/messages`,
        { credentials: 'include' },
      )
      if (res.ok && !cancelled) {
        setMessages(await res.json())
      }
    }

    loadMessages()
    const interval = setInterval(loadMessages, 4000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [selected])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleReply(event: FormEvent) {
    event.preventDefault()
    if (!selected || !reply.trim()) return

    setSending(true)
    const content = reply
    setReply('')

    try {
      const res = await fetch(
        `${API_URL}/api/widgets/${selected.widgetId}/conversations/${selected.conversationId}/messages`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        },
      )

      if (res.ok) {
        const message: ConversationMessage = await res.json()
        setMessages((prev) => [...prev, message])
      }
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-400">Carregando conversas...</p>
  }

  if (conversations.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Nenhuma conversa ainda. Teste um widget para ver as mensagens aparecerem aqui.
      </p>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_1fr]">
      <ul className="space-y-2">
        {conversations.map((conversation) => {
          const isSelected =
            selected?.widgetId === conversation.widgetId &&
            selected?.conversationId === conversation.conversationId

          return (
            <li key={`${conversation.widgetId}-${conversation.conversationId}`}>
              <button
                type="button"
                onClick={() => setSelected(conversation)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                  isSelected
                    ? 'border-slate-500 bg-slate-800'
                    : 'border-slate-800 bg-slate-950/50 hover:bg-slate-900'
                }`}
              >
                <p className="font-medium">{conversation.widgetName}</p>
                <p className="truncate text-slate-400">{conversation.lastMessage}</p>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="flex h-120 flex-col rounded-lg border border-slate-800 bg-slate-950/50">
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {!selected ? (
            <p className="text-sm text-slate-400">Selecione uma conversa para ver as mensagens.</p>
          ) : (
            messages.map((message) => (
              <div
                key={message._id}
                className={
                  message.role === 'visitor'
                    ? 'max-w-[85%] rounded-2xl rounded-tl-sm bg-slate-800 px-3 py-2 text-sm'
                    : 'ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-white px-3 py-2 text-sm text-slate-950'
                }
              >
                {message.content}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {selected && (
          <form onSubmit={handleReply} className="flex gap-2 border-t border-slate-800 p-3">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Responder..."
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            <button
              type="submit"
              disabled={sending || !reply.trim()}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
            >
              Enviar
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
