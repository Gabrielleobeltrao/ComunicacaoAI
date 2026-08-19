import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import { novaTrilha, useExecutionTrace } from '../lib/executionTrace'
import { ExecutionTrace } from './ExecutionTrace'
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
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  provider?: string | null
  model?: string | null
  /** Por que este modelo, quando a escolha foi automática. */
  modelReason?: string | null
}

export interface SectorSource {
  documentId: string | null
  title: string | null
}

interface PlayMessage {
  role: 'user' | 'assistant'
  content: string
  /** Este turno é uma PERGUNTA do time — a marca volta no próximo envio, para o teto valer. */
  clarification?: boolean
  clarificationOptions?: string[]
  participants?: SectorParticipant[]
  grounding?: string
  sources?: SectorSource[]
  warnings?: string[]
  mode?: SectorMode
  usage?: { inputTokens: number; outputTokens: number }
  durationMs?: number
  executionId?: string
}

const duracao = (ms?: number): string => {
  if (!ms || ms < 0) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
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

// Conversa de teste de um setor: fica salva, e a resposta mostra quem REALMENTE executou,
// na ordem, com o que cada um encontrou. Aqui guardar pesa mais do que num agente só —
// cada repetição de pergunta acorda o time inteiro.
export function SectorPlayground({ sector }: { sector: SectorSummary }) {
  const [messages, setMessages] = useState<PlayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [limpando, setLimpando] = useState(false)
  // A trilha é criada ANTES do envio: é o que permite o painel acompanhar sem esperar a
  // resposta final. Um id por envio — a execução anterior fica no histórico do painel.
  const [traceId, setTraceId] = useState<string | null>(null)
  const trilha = useExecutionTrace(traceId)

  useEffect(() => {
    let vivo = true
    fetch(`${API_URL}/api/sectors/${sector._id}/playground`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { turns: [] }))
      .then((corpo) => {
        if (!vivo || !Array.isArray(corpo?.turns)) return
        // O rastro por agente foi guardado dentro de `diagnostics`; aqui ele volta a ser
        // o que a tela lê.
        setMessages(
          corpo.turns.map((t: Record<string, unknown>) => {
            const d = (t.diagnostics ?? {}) as Record<string, unknown>
            return {
              role: t.role as 'user' | 'assistant',
              content: String(t.content ?? ''),
              clarification: Boolean(t.clarification),
              clarificationOptions: (t.clarificationOptions as string[]) ?? [],
              participants: (d.participants as SectorParticipant[]) ?? undefined,
              grounding: (d.grounding as string) ?? undefined,
              sources: (d.sources as SectorSource[]) ?? undefined,
              executionId: (d.executionId as string) ?? undefined,
            }
          }),
        )
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [sector._id])

  async function limpar() {
    setLimpando(true)
    try {
      await fetch(`${API_URL}/api/sectors/${sector._id}/playground`, { method: 'DELETE', credentials: 'include' })
      setMessages([])
    } finally {
      setLimpando(false)
    }
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault()
    if (!input.trim() || sending) return
    const next: PlayMessage[] = [...messages, { role: 'user', content: input.trim() }]
    setMessages(next)
    setInput('')
    setSending(true)
    // Uma trilha por envio, criada antes do pedido sair.
    const novoTrace = novaTrilha()
    setTraceId(novoTrace)
    try {
      const res = await fetch(`${API_URL}/api/sectors/${sector._id}/playground`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // A marca volta junto: é dela que sai a contagem de quantas vezes o time já
        // perguntou nesta conversa, e é o que impede a pergunta de virar laço.
        body: JSON.stringify({
          traceId: novoTrace,
          messages: next.map(({ role, content, clarification, clarificationOptions }) => ({
            role,
            content,
            ...(clarification ? { clarification } : {}),
            ...(clarificationOptions?.length ? { clarificationOptions } : {}),
          })),
        }),
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
            usage: body.usage,
            durationMs: body.durationMs,
            executionId: body.executionId,
            clarification: Boolean(body.clarification),
            clarificationOptions: body.clarification?.options ?? [],
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-(--text-faint)">
          Conversa de teste — fica salva aqui, e as ferramentas que escrevem ficam bloqueadas. O time
          executa de verdade: abaixo de cada resposta está quem trabalhou e o que consultou.
        </p>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => void limpar()}
            disabled={limpando}
            data-testid="sector-playground-clear"
            className="rounded-lg border border-(--border-strong) px-2.5 py-1 text-xs text-(--text-muted) transition hover:text-(--text-heading) disabled:opacity-50"
          >
            Limpar conversa
          </button>
        )}
      </div>
      {/* Mesma contenção do chat de agente: a largura do chat vem da página, nunca do
          que o time respondeu. Aqui pesa ainda mais, porque a tabela de participantes
          tem uma linha por agente. */}
      <div className="grid gap-3 lg:grid-cols-2" style={{ gridTemplateColumns: undefined }} data-testid="playground-with-trace">
        <div
          className="flex h-96 min-w-0 flex-col rounded-lg border border-(--border-subtle) bg-(--surface-card)/50"
          style={{ contain: 'inline-size' }}
        >
        <div className="flex-1 space-y-2 overflow-y-auto p-3" data-testid="sector-playground-messages">
          {messages.length === 0 && (
            <p className="text-sm text-(--text-muted)">Envie uma mensagem como se fosse o visitante.</p>
          )}
          {messages.map((message, index) => (
            <div key={index} className={message.role === 'user' ? '' : 'flex flex-col items-start'}>
              <div
                className={
                  message.role === 'user'
                    ? 'ml-auto max-w-[85%] min-w-0 break-words rounded-2xl rounded-tr-sm bg-(--intent-brand) px-3 py-2 text-sm text-white'
                    : 'max-w-[85%] min-w-0 break-words rounded-2xl rounded-tl-sm bg-(--surface-sunken) px-3 py-2 text-sm'
                }
              >
                <MessageContent content={message.content} />
              </div>

              {message.role === 'assistant' && message.participants && message.participants.length > 0 && (
                <details className="mt-1 w-full max-w-[95%] rounded-lg border border-(--border-subtle) bg-(--surface-card)/60 px-2 py-1" data-testid="sector-run-trace">
                  <summary className="cursor-pointer text-[11px] text-(--text-muted)">
                    {message.participants.length === 1 ? '1 agente executou' : `${message.participants.length} agentes executaram`}
                    {message.usage ? ` · ${message.usage.inputTokens + message.usage.outputTokens} tokens` : ''}
                    {message.durationMs ? ` · ${duracao(message.durationMs)}` : ''}
                  </summary>
                  {/* O registro da execução, agente por agente. Números e status — nunca
                      o prompt, o texto da base ou a resposta de cada um. */}
                  <div className="mt-1 overflow-x-auto">
                    <table className="w-full text-left text-[10px] text-(--text-faint)">
                      <thead className="text-(--text-muted)">
                        <tr>
                          <th className="pr-2 font-medium">#</th>
                          <th className="pr-2 font-medium">Agente</th>
                          <th className="pr-2 font-medium">Papel</th>
                          <th className="pr-2 font-medium">Modelo</th>
                          <th className="pr-2 font-medium">Tokens</th>
                          <th className="pr-2 font-medium">Tempo</th>
                          <th className="pr-2 font-medium">Ferr.</th>
                          <th className="font-medium">Base</th>
                        </tr>
                      </thead>
                      <tbody data-testid="sector-run-rows">
                        {message.participants.map((p, i) => (
                          <tr key={`${p.name}-${i}`}>
                            <td className="pr-2 py-0.5">{p.order ?? i + 1}</td>
                            <td className="pr-2 py-0.5 text-(--text-body)">{p.name}</td>
                            <td className="pr-2 py-0.5">{p.stage ?? (p.role === 'coordinator' ? 'coordenador' : 'especialista')}</td>
                            {/* O motivo entra como título: com "Automático" o modelo
                                muda de agente para agente, e o porquê é o que torna a
                                escolha conferível em vez de mágica. */}
                            <td className="pr-2 py-0.5" title={p.modelReason ?? undefined}>
                              {p.model || p.provider || '—'}
                              {p.modelReason ? ' *' : ''}
                            </td>
                            <td className="pr-2 py-0.5">{(p.inputTokens ?? 0) + (p.outputTokens ?? 0)}</td>
                            <td className="pr-2 py-0.5">{duracao(p.durationMs)}</td>
                            <td className="pr-2 py-0.5">{p.toolCalls ?? 0}</td>
                            <td className="py-0.5">{p.grounding ? (GROUNDING_LABEL[p.grounding] ?? p.grounding) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
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
        <ExecutionTrace events={trilha.events} live={trilha.live} onClear={trilha.clear} />
      </div>
    </div>
  )
}
