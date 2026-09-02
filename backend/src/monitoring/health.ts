import type { MonitoringFreshness, MonitoringHealth, MonitoringSource, MonitoringTelemetry } from './types.js'

// A SAÚDE de uma fonte — calculada, nunca gravada.
//
// Um campo `health` no banco vira mentira no primeiro processo que esquece de atualizá-lo:
// a fonte para de responder às três da manhã e a tela continua verde porque ninguém rodou
// o job que muda a coluna. Aqui a saúde é derivada do que se sabe agora — última leitura,
// falhas seguidas e a janela de validade que a própria fonte declarou.
//
// `degraded` existe porque "online" e "offline" não descrevem o caso mais comum: a fonte
// responde, mas o dado é velho demais para decidir alguma coisa.

export interface HealthView {
  health: MonitoringHealth
  /** Em português, para a tela não precisar traduzir estado em frase. */
  reason: string
  /** Quando o dado deixou (ou vai deixar) de valer. */
  staleAt: Date | null
  ageMs: number | null
}

/** Quantas falhas seguidas até parar de chamar de "online". Uma pode ser azar; três é padrão. */
export const FALHAS_PARA_DEGRADAR = 3

export function computeHealth(
  source: Pick<MonitoringSource, 'status' | 'telemetry' | 'freshness'>,
  agora: Date = new Date(),
): HealthView {
  const t: MonitoringTelemetry = source.telemetry
  const f: MonitoringFreshness = source.freshness

  if (source.status === 'paused') return { health: 'paused', reason: 'pausada por quem administra', staleAt: null, ageMs: null }
  if (source.status === 'draft') return { health: 'paused', reason: 'ainda é rascunho: não foi ativada', staleAt: null, ageMs: null }

  if (!t.lastOkAt) {
    // Nunca leu: dizer "online" seria afirmar sobre algo que não aconteceu.
    return {
      health: 'never_read',
      reason: t.lastErrorAt ? `nunca leu com sucesso (último erro: ${t.lastErrorCode ?? 'desconhecido'})` : 'ainda não leu nenhuma vez',
      staleAt: null,
      ageMs: null,
    }
  }

  const ageMs = agora.getTime() - t.lastOkAt.getTime()
  const staleAt = f.staleAfterMs > 0 ? new Date(t.lastOkAt.getTime() + f.staleAfterMs) : null

  if (t.consecutiveFailures >= FALHAS_PARA_DEGRADAR) {
    return { health: 'degraded', reason: `${t.consecutiveFailures} falhas seguidas`, staleAt, ageMs }
  }
  if (staleAt && agora > staleAt) {
    // O caso que "online/offline" não descreve: responde, mas o dado já não vale.
    return { health: 'degraded', reason: `a última leitura boa tem ${Math.round(ageMs / 60_000)} min`, staleAt, ageMs }
  }
  return { health: 'online', reason: 'lendo dentro da janela', staleAt, ageMs }
}

/**
 * Quando esta fonte lê de novo — para a Visão geral dizer "próximo disparo".
 *
 * Fonte que empurra não tem próximo: ela não é chamada, ela chega. Devolver um horário
 * inventado ali seria a tela prometendo um evento que ninguém agendou.
 */
export function nextReadAt(source: Pick<MonitoringSource, 'cadence' | 'status' | 'telemetry'>, agora: Date = new Date()): Date | null {
  if (source.status !== 'active') return null
  if (source.cadence.mode !== 'interval') return null
  const intervalo = source.cadence.intervalMs ?? 0
  if (intervalo <= 0) return null
  const base = source.telemetry.lastReadAt ?? agora
  /**
   * O instante VERDADEIRO, mesmo quando ele já passou.
   *
   * A primeira versão empurrava um horário atrasado para o futuro, para a tela não mostrar
   * o passado — e com isso a varredura nunca considerava vencida uma fonte atrasada: ela
   * ficava parada para sempre, com o painel prometendo uma leitura que não vinha. Quem
   * mostra é que arredonda; quem decide precisa da verdade.
   */
  return new Date(base.getTime() + intervalo)
}

/** Está vencida? A pergunta que a varredura faz, escrita uma vez. */
export const isDue = (source: Pick<MonitoringSource, 'cadence' | 'status' | 'telemetry'>, agora: Date = new Date()): boolean => {
  const proximo = nextReadAt(source, agora)
  return proximo !== null && proximo <= agora
}

/**
 * O ATRASO da próxima tentativa depois de uma falha — com jitter.
 *
 * Sem o jitter, cem fontes que caíram juntas voltam juntas, e a primeira tentativa depois
 * de um incidente vira o segundo incidente. O aleatório entra como parâmetro para o teste
 * poder medir a fórmula em vez de medir a sorte.
 */
export function backoffDelay(
  retry: Pick<MonitoringSource['retry'], 'backoffMs' | 'jitterRatio' | 'maxAttempts'>,
  tentativa: number,
  aleatorio: () => number = Math.random,
): number {
  const n = Math.max(1, Math.min(tentativa, retry.maxAttempts))
  const base = retry.backoffMs * 2 ** (n - 1)
  const teto = Math.min(base, 15 * 60_000)
  const ratio = Math.min(1, Math.max(0, retry.jitterRatio))
  /**
   * O jitter subtrai — mas nunca abaixo do backoff base.
   *
   * Sem o piso, uma razão alta transforma a terceira tentativa numa espera menor que a
   * primeira: o "aleatório" vira rajada justo quando o outro lado está pedindo calma. O
   * piso é o degrau inicial, que é a menor espera que alguém configurou de propósito.
   */
  const comJitter = teto - teto * ratio * aleatorio()
  return Math.round(Math.max(retry.backoffMs, comJitter))
}
