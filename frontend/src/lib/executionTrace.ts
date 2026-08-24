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
  type:
    | 'user_prompt'
    | 'orchestration_start'
    | 'planner'
    | 'agent'
    | 'delegation'
    | 'tool'
    | 'rag'
    /** PROCURAR na internet — separado de `rag`: aquilo é local e de graça, isto custa. */
    | 'web_search'
    | 'synthesis'
    | 'sufficiency'
    | 'orchestration_end'
    | 'final'
    | 'error'
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

export type TraceFilter = 'all' | 'planner' | 'agents' | 'tools' | 'rag' | 'web' | 'errors'

const POR_FILTRO: Record<Exclude<TraceFilter, 'all' | 'errors'>, TraceEvent['type'][]> = {
  planner: ['planner', 'sufficiency', 'orchestration_start', 'orchestration_end'],
  agents: ['agent', 'delegation', 'synthesis'],
  tools: ['tool'],
  rag: ['rag'],
  /**
   * A busca tem filtro PRÓPRIO.
   *
   * Dentro de "Base" ela ficava misturada à leitura do que já estava guardado — e quem
   * abre o painel querendo saber "ele foi para a internet?" tinha que ler evento por
   * evento para descobrir quais dos itens de "Base" eram, na verdade, uma ida para fora.
   */
  web: ['web_search'],
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

// --- a auditoria de uma execução, lida da MESMA trilha ------------------------------------
//
// Nada aqui busca nada: os eventos já chegaram, e o que falta é lê-los como quem investiga
// em vez de como quem acompanha. As perguntas são sempre as mesmas quando algo dá errado —
// quem trabalhou, com que contrato, de onde vieram os campos, o que foi validado, e quanto
// custou cada tipo de executor. Elas estavam todas espalhadas por uma pilha de eventos.

export type ExecutorKind = 'llm' | 'function' | 'tool'

export interface StepAudit {
  stepId: string
  agentId: string
  title: string
  status: TraceEvent['status']
  executorKind: ExecutorKind
  /** A referência do que rodou: modelo, função@versão, ou app.ação. */
  ran: string
  capability: string
  dependsOn: string[]
  inputOrigins: string[]
  inputValid?: boolean
  outputValid?: boolean
  hasStructured?: boolean
  hasText?: boolean
  /** Precisou de uma correção de formato — uma inferência a mais, paga. */
  repaired: boolean
  error?: string
  field?: string
  durationMs: number
  tokens: number
}

export interface PlanAudit {
  planId: string
  round: number
  source: string
  steps: {
    taskId: string
    name: string
    executorKind: string
    dependsOn: string[]
    inputOrigins: string[]
    onFailure: string
    objective: string
  }[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const lista = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(/[, ]+/).filter(Boolean) : []

/** O que cada etapa executou — uma linha por etapa que produziu um desfecho. */
export function auditarEtapas(eventos: TraceEvent[]): StepAudit[] {
  const finais = eventos.filter(
    (e) => e.type === 'agent' && e.status !== 'running' && str((e.metadata as Record<string, unknown>)?.stepId),
  )
  return finais.map((e) => {
    const m = (e.metadata ?? {}) as Record<string, unknown>
    const kind = (str(m.executorKind) || 'llm') as ExecutorKind
    const uso = m.usage as { inputTokens?: number; outputTokens?: number } | undefined
    return {
      stepId: str(m.stepId),
      agentId: str(m.agentId),
      title: e.title,
      status: e.status,
      executorKind: kind,
      ran:
        kind === 'function'
          ? `${str(m.functionName)}${str(m.functionVersion) ? `@${str(m.functionVersion)}` : ''}`
          : kind === 'tool'
            ? [str(m.appKey), str(m.actionKey)].filter(Boolean).join('.') || str(m.toolId)
            : str(e.model) || str(m.model) || str(m.provider),
      capability: str(m.capability),
      dependsOn: lista(m.dependsOn),
      inputOrigins: lista(m.inputOrigins),
      ...(typeof m.inputValid === 'boolean' ? { inputValid: m.inputValid } : {}),
      ...(typeof m.outputValid === 'boolean' ? { outputValid: m.outputValid } : {}),
      ...(typeof m.hasStructured === 'boolean' ? { hasStructured: m.hasStructured } : {}),
      ...(typeof m.hasText === 'boolean' ? { hasText: m.hasText } : {}),
      repaired: m.outputRepaired === true,
      ...(str(m.error) ? { error: str(m.error) } : {}),
      ...(str(m.field) ? { field: str(m.field) } : {}),
      durationMs: typeof m.durationMs === 'number' ? m.durationMs : (e.durationMs ?? 0),
      tokens: (uso?.inputTokens ?? 0) + (uso?.outputTokens ?? 0),
    }
  })
}

/** Os planos desta execução — um por rodada. */
export function auditarPlanos(eventos: TraceEvent[]): PlanAudit[] {
  return eventos
    .filter((e) => e.type === 'planner' && (e.metadata as Record<string, unknown>)?.selected)
    .map((e) => {
      const m = e.metadata as Record<string, unknown>
      const selected = Array.isArray(m.selected) ? (m.selected as Record<string, unknown>[]) : []
      return {
        planId: str(m.planId),
        round: typeof m.round === 'number' ? m.round : 1,
        source: str(m.source),
        steps: selected.map((t) => ({
          taskId: str(t.taskId),
          name: str(t.name),
          executorKind: str(t.executorKind) || 'llm',
          dependsOn: lista(t.dependsOn),
          inputOrigins: lista(t.inputOrigins),
          onFailure: str(t.onFailure) || 'skip',
          objective: str(t.objective),
        })),
      }
    })
}

export interface CustoPorTipo {
  executorKind: ExecutorKind
  etapas: number
  tokens: number
  durationMs: number
}

/**
 * O que cada TIPO de executor custou nesta execução.
 *
 * É a comparação que justifica a arquitetura inteira, e ela não existia: sem separar por
 * tipo, uma função determinística e uma inferência aparecem como "duas etapas" — e a
 * diferença entre zero token e uma chamada paga fica invisível justamente para quem
 * decide se vale a pena tirar um trabalho do modelo.
 */
export function custoPorTipo(eventos: TraceEvent[]): CustoPorTipo[] {
  const por = new Map<ExecutorKind, CustoPorTipo>()
  for (const etapa of auditarEtapas(eventos)) {
    const atual = por.get(etapa.executorKind) ?? { executorKind: etapa.executorKind, etapas: 0, tokens: 0, durationMs: 0 }
    atual.etapas += 1
    atual.tokens += etapa.tokens
    atual.durationMs += etapa.durationMs
    por.set(etapa.executorKind, atual)
  }
  return [...por.values()].sort((a, b) => b.tokens - a.tokens || b.durationMs - a.durationMs)
}
