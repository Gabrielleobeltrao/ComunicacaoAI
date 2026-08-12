// Friendly recurrence → cron, derived server-side (never trust a browser clock).
// Pure and unit-tested; the reconciler feeds the cron + IANA timezone to BullMQ,
// which handles DST. (plan §10.3/§11.2)

export type Recurrence =
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
  const t = String(r.time)
  if (r.kind === 'daily') return `Todo dia às ${t}`
  if (r.kind === 'monthly') return `Todo dia ${r.day} às ${t}`
  const names = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
  return `Toda semana (${[...new Set(r.weekdays)].sort((a, b) => a - b).map((d) => names[d]).join(', ')}) às ${t}`
}
