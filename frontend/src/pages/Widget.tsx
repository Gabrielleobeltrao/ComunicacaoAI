import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router'
import { API_URL } from '../lib/api'
import { socket } from '../lib/socket'

interface WidgetConfig {
  name: string
}

interface WidgetMessage {
  _id: string
  conversationId: string
  role: 'visitor' | 'agent'
  content: string
  createdAt: string
}

function getConversationId(publicKey: string) {
  const key = `widget-conversation:${publicKey}`
  let conversationId = localStorage.getItem(key)
  if (!conversationId) {
    conversationId = crypto.randomUUID()
    localStorage.setItem(key, conversationId)
  }
  return conversationId
}

export function Widget() {
  const { publicKey } = useParams<{ publicKey: string }>()
  const [config, setConfig] = useState<WidgetConfig | null>(null)
  const [messages, setMessages] = useState<WidgetMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const conversationId = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!publicKey) return

    conversationId.current = getConversationId(publicKey)

    async function load() {
      try {
        const [configRes, messagesRes] = await Promise.all([
          fetch(`${API_URL}/api/public/widgets/${publicKey}`),
          fetch(
            `${API_URL}/api/public/widgets/${publicKey}/messages?conversationId=${conversationId.current}`,
          ),
        ])

        if (!configRes.ok) {
          setError('Widget não encontrado.')
          return
        }

        setConfig(await configRes.json())
        setMessages(messagesRes.ok ? await messagesRes.json() : [])
      } catch {
        setError('Não foi possível carregar o widget.')
      }
    }

    load()
  }, [publicKey])

  // Realtime delivery: join this visitor's own conversation room so new
  // messages (e.g. the owner's reply) arrive instantly, without polling.
  // Room membership lives on the socket connection, so it's lost on any
  // reconnect (backend restart, brief network drop) — rejoin on every
  // "connect" event, not just the first one, or messages silently stop
  // arriving until a manual page refresh.
  useEffect(() => {
    const id = conversationId.current
    if (!id) return

    function joinRoom() {
      socket.emit('join-conversation', { conversationId: id })
    }

    function handleMessage(message: WidgetMessage) {
      if (message.conversationId !== id) return
      setMessages((prev) => (prev.some((m) => m._id === message._id) ? prev : [...prev, message]))
    }

    socket.on('connect', joinRoom)
    socket.on('message', handleMessage)
    socket.connect()
    if (socket.connected) joinRoom()

    return () => {
      socket.off('connect', joinRoom)
      socket.off('message', handleMessage)
      socket.emit('leave-conversation', { conversationId: id })
    }
  }, [publicKey])

  // Low-frequency fallback in case a socket event is missed (e.g. a reconnect gap).
  useEffect(() => {
    if (!publicKey) return

    const interval = setInterval(async () => {
      const res = await fetch(
        `${API_URL}/api/public/widgets/${publicKey}/messages?conversationId=${conversationId.current}`,
      )
      if (res.ok) {
        setMessages(await res.json())
      }
    }, 15000)

    return () => clearInterval(interval)
  }, [publicKey])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!input.trim() || !publicKey || !conversationId.current) return

    setSending(true)
    const content = input
    setInput('')

    try {
      await fetch(`${API_URL}/api/public/widgets/${publicKey}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversationId.current, content }),
      })
      // The new message arrives via the "message" socket event above.
    } finally {
      setSending(false)
    }
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 p-4 text-center text-sm text-slate-400">
        {error}
      </div>
    )
  }

  if (!config) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        Carregando...
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-4 py-3">
        <h1 className="text-sm font-semibold">{config.name}</h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((message) => (
          <div
            key={message._id}
            className={
              message.role === 'visitor'
                ? 'ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-white px-3 py-2 text-sm text-slate-950'
                : 'max-w-[85%] rounded-2xl rounded-tl-sm bg-slate-800 px-3 py-2 text-sm'
            }
          >
            {message.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-slate-800 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva uma mensagem..."
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
  )
}
