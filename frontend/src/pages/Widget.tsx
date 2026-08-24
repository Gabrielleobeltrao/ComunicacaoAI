import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router'
import { API_URL } from '../lib/api'
import { socket } from '../lib/socket'
import { MessageContent } from '../components/MessageContent'
import { TypingDots } from '../components/TypingDots'

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
  /**
   * A resposta está sendo preparada.
   *
   * Diferente de `sending`: aquele acaba quando o POST volta, e o POST volta assim que a
   * mensagem do VISITANTE é gravada. A do agente vem depois, pelo socket — e é justamente
   * esse intervalo, o de uma inferência (e às vezes de uma busca na web em cima dela), que
   * ficava sem nada na tela.
   */
  const [aguardandoDesde, setAguardandoDesde] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /**
   * A conversa deste visitante — ESTADO, não referência.
   *
   * Era um `useRef`, e o efeito do socket dependia só de `publicKey`: ele rodava antes de
   * a configuração chegar, lia `null`, desistia — e como nada o disparava de novo, a sala
   * nunca era entrada. As mensagens só apareciam pelo polling de 15 em 15 segundos, o que
   * dá ao chat a cara de quebrado.
   *
   * Como estado, a chegada do id dispara o efeito, e ele entra na sala.
   */
  const [conversationId, setConversationId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!publicKey) return
    // Capture the narrowed value so it stays `string` inside the closure below.
    const key = publicKey

    async function load() {
      try {
        const configRes = await fetch(`${API_URL}/api/public/widgets/${key}`)
        if (!configRes.ok) {
          /**
           * O motivo vem do servidor, quando ele manda um.
           *
           * "Widget não encontrado" para tudo escondia dois casos diferentes e
           * acionáveis: o App foi desativado (410) e o destino não atende mais (409). Os
           * dois têm conserto do lado de quem administra — e nenhum deles é chave errada.
           */
          const corpo = (await configRes.json().catch(() => null)) as { error?: string } | null
          setError(corpo?.error || 'Widget não encontrado.')
          return
        }
        const configData: WidgetConfig = await configRes.json()
        setConfig(configData)

        // Depends on the config (some_browser vs always_new), so this can
        // only be resolved after the config request comes back.
        const id = getConversationId(key, configData.conversationPersistence)
        setConversationId(id)

        const messagesRes = await fetch(`${API_URL}/api/public/widgets/${key}/messages?conversationId=${id}`)
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
    // Só depois de existir uma conversa. Antes disto não há sala para entrar.
    if (!conversationId) return
    const id = conversationId

    function joinRoom() {
      socket.emit('join-conversation', { conversationId: id })
    }

    function handleMessage(message: WidgetMessage) {
      if (message.conversationId !== id) return
      // A resposta chegou: os pontinhos cumpriram o que prometiam e saem.
      if (message.role === 'agent') setAguardandoDesde(null)
      // Por `_id`: a mesma mensagem pode chegar pelo socket e pelo polling, e uma
      // reconexão pode reentregar o que já está na tela.
      setMessages((prev) => (prev.some((m) => m._id === message._id) ? prev : [...prev, message]))
    }

    socket.on('connect', joinRoom)
    socket.on('message', handleMessage)
    socket.connect()
    // Já conectado quando o id chegou: o evento `connect` não virá mais, então entra agora.
    if (socket.connected) joinRoom()

    return () => {
      socket.off('connect', joinRoom)
      socket.off('message', handleMessage)
      socket.emit('leave-conversation', { conversationId: id })
    }
  }, [conversationId])

  // Low-frequency fallback in case a socket event is missed (e.g. a reconnect gap).
  // A rede de segurança, e só isso: com o socket funcionando ela nunca traz novidade.
  // Sem a conversa não há o que buscar — e buscar com `undefined` na query devolvia 400
  // a cada quinze segundos.
  useEffect(() => {
    if (!publicKey || !conversationId) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/public/widgets/${publicKey}/messages?conversationId=${conversationId}`)
        if (res.ok) {
          const lista = (await res.json()) as WidgetMessage[]
          setMessages(lista)
          // A rede de segurança também desliga os pontinhos: se o evento do socket se
          // perdeu, a resposta chega por aqui — e deixar a animação girando sobre uma
          // resposta já visível é pior do que nunca tê-la mostrado.
          if (lista.at(-1)?.role === 'agent') setAguardandoDesde(null)
        }
      } catch {
        // Uma falha de rede aqui não é notícia: a próxima volta em quinze segundos.
      }
    }, 15000)

    return () => clearInterval(interval)
  }, [publicKey, conversationId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, aguardandoDesde])

  /**
   * O TETO da espera.
   *
   * Nem toda mensagem ganha resposta: o atendimento pode ter passado para uma pessoa, a
   * franquia do mês pode ter acabado, o limite diário pode ter sido atingido. Sem teto, os
   * pontinhos giram para sempre prometendo algo que não vem — e uma promessa quebrada na
   * tela é pior do que nunca ter prometido.
   *
   * Ao expirar eles somem em silêncio. A resposta que chegar depois aparece do mesmo
   * jeito; anunciar "ninguém respondeu" seria dar por perdida uma resposta que ainda pode
   * estar a caminho.
   */
  useEffect(() => {
    if (aguardandoDesde === null) return
    const relogio = setTimeout(() => setAguardandoDesde(null), 90_000)
    return () => clearTimeout(relogio)
  }, [aguardandoDesde])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!input.trim() || !publicKey || !conversationId) return

    setSending(true)
    setNotice(null)
    const content = input
    setInput('')

    try {
      const res = await fetch(`${API_URL}/api/public/widgets/${publicKey}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, content }),
      })
      if (res.status === 429) {
        setInput(content)
        setNotice('Você atingiu o limite de mensagens por hoje. Tente novamente mais tarde.')
        return
      }
      if (!res.ok) {
        // Recuperável: o texto volta para o campo, para a pessoa não perder o que
        // escreveu. E a frase é a do SERVIDOR quando ele manda uma — ele sabe se o
        // chat foi desativado ou se o destino deixou de atender, e "tente de novo"
        // seria um conselho errado nos dois casos.
        const corpo = (await res.json().catch(() => null)) as { error?: string } | null
        setInput(content)
        setNotice(corpo?.error || 'Não foi possível enviar agora. Tente de novo.')
        return
      }

      /**
       * A mensagem do visitante aparece AGORA, com o que o servidor devolveu.
       *
       * Esperar o socket para mostrar o que a própria pessoa acabou de escrever faz o
       * chat parecer travado no momento em que ele mais precisa parecer vivo. E como a
       * inserção é por `_id`, o evento do socket que chegar depois não duplica.
       */
      // A rota devolve uma LISTA (contrato existente, mantido). Aceitar as duas formas
      // custa uma linha e evita depender do formato exato numa resposta que já é nossa.
      const corpo = await res.json().catch(() => null)
      const criadas: WidgetMessage[] = Array.isArray(corpo) ? corpo : corpo?._id ? [corpo] : []
      if (criadas.length > 0) {
        setMessages((prev) => {
          const novas = criadas.filter((c) => c?._id && !prev.some((m) => m._id === c._id))
          return novas.length > 0 ? [...prev, ...novas] : prev
        })
      }
      // A partir daqui alguém está preparando a resposta.
      // O INSTANTE, e não um sinal de liga/desliga: uma segunda pergunta durante a espera
      // reinicia o teto, em vez de herdar o relógio da primeira e sumir no meio dela.
      setAguardandoDesde(Date.now())
    } catch {
      setInput(content)
      setNotice('Não foi possível enviar agora. Tente de novo.')
    } finally {
      setSending(false)
    }
  }

  if (error) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-slate-950 p-4 text-center text-sm text-slate-400">
        {error}
      </div>
    )
  }

  if (!config) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-slate-950 text-sm text-slate-400">
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
    <div className="flex h-[100dvh] flex-col bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-4 py-3" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
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
        {aguardandoDesde !== null && <TypingDots />}
        <div ref={messagesEndRef} />
      </div>

      {notice && (
        <p className="border-t border-slate-800 px-4 py-2 text-center text-xs text-amber-400">{notice}</p>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-slate-800 p-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva uma mensagem..."
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-slate-500"
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
