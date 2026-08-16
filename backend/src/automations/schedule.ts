// Friendly recurrence → cron, derived server-side (never trust a browser clock).
// Pure and unit-tested; the reconciler feeds the cron + IANA timezone to BullMQ,
// which handles DST. (plan §10.3/§11.2)

// Os intervalos curtos existem para MONITORAMENTO: verificar um feed ou uma
// página de tempos em tempos. Eles não têm hora do dia — "a cada 15 minutos" não
// tem um "às 08:00" — e por isso são um tipo à parte em vez de um campo opcional
// no meio dos outros.
export const EVERY_MINUTES = [5, 15, 30] as const
export type EveryMinutes = (typeof EVERY_MINUTES)[number]

export type Recurrence =
  | { kind: 'minutes'; every: EveryMinutes }
  | { kind: 'hourly' }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; weekdays: number[] } // 0=Sun … 6=Sat
  | { kind: 'monthly'; time: string; day: number } // 1..31

function parseTime(time: string): { minute: number; hour: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time).trim())
  if (!m) throw new Error(`hora inválida: ${time}`)
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error(`hora fora do intervalo: ${time}`)
  return { minute, hour }
}

export function isValidRecurrence(r: unknown): r is Recurrence {
  try {
    recurrenceToCron(r as Recurrence)
    return true
  } catch {
    return false
  }
}

export function recurrenceToCron(r: Recurrence): string {
  // Estes dois não têm hora do dia, então são resolvidos antes de `parseTime` —
  // que exigiria um campo que eles não possuem.
  if (r.kind === 'minutes') {
    if (!EVERY_MINUTES.includes(r.every)) throw new Error(`intervalo inválido: ${r.every}`)
    return `*/${r.every} * * * *`
  }
  if (r.kind === 'hourly') return '0 * * * *'

  const { minute, hour } = parseTime(r.time)
  switch (r.kind) {
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly': {
      if (!Array.isArray(r.weekdays) || r.weekdays.length === 0) throw new Error('weekly requer weekdays')
      const days = [...new Set(r.weekdays)].sort((a, b) => a - b)
      if (days.some((d) => d < 0 || d > 6 || !Number.isInteger(d))) throw new Error('weekday inválido')
      return `${minute} ${hour} * * ${days.join(',')}`
    }
    case 'monthly': {
      if (!Number.isInteger(r.day) || r.day < 1 || r.day > 31) throw new Error('day inválido (1..31)')
      return `${minute} ${hour} ${r.day} * *`
    }
    default:
      throw new Error('recorrência desconhecida')
  }
}

// Human summary for the UI ("Todo dia às 08:00"), timezone shown separately.
export function describeRecurrence(r: Recurrence): string {
  if (r.kind === 'minutes') return `A cada ${r.every} minutos`
  if (r.kind === 'hourly') return 'A cada hora'
  const t = String(r.time)
  if (r.kind === 'daily') return `Todo dia às ${t}`
  if (r.kind === 'monthly') return `Todo dia ${r.day} às ${t}`
  const names = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
  return `Toda semana (${[...new Set(r.weekdays)].sort((a, b) => a - b).map((d) => names[d]).join(', ')}) às ${t}`
}

// Best-effort inverse of recurrenceToCron for the friendly patterns this module
// generates (daily / weekly / monthly at HH:MM). Returns null for anything richer,
// so the UI can fall back to showing the raw cron.
export function cronToRecurrence(cron: string): Recurrence | null {
  const parts = String(cron).trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [min, hr, dom, mon, dow] = parts

  // `*/N * * * *` e `0 * * * *` são os que os intervalos curtos geram.
  const cadaN = /^\*\/(\d+)$/.exec(min)
  if (cadaN && hr === '*' && dom === '*' && mon === '*' && dow === '*') {
    const every = Number(cadaN[1])
    return (EVERY_MINUTES as readonly number[]).includes(every) ? { kind: 'minutes', every: every as EveryMinutes } : null
  }
  if (min === '0' && hr === '*' && dom === '*' && mon === '*' && dow === '*') return { kind: 'hourly' }

  const m = Number(min)
  const h = Number(hr)
  if (!Number.isInteger(m) || !Number.isInteger(h) || m < 0 || m > 59 || h < 0 || h > 23) return null
  if (mon !== '*') return null
  const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  if (dom === '*' && dow === '*') return { kind: 'daily', time }
  if (dom !== '*' && dow === '*') {
    const day = Number(dom)
    return Number.isInteger(day) && day >= 1 && day <= 31 ? { kind: 'monthly', time, day } : null
  }
  if (dom === '*' && dow !== '*') {
    const weekdays = dow.split(',').map(Number)
    return weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ? { kind: 'weekly', time, weekdays } : null
  }
  return null
}
