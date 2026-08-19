import { useEffect, useRef, useState } from 'react'
import { API_URL } from './api'
import { socket } from './socket'

// O caminho que a execução percorreu, do lado de quem olha.
//
// A trilha é criada AQUI, antes de mandar a pergunta: é o que permite acompanhar sem
// esperar a resposta final. O servidor usa o mesmo id para emitir, e o `executionId`
// real da execução vai junto no primeiro evento — os dois lados falam do mesmo fato.

export interface TraceEvent {
  executionId: string
  timestamp: string
  type: 'user_prompt' | 'orchestration_start' | 'planner' | 'agent' | 'delegation' | 'tool' | 'rag' | 'synthesis' | 'sufficiency' | 'orchestration_end' | 'final' | 'error'
  status?: 'queued' | 'running' | 'success' | 'error' | 'skipped' | 'info'
  agentId?: string
  provider?: string | null
  model?: string | null
  title: string
  input?: unknown
  output?: unknown
  metadata?: Record<string, unknown>
  durationMs?: number
}

/** Um id de trilha por envio. Curto e opaco: ele não identifica nada além de si mesmo. */
export const novaTrilha = (): string =>
  `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * Ouve a trilha ao vivo.
 *
 * Pelo socket que já existe (sala do dono, autenticada) — sem sondagem. E, ao começar,
 * uma leitura do que já aconteceu: quem abriu o painel no meio, ou recarregou, não perde
 * o começo.
 */
export function useExecutionTrace(traceId: string | null): { events: TraceEvent[]; live: boolean; clear: () => void } {
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [live, setLive] = useState(false)
  const atual = useRef<string | null>(null)

  useEffect(() => {
    atual.current = traceId
    if (!traceId) return
    setLive(true)
    if (!socket.connected) socket.connect()
    socket.emit('join-owner')

    let vivo = true
    // O que já passou, para quem chegou depois.
    fetch(`${API_URL}/api/executions/${traceId}/trace`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((corpo) => {
        if (vivo && Array.isArray(corpo?.events) && corpo.events.length > 0) {
          setEvents((antes) => (antes.length > 0 ? antes : corpo.events))
        }
      })
      .catch(() => {})

    const aoReceber = (evento: TraceEvent) => {
      if (evento.executionId !== atual.current) return
      setEvents((antes) => [...antes, evento])
      // O fim da execução é um evento como outro qualquer — é ele que apaga o "ao vivo".
      if (evento.type === 'final' || evento.type === 'orchestration_end') setLive(false)
    }
    socket.on('execution-trace', aoReceber)
    return () => {
      vivo = false
      socket.off('execution-trace', aoReceber)
    }
  }, [traceId])

  return { events, live, clear: () => setEvents([]) }
}

// --- as contas do painel, puras -------------------------------------------------------------
//
// Fora do componente porque são regras, não desenho: o que cada filtro mostra, quanto a
// execução levou e quanto custou. Assim dá para testá-las sem montar uma tela.

export type TraceFilter = 'all' | 'planner' | 'agents' | 'tools' | 'rag' | 'errors'

const POR_FILTRO: Record<Exclude<TraceFilter, 'all' | 'errors'>, TraceEvent['type'][]> = {
  planner: ['planner', 'sufficiency', 'orchestration_start', 'orchestration_end'],
  agents: ['agent', 'delegation', 'synthesis'],
  tools: ['tool'],
  rag: ['rag'],
}

export function filtrarEventos(eventos: TraceEvent[], filtro: TraceFilter): TraceEvent[] {
  if (filtro === 'all') return eventos
  // "Erros" atravessa os tipos: o que se procura é o que deu errado, seja onde for.
  if (filtro === 'errors') return eventos.filter((e) => e.status === 'error')
  const tipos = POR_FILTRO[filtro]
  return eventos.filter((e) => tipos.includes(e.type))
}

/** O tempo total sai dos extremos da própria trilha, não de um cronômetro à parte. */
export function duracaoTotal(eventos: TraceEvent[]): number {
  if (eventos.length < 2) return 0
  const inicio = new Date(eventos[0].timestamp).getTime()
  const fim = new Date(eventos[eventos.length - 1].timestamp).getTime()
  return Number.isNaN(inicio) || Number.isNaN(fim) ? 0 : Math.max(0, fim - inicio)
}

/** Os tokens que os provedores relataram. Zero quando nenhum relatou — não se estima. */
export function tokensDaTrilha(eventos: TraceEvent[]): number {
  return eventos.reduce((soma, e) => {
    const uso = (e.metadata as { usage?: { inputTokens?: number; outputTokens?: number } } | undefined)?.usage
    return soma + (uso?.inputTokens ?? 0) + (uso?.outputTokens ?? 0)
  }, 0)
}

export const formatarDuracao = (ms?: number): string =>
  ms === undefined || ms === null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
