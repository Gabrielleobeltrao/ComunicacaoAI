import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router'
import { API_URL } from '../lib/api'
import { socket } from '../lib/socket'
import { MessageContent } from '../components/MessageContent'

type ConversationPersistence = 'same_browser' | 'always_new'

interface WidgetConfig {
  name: string
  primaryColor: string | null
  welcomeTitle: string | null
  welcomeMessage: string | null
  position: 'right' | 'left'
  avatarUrl: string | null
  conversationPersistence: ConversationPersistence
  firstMessage: string | null
}

interface WidgetMessage {
  _id: string
  conversationId: string
  role: 'visitor' | 'agent'
  content: string
  createdAt: string
}

function getConversationId(publicKey: string, persistence: ConversationPersistence) {
  if (persistence === 'always_new') {
    return crypto.randomUUID()
  }

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
  const [notice, setNotice] = useState<string | null>(null)
  const conversationId = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!publicKey) return
    // Capture the narrowed value so it stays `string` inside the closure below.
    const key = publicKey

    async function load() {
      try {
        const configRes = await fetch(`${API_URL}/api/public/widgets/${key}`)
        if (!configRes.ok) {
          setError('Widget não encontrado.')
          return
        }
        const configData: WidgetConfig = await configRes.json()
        setConfig(configData)

        // Depends on the config (some_browser vs always_new), so this can
        // only be resolved after the config request comes back.
        conversationId.current = getConversationId(key, configData.conversationPersistence)

        const messagesRes = await fetch(
          `${API_URL}/api/public/widgets/${key}/messages?conversationId=${conversationId.current}`,
        )
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
    setNotice(null)
    const content = input
    setInput('')

    try {
      const res = await fetch(`${API_URL}/api/public/widgets/${publicKey}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversationId.current, content }),
      })
      if (res.status === 429) {
        setInput(content)
        setNotice('Você atingiu o limite de mensagens por hoje. Tente novamente mais tarde.')
      }
      // Otherwise the new message arrives via the "message" socket event above.
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

  // The agent's proactive first message wins over the widget's generic
  // welcome message when both are configured.
  const welcomeContent = config.firstMessage || config.welcomeMessage
  const displayMessages =
    messages.length === 0 && welcomeContent
      ? [
          {
            _id: 'welcome',
            conversationId: '',
            role: 'agent' as const,
            content: welcomeContent,
            createdAt: '',
          },
          ...messages,
        ]
      : messages

  const accentStyle = config.primaryColor ? { backgroundColor: config.primaryColor } : undefined

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-4 py-3">
        <h1 className="text-sm font-semibold">{config.welcomeTitle || config.name}</h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {displayMessages.map((message) => (
          <div
            key={message._id}
            className={
              message.role === 'visitor'
                ? `ml-auto max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2 text-sm ${
                    config.primaryColor ? 'text-white' : 'bg-white text-slate-950'
                  }`
                : 'max-w-[85%] rounded-2xl rounded-tl-sm bg-slate-800 px-3 py-2 text-sm'
            }
            style={message.role === 'visitor' ? accentStyle : undefined}
          >
            <MessageContent content={message.content} />
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {notice && (
        <p className="border-t border-slate-800 px-4 py-2 text-center text-xs text-amber-400">{notice}</p>
      )}

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
          className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
            config.primaryColor ? 'text-white' : 'bg-white text-slate-950 hover:bg-slate-200'
          }`}
          style={accentStyle}
        >
          Enviar
        </button>
      </form>
    </div>
  )
}
