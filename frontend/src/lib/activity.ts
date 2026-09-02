import { useEffect, useRef } from 'react'
import { API_URL } from './api'
import { socket } from './socket'

// A ATIVIDADE do escritório, do lado de quem olha.
//
// A lista vem de uma projeção — ela LÊ o que a execução gravou, e por isso nunca discorda
// do histórico. O tempo real usa o socket que já existe (sala do dono, autenticada): um
// evento de trilha significa "algo andou", e a lista se recarrega. Sem sondagem, sem
// endpoint novo de tempo real, e sem uma segunda contagem no cliente.

export type ActivityStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
export type ActivitySource = 'schedule' | 'webhook' | 'channel' | 'manual' | 'delegation'

export const STATUS_LABEL: Record<ActivityStatus, string> = {
  queued: 'na fila',
  running: 'rodando',
  succeeded: 'concluída',
  failed: 'falhou',
  canceled: 'cancelada',
}

export const SOURCE_LABEL: Record<ActivitySource, string> = {
  schedule: 'horário',
  webhook: 'webhook',
  channel: 'canal',
  manual: 'manual',
  delegation: 'delegação',
}

export interface ActivityStep {
  stepId: string
  stepType: string
  status: string
  durationMs: number | null
  skipReason?: string
  errorKind?: string | null
}

export interface ActivityItem {
  executionKey: string
  status: ActivityStatus
  source: ActivitySource
  environment: 'production' | 'test'
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  origin: { kind: 'monitor'; id: string; name: string; eventId: string } | { kind: 'event'; eventId: string } | null
  flow: { id: string; name: string; version: number; triggerType: string } | null
  steps: ActivityStep[]
  deliveries: number
  usage: { inputTokens: number; outputTokens: number }
  errorKind: string | null
}

export interface ActivityFilters {
  status?: ActivityStatus
  source?: ActivitySource
  floorId?: string
}

export async function listActivity(filtros: ActivityFilters = {}, before?: string): Promise<{ items: ActivityItem[]; nextBefore: string | null }> {
  const q = new URLSearchParams()
  if (filtros.status) q.set('status', filtros.status)
  if (filtros.source) q.set('source', filtros.source)
  if (filtros.floorId) q.set('floorId', filtros.floorId)
  if (before) q.set('before', before)
  const r = await fetch(`${API_URL}/api/activity?${q.toString()}`, { credentials: 'include' })
  if (!r.ok) {
    const corpo = (await r.json().catch(() => null)) as { message?: string } | null
    throw new Error(corpo?.message ?? `${r.status}`)
  }
  return (await r.json()) as { items: ActivityItem[]; nextBefore: string | null }
}

/**
 * Recarrega quando algo anda — e no máximo uma vez por segundo.
 *
 * Um evento de trilha por passo faria uma requisição por passo; a janela junta a rajada
 * de uma execução inteira em uma leitura só.
 */
export function useActivityPulse(aoMudar: () => void, janelaMs = 1000): void {
  const pendente = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cb = useRef(aoMudar)
  cb.current = aoMudar

  useEffect(() => {
    if (!socket.connected) socket.connect()
    socket.emit('join-owner')
    const aoReceber = () => {
      if (pendente.current) return
      pendente.current = setTimeout(() => {
        pendente.current = null
        cb.current()
      }, janelaMs)
    }
    socket.on('execution-trace', aoReceber)
    return () => {
      socket.off('execution-trace', aoReceber)
      if (pendente.current) clearTimeout(pendente.current)
      pendente.current = null
    }
  }, [janelaMs])
}

/** O tempo como gente lê. Sem biblioteca: são três casos. */
export function duracao(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
}

/**
 * A frase da correlação: de onde veio até onde chegou.
 *
 * É a resposta da tela para "o que aconteceu, do começo ao fim?" — e ela só cita o que a
 * projeção realmente sabe. Sem monitor, sem Flow, ela diz menos em vez de inventar.
 */
export function cadeia(item: ActivityItem): string[] {
  const partes: string[] = []
  if (item.origin?.kind === 'monitor') partes.push(`monitor ${item.origin.name}`)
  else if (item.origin?.kind === 'event') partes.push('evento da plataforma')
  else partes.push(SOURCE_LABEL[item.source] ?? item.source)
  if (item.flow) partes.push(`${item.flow.name} v${item.flow.version}`)
  if (item.steps.length) partes.push(`${item.steps.length} ${item.steps.length === 1 ? 'etapa' : 'etapas'}`)
  if (item.deliveries) partes.push(`${item.deliveries} ${item.deliveries === 1 ? 'entrega' : 'entregas'}`)
  return partes
}
