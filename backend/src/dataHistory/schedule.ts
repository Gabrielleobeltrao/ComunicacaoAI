import { ValidationError } from '../building.js'
import { nextFireAt } from '../automations/scheduleClock.js'
import type { DataRecorderDefinition, RecorderSchedule } from './types.js'

/**
 * A agenda de um retrato periódico — pelo relógio que o produto já tem.
 *
 * `cron` + `timezone` IANA são exatamente o que as rotinas usam, lidos pelo mesmo
 * `scheduleClock`. Nenhum relógio novo: um segundo jeito de dizer "toda terça às 7h"
 * seria um segundo lugar para o horário de verão estar errado.
 */

/**
 * A agenda ANTIGA continua funcionando.
 *
 * Os primeiros históricos foram gravados com `{ hour, minute }` em UTC. Eles existem no
 * banco de quem já configurou, e migrar por script obrigaria a parar tudo para uma
 * mudança que a leitura resolve: aqui, o formato velho é traduzido no momento em que é
 * lido. Um documento antigo nunca precisa ser reescrito para continuar disparando.
 */
export function agendaDoRecorder(recorder: Pick<DataRecorderDefinition, 'schedule'>): RecorderSchedule | null {
  const s = recorder.schedule as (RecorderSchedule & { hour?: number; minute?: number }) | null
  if (!s) return null
  if (typeof s.cron === 'string' && s.cron.trim()) return { cron: s.cron.trim(), timezone: s.timezone?.trim() || 'UTC' }
  if (Number.isInteger(s.hour) && Number.isInteger(s.minute)) {
    // O formato velho sempre foi UTC — dizer outra coisa mudaria a hora de disparo de
    // quem já configurou.
    return { cron: `${s.minute} ${s.hour} * * *`, timezone: 'UTC' }
  }
  return null
}

/** Um fuso que o próprio ambiente reconhece. Nada de lista nossa para ficar velha. */
export function fusoValido(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Normaliza o que veio da tela — recorrência amigável ou cron cru.
 *
 * A tela oferece "a cada hora", "todo dia às 7h" e "seg/qua/sex às 18h" porque é assim
 * que a pessoa pensa; tudo vira cron, que é o que o relógio entende. O campo avançado
 * aceita cron direto para quem precisa de algo que os atalhos não cobrem.
 */
export function normalizarAgenda(bruto: unknown): RecorderSchedule {
  const s = (bruto ?? {}) as Record<string, unknown>

  // Formato velho chegando pela API: aceito e traduzido, como na leitura.
  if (s.cron === undefined && Number.isInteger(Number(s.hour)) && Number.isInteger(Number(s.minute))) {
    const hour = Number(s.hour)
    const minute = Number(s.minute)
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new ValidationError('agenda: hora entre 0 e 23 e minuto entre 0 e 59.')
    return { cron: `${minute} ${hour} * * *`, timezone: 'UTC' }
  }

  const cron = String(s.cron ?? '').trim()
  if (!cron) throw new ValidationError('agenda: informe quando o retrato deve ser tirado.')
  if (cron.length > 100) throw new ValidationError('agenda: expressão longa demais.')
  const timezone = String(s.timezone ?? 'UTC').trim() || 'UTC'
  if (!fusoValido(timezone)) throw new ValidationError(`agenda: fuso horário desconhecido — "${timezone}".`)

  // A prova de que a expressão serve é ela PRODUZIR um próximo disparo. Uma validação
  // por regex aceitaria coisas que o relógio recusa depois, em silêncio, num laço.
  if (!nextFireAt(cron, timezone, new Date())) throw new ValidationError('agenda: não consegui entender essa recorrência.')

  // E um teto: um retrato a cada minuto é quase sempre engano de quem configurou, e
  // vira meio milhão de linhas por ano sem ninguém pedir.
  const primeiro = nextFireAt(cron, timezone, new Date())!
  const segundo = nextFireAt(cron, timezone, primeiro)
  if (segundo && segundo.getTime() - primeiro.getTime() < 5 * 60_000) {
    throw new ValidationError('agenda: no mínimo 5 minutos entre um retrato e o próximo. Para intervalos curtos, use "De tempos em tempos".')
  }
  return { cron, timezone }
}
