import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { ToolCall } from '../lib/types'
import { socket } from '../lib/socket'
import { MessageContent } from './MessageContent'
import { ToolCalls } from './ToolCalls'

interface ConversationSummary {
  widgetId: string
  widgetName: string
  conversationId: string
  lastMessage: string
  lastRole: 'visitor' | 'agent'
  lastAt: string
  messageCount: number
  humanHandoff: boolean
}

interface ConversationMessage {
  _id: string
  conversationId: string
  role: 'visitor' | 'agent'
  content: string
  agentName?: string | null
  createdAt: string
}

interface OrchestrationDecision {
  specialists: string[]
  clarify: boolean
  mode: 'adaptive' | 'pipeline'
  advanced: boolean
  fromStage: string | null
  createdAt: string
}

export function ConversationsPanel() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ConversationSummary | null>(null)
  const [widgetFilter, setWidgetFilter] = useState('')
  const [search, setSearch] = useState('')
  // Held in a ref so the socket/interval handlers (registered once) always fetch
  // with the current search term without re-registering on every keystroke.
  const searchRef = useRef('')
  searchRef.current = search
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [structuredData, setStructuredData] = useState<Record<string, string>>({})
  const [decisions, setDecisions] = useState<OrchestrationDecision[]>([])
  const [showDecisions, setShowDecisions] = useState(false)
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [handoffActive, setHandoffActive] = useState(false)
  const [togglingHandoff, setTogglingHandoff] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Server-side search across the full message content of each conversation
  // (see the backend). Stable identity so the socket effect registers it once.
  const load = useCallback(async () => {
    const term = searchRef.current.trim()
    const qs = term ? `?search=${encodeURIComponent(term)}` : ''
    const res = await fetch(`${API_URL}/api/conversations${qs}`, { credentials: 'include' })
    if (res.ok) {
      setConversations(await res.json())
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const interval = setInterval(load, 20000)

    // Realtime: refresh the list instantly whenever any of the owner's
    // widgets receives a new message, instead of waiting for the poll.
    // Room membership is lost on reconnect, so rejoin on every "connect"
    // event (not just the first) or updates silently stop arriving.
    function joinOwnerRoom() {
      socket.emit('join-owner')
    }

    socket.on('connect', joinOwnerRoom)
    socket.on('conversations-updated', load)
    socket.connect()
    if (socket.connected) joinOwnerRoom()

    return () => {
      clearInterval(interval)
      socket.off('connect', joinOwnerRoom)
      socket.off('conversations-updated', load)
    }
  }, [load])

  // Debounced (re)fetch on search change; also does the initial load on mount.
  useEffect(() => {
    const timeout = setTimeout(load, 250)
    return () => clearTimeout(timeout)
  }, [search, load])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    let structuredDataTimeout: ReturnType<typeof setTimeout> | undefined
    const { widgetId, conversationId } = selected

    setStructuredData({})
    setDecisions([])
    setToolCalls([])
    setHandoffActive(selected.humanHandoff)

    async function loadMessages() {
      const res = await fetch(
        `${API_URL}/api/widgets/${widgetId}/conversations/${conversationId}/messages`,
        { credentials: 'include' },
      )
      if (res.ok && !cancelled) {
        setMessages(await res.json())
      }
    }

    async function loadStructuredData() {
      const res = await fetch(
        `${API_URL}/api/widgets/${widgetId}/conversations/${conversationId}/structured-data`,
        { credentials: 'include' },
      )
      if (res.ok && !cancelled) {
        const body = await res.json()
        setStructuredData(body.data ?? {})
        setHandoffActive(body.humanHandoff ?? false)
      }
    }

    async function loadDecisions() {
      const res = await fetch(
        `${API_URL}/api/widgets/${widgetId}/conversations/${conversationId}/decisions`,
        { credentials: 'include' },
      )
      if (res.ok && !cancelled) {
        setDecisions(await res.json())
      }
    }

    async function loadToolCalls() {
      const res = await fetch(
        `${API_URL}/api/widgets/${widgetId}/conversations/${conversationId}/tool-calls`,
        { credentials: 'include' },
      )
      if (res.ok && !cancelled) {
        setToolCalls(await res.json())
      }
    }

    loadMessages()
    loadStructuredData()
    loadDecisions()
    loadToolCalls()
    const interval = setInterval(() => {
      loadMessages()
      loadStructuredData()
      loadDecisions()
      loadToolCalls()
    }, 15000)

    function joinRoom() {
      socket.emit('join-conversation', { conversationId })
    }

    function handleMessage(message: ConversationMessage) {
      if (message.conversationId !== conversationId) return
      setMessages((prev) => (prev.some((m) => m._id === message._id) ? prev : [...prev, message]))
      // A decision (and any tool calls) are logged before/with the reply, so
      // they're already persisted by the time the agent message arrives.
      loadDecisions()
      loadToolCalls()
      // The extraction runs in the background after the agent's reply, so
      // give it a moment before refreshing instead of fetching immediately.
      clearTimeout(structuredDataTimeout)
      structuredDataTimeout = setTimeout(loadStructuredData, 5000)
    }

    socket.on('connect', joinRoom)
    socket.on('message', handleMessage)
    if (socket.connected) joinRoom()

    return () => {
      cancelled = true
      clearInterval(interval)
      clearTimeout(structuredDataTimeout)
      socket.off('connect', joinRoom)
      socket.off('message', handleMessage)
      socket.emit('leave-conversation', { conversationId })
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
      await fetch(
        `${API_URL}/api/widgets/${selected.widgetId}/conversations/${selected.conversationId}/messages`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        },
      )
      // The new message arrives via the "message" socket event above.
    } finally {
      setSending(false)
    }
  }

  async function handleToggleHandoff() {
    if (!selected || togglingHandoff) return
    setTogglingHandoff(true)

    try {
      const res = await fetch(
        `${API_URL}/api/widgets/${selected.widgetId}/conversations/${selected.conversationId}/handoff`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: !handoffActive }),
        },
      )
      if (res.ok) {
        const body = await res.json()
        setHandoffActive(body.humanHandoff)
        setConversations((prev) =>
          prev.map((c) =>
            c.widgetId === selected.widgetId && c.conversationId === selected.conversationId
              ? { ...c, humanHandoff: body.humanHandoff }
              : c,
          ),
        )
      }
    } finally {
      setTogglingHandoff(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-400">Carregando conversas...</p>
  }

  // Only show the "no conversations yet" state when there genuinely are none —
  // not when a search simply returned nothing (the search box must stay usable).
  if (conversations.length === 0 && !search.trim()) {
    return (
      <p className="text-sm text-slate-400">
        Nenhuma conversa ainda. Teste um widget para ver as mensagens aparecerem aqui.
      </p>
    )
  }

  const widgetOptions = Array.from(
    new Map(conversations.map((c) => [c.widgetId, c.widgetName])),
    ([id, name]) => ({ id, name }),
  )
  const filteredConversations = widgetFilter
    ? conversations.filter((c) => c.widgetId === widgetFilter)
    : conversations

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_1fr]">
      <div className="space-y-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar nas conversas..."
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        <select
          value={widgetFilter}
          onChange={(e) => setWidgetFilter(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
        >
          <option value="">Todos os widgets</option>
          {widgetOptions.map((widget) => (
            <option key={widget.id} value={widget.id}>
              {widget.name}
            </option>
          ))}
        </select>

        {filteredConversations.length === 0 ? (
          <p className="text-sm text-slate-400">
            {search.trim() ? 'Nenhuma conversa encontrada para essa busca.' : 'Nenhuma conversa para esse widget.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {filteredConversations.map((conversation) => {
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
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{conversation.widgetName}</p>
                      {conversation.humanHandoff && (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                          Humano
                        </span>
                      )}
                    </div>
                    <p className="truncate text-slate-400">{conversation.lastMessage}</p>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="flex h-120 flex-col rounded-lg border border-slate-800 bg-slate-950/50">
        {selected && (
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2">
            <p className="text-xs text-slate-400">
              {handoffActive ? (
                <span className="font-medium text-amber-400">
                  Atendimento humano ativo — o agente não responde nesta conversa.
                </span>
              ) : (
                'Agente respondendo automaticamente.'
              )}
            </p>
            <button
              type="button"
              onClick={handleToggleHandoff}
              disabled={togglingHandoff}
              className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1 text-xs transition hover:bg-slate-800 disabled:opacity-50"
            >
              {handoffActive ? 'Devolver ao agente' : 'Assumir conversa'}
            </button>
          </div>
        )}
        {selected && Object.keys(structuredData).length > 0 && (
          <div className="border-b border-slate-800 p-3">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              Dados estruturados
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(structuredData).map(([field, value]) => (
                <span
                  key={field}
                  className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs"
                >
                  <span className="text-slate-400">{field}:</span>{' '}
                  <span className="text-white">{value}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {selected && decisions.length > 0 && (
          <div className="border-b border-slate-800 p-3">
            <button
              type="button"
              onClick={() => setShowDecisions((prev) => !prev)}
              className="flex w-full items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 transition hover:text-slate-300"
            >
              <span>
                Orquestração{' '}
                <span className="normal-case tracking-normal text-slate-600">
                  ({decisions.length} {decisions.length === 1 ? 'decisão' : 'decisões'})
                </span>
              </span>
              <span className="text-slate-600">{showDecisions ? '▾' : '▸'}</span>
            </button>
            {showDecisions && (
              <ol className="mt-2 space-y-1">
                {decisions.map((decision, index) => (
                  <li key={index} className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="w-5 shrink-0 text-right text-slate-600">{index + 1}.</span>
                    {decision.mode === 'pipeline' ? (
                      <span className="flex items-center gap-1.5">
                        <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                          Fluxo
                        </span>
                        {decision.advanced && decision.fromStage ? (
                          <span className="text-slate-300">
                            <span className="text-slate-500">{decision.fromStage}</span> →{' '}
                            {decision.specialists[0] ?? '—'}
                          </span>
                        ) : (
                          <span className="text-slate-300">Etapa: {decision.specialists[0] ?? '—'}</span>
                        )}
                      </span>
                    ) : decision.clarify ? (
                      <span className="flex items-center gap-1.5">
                        <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                          Adaptativo
                        </span>
                        <span className="text-amber-400">Pediu esclarecimento</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                          Adaptativo
                        </span>
                        <span className="text-slate-300">
                          Consultou: {decision.specialists.length > 0 ? decision.specialists.join(', ') : '—'}
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        {selected && toolCalls.length > 0 && (
          <div className="border-b border-slate-800 p-3">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              Ferramentas ({toolCalls.length})
            </p>
            <ToolCalls calls={toolCalls} />
          </div>
        )}
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {!selected ? (
            <p className="text-sm text-slate-400">Selecione uma conversa para ver as mensagens.</p>
          ) : (
            messages.map((message) => (
              <div key={message._id} className={message.role === 'visitor' ? '' : 'flex flex-col items-end'}>
                <div
                  className={
                    message.role === 'visitor'
                      ? 'max-w-[85%] rounded-2xl rounded-tl-sm bg-slate-800 px-3 py-2 text-sm'
                      : 'ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-white px-3 py-2 text-sm text-slate-950'
                  }
                >
                  <MessageContent content={message.content} />
                </div>
                {message.role === 'agent' && message.agentName && (
                  <span className="mt-0.5 mr-1 text-[10px] text-slate-500">{message.agentName}</span>
                )}
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
