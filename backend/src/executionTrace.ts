// O caminho que a execução percorreu — para quem está olhando, enquanto acontece.
//
// O log do servidor já contava essa história, mas para quem tem acesso ao servidor. Quem
// testa um agente via um texto aparecer no fim e nada sobre como ele chegou ali: qual
// especialista foi escolhido, o que foi pedido a ele, o que a base devolveu, onde a coisa
// demorou. Diagnosticar isso significava pedir o log a alguém.
//
// Este módulo é o outro lado do mesmo fato: os mesmos momentos, num formato que a tela
// entende. Dois destinos, um evento — e por isso o `executionId` é o mesmo dos dois lados.
//
// O QUE NUNCA ENTRA AQUI: chave, credencial, cabeçalho de autorização, prompt de sistema
// e raciocínio privado do modelo. O que entra é o que ACONTECEU — decisão, instrução
// operacional, resultado — e o que entra é cortado, porque um painel não é um arquivo.
export type TraceEventType =
  | 'user_prompt'
  | 'orchestration_start'
  | 'planner'
  | 'agent'
  | 'delegation'
  | 'tool'
  | 'rag'
  | 'synthesis'
  | 'sufficiency'
  | 'orchestration_end'
  | 'final'
  | 'error'

export type TraceStatus = 'queued' | 'running' | 'success' | 'error' | 'skipped' | 'info'

export interface ExecutionTraceEvent {
  /** A chave que liga tudo: a mesma nos dois lados, servidor e tela. */
  executionId: string
  timestamp: string
  type: TraceEventType
  status?: TraceStatus
  agentId?: string
  provider?: string | null
  model?: string | null
  /** Uma linha, legível por gente. É o que aparece fechado. */
  title: string
  input?: unknown
  output?: unknown
  metadata?: Record<string, unknown>
  durationMs?: number
}

/** O evento como quem emite escreve — o resto o módulo preenche. */
export type TraceInput = Omit<ExecutionTraceEvent, 'timestamp'> & { ownerId: string; timestamp?: string }

/** Quantos eventos por execução ficam guardados para quem chegar atrasado. */
const MAX_EVENTOS = 300
/** Quantas execuções ficam na memória. Um painel aberto é sempre a última. */
const MAX_EXECUCOES = 40
/** Um preview é um preview: texto além disto é cortado. */
const MAX_TEXTO = 1200

interface Trilha {
  ownerId: string
  eventos: ExecutionTraceEvent[]
  atualizadoEm: number
}

const trilhas = new Map<string, Trilha>()

// --- higiene ---------------------------------------------------------------------------
//
// A allowlist é do lado de quem EMITE: quem chama decide o que mandar. Aqui fica a última
// linha, que trata o que nenhum chamador deveria mandar mas um dia manda.

const CHAVES_PROIBIDAS = /^(authorization|api[-_]?key|apikey|token|secret|password|senha|credential|cookie|x-api-key)$/i
const VALOR_SUSPEITO = /\b(sk-[a-z0-9-]{10,}|bearer\s+[a-z0-9._-]{10,})/i

export function sanitize(valor: unknown, profundidade = 0): unknown {
  if (valor === null || valor === undefined) return valor
  if (typeof valor === 'string') {
    const limpo = VALOR_SUSPEITO.test(valor) ? '[removido]' : valor
    return limpo.length > MAX_TEXTO ? `${limpo.slice(0, MAX_TEXTO)}… (+${limpo.length - MAX_TEXTO} caracteres)` : limpo
  }
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor
  if (profundidade >= 4) return '[…]'
  if (Array.isArray(valor)) return valor.slice(0, 30).map((v) => sanitize(v, profundidade + 1))
  if (typeof valor === 'object') {
    const saida: Record<string, unknown> = {}
    for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
      if (CHAVES_PROIBIDAS.test(chave)) continue
      saida[chave] = sanitize(v, profundidade + 1)
    }
    return saida
  }
  return String(valor)
}

// --- emissão ---------------------------------------------------------------------------

type Sink = (evento: ExecutionTraceEvent, ownerId: string) => void
let sink: Sink | null = null

/**
 * Onde os eventos são entregues ao vivo. Injetado por quem tem o transporte (o socket),
 * para este módulo não conhecer HTTP nem socket — e para o teste poder observar.
 */
export function onTraceEvent(fn: Sink | null): void {
  sink = fn
}

export function traceEvent(entrada: TraceInput): ExecutionTraceEvent {
  const { ownerId, ...resto } = entrada
  const evento: ExecutionTraceEvent = {
    ...resto,
    timestamp: entrada.timestamp ?? new Date().toISOString(),
    title: String(resto.title ?? '').slice(0, 300),
    ...(resto.input !== undefined ? { input: sanitize(resto.input) } : {}),
    ...(resto.output !== undefined ? { output: sanitize(resto.output) } : {}),
    ...(resto.metadata !== undefined ? { metadata: sanitize(resto.metadata) as Record<string, unknown> } : {}),
  }

  const trilha = trilhas.get(evento.executionId) ?? { ownerId, eventos: [], atualizadoEm: 0 }
  trilha.eventos.push(evento)
  if (trilha.eventos.length > MAX_EVENTOS) trilha.eventos.splice(0, trilha.eventos.length - MAX_EVENTOS)
  trilha.atualizadoEm = Date.now()
  trilhas.set(evento.executionId, trilha)
  // A memória não cresce sozinha: a execução mais antiga sai quando entra uma nova.
  if (trilhas.size > MAX_EXECUCOES) {
    const maisVelha = [...trilhas.entries()].sort((a, b) => a[1].atualizadoEm - b[1].atualizadoEm)[0]
    if (maisVelha) trilhas.delete(maisVelha[0])
  }

  try {
    sink?.(evento, ownerId)
  } catch {
    // Observabilidade nunca derruba a execução que ela observa.
  }
  return evento
}

/**
 * O que já aconteceu nesta execução — para quem abriu o painel no meio, ou recarregou.
 *
 * Escopo de dono: uma execução de outra conta não existe para quem pergunta, e o id ser
 * adivinhável não pode virar uma janela para a execução alheia.
 */
export function readTrace(executionId: string, ownerId: string): ExecutionTraceEvent[] {
  const trilha = trilhas.get(executionId)
  return trilha && trilha.ownerId === ownerId ? [...trilha.eventos] : []
}

export function clearTrace(executionId?: string): void {
  if (executionId) trilhas.delete(executionId)
  else trilhas.clear()
}

/** Um recorte de texto para o painel — o resto fica no registro da execução. */
export const preview = (texto: string | null | undefined, max = 400): string => {
  const limpo = (texto ?? '').trim()
  return limpo.length > max ? `${limpo.slice(0, max)}…` : limpo
}
