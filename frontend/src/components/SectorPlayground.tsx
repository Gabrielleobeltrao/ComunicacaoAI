import { useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { SectorMode, SectorSummary } from '../lib/types'
import { MessageContent } from './MessageContent'

/** Quem executou, e com o que na mão. Vem do servidor; nada aqui é inferido. */
export interface SectorParticipant {
  name: string
  role: 'coordinator' | 'specialist' | 'pipeline_stage'
  grounding?: string | null
  toolCalls?: number
  stage?: string
  order?: number
}

export interface SectorSource {
  documentId: string | null
  title: string | null
}

interface PlayMessage {
  role: 'user' | 'assistant'
  content: string
  participants?: SectorParticipant[]
  grounding?: string
  sources?: SectorSource[]
  warnings?: string[]
  mode?: SectorMode
}

/**
 * O que a busca de conhecimento respondeu, em uma linha.
 *
 * `unavailable` é o caso que mais importa: significa "não consegui procurar", e não
 * "não existe". Confundir os dois é o que faz um agente afirmar que não há dado sobre
 * uma base que tem o dado.
 */
const GROUNDING_LABEL: Record<string, string> = {
  ok: 'usou a base',
  empty: 'a base não tinha nada sobre isso',
  no_base: 'sem base para consultar',
  unavailable: 'a busca na base falhou — não é o mesmo que "não existe"',
}

// Conversa de teste de um setor — nada é salvo. A resposta mostra quem REALMENTE
// executou, na ordem, com o que cada um encontrou.
export function SectorPlayground({ sector }: { sector: SectorSummary }) {
  const [messages, setMessages] = useState<PlayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

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
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok && body) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: body.reply,
            participants: body.participants,
            grounding: body.grounding,
            sources: body.sources,
            warnings: body.warnings,
            mode: body.mode,
          },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            // O motivo vem do servidor como categoria; sem ele, a mensagem genérica.
            content:
              body?.problem || body?.error || 'Não foi possível gerar a resposta — verifique a chave de API em Configurações.',
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
        Conversa de teste — nada é salvo e as ferramentas que escrevem ficam bloqueadas. O time executa de verdade:
        abaixo de cada resposta está quem trabalhou e o que consultou.
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

              {message.role === 'assistant' && message.participants && message.participants.length > 0 && (
                <div className="mt-1 max-w-[85%] text-[10px] text-(--text-faint)" data-testid="sector-run-trace">
                  <span>
                    ↳ executaram:{' '}
                    {message.participants
                      .map((p) =>
                        p.stage
                          ? `${p.order}. ${p.stage} (${p.name})`
                          : p.role === 'coordinator'
                            ? `${p.name} (coordenador)`
                            : p.name,
                      )
                      .join(' · ')}
                  </span>
                </div>
              )}

              {message.role === 'assistant' && message.grounding && (
                <span
                  className={`mt-0.5 text-[10px] ${message.grounding === 'unavailable' ? 'text-amber-400' : 'text-(--text-faint)'}`}
                  data-testid="sector-run-grounding"
                >
                  ↳ conhecimento: {GROUNDING_LABEL[message.grounding] ?? message.grounding}
                </span>
              )}

              {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                <span className="mt-0.5 text-[10px] text-(--text-faint)" data-testid="sector-run-sources">
                  ↳ fontes: {message.sources.map((f) => f.title || f.documentId || 'documento').join(', ')}
                </span>
              )}

              {message.role === 'assistant' && message.warnings && message.warnings.length > 0 && (
                <span className="mt-0.5 text-[10px] text-amber-400">↳ {message.warnings.join(' · ')}</span>
              )}
            </div>
          ))}
          {sending && <p className="text-sm text-(--text-faint)">O time está trabalhando...</p>}
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
