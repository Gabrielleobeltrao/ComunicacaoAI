// Executar a fórmula de um agente.
//
// Mesma forma dos outros executores: valida a entrada, roda com teto, valida a saída,
// devolve dado. A diferença é onde o "código" mora — aqui ele está no documento do agente,
// e isso só é seguro porque a linguagem não tem capacidade nenhuma além de calcular (ver
// `formula.ts`). Guardar JavaScript no mesmo lugar seria execução arbitrária com outro
// nome; guardar uma fórmula é guardar dados.
import { compilarFormula, executarFormula } from './formula.js'
import type { FormulaExecutorConfig } from './types.js'
import type { ExecutorResult } from './types.js'

const falha = (message: string, comecou: number, metadata: Record<string, unknown> = {}): ExecutorResult => ({
  ok: false,
  metadata,
  telemetry: { durationMs: Date.now() - comecou },
  error: { kind: 'invalid_input', message },
})

export async function executeFormula(config: FormulaExecutorConfig, input: unknown): Promise<ExecutorResult> {
  const comecou = Date.now()
  const compilada = compilarFormula(config.expression ?? '')
  if (!compilada.ok || !compilada.compilada) {
    // Não deveria acontecer: a fórmula é conferida na gravação. Se acontecer, é um
    // documento antigo ou editado por fora — e a linha errada é o que permite consertar.
    const e = compilada.errors[0]
    return falha(`A fórmula deste agente não compila (linha ${e?.line ?? 1}: ${e?.message ?? 'inválida'}).`, comecou)
  }

  const entrada = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  const r = executarFormula(compilada.compilada, entrada)
  if (!r.ok) {
    return {
      ok: false,
      metadata: { line: r.error.line },
      telemetry: { durationMs: Date.now() - comecou },
      // A mensagem é da própria fórmula: nome de campo e operação, escritos por quem
      // configurou. Não há corpo de terceiro nem caminho de arquivo por onde vazar nada.
      error: { kind: 'invalid_input', message: `Linha ${r.error.line}: ${r.error.message}` },
    }
  }

  return {
    ok: true,
    structured: { data: r.data, valid: true, repaired: false },
    metadata: { fields: compilada.compilada.saidas.length },
    // ZERO token: nenhum provedor é chamado. É a mesma promessa da função registrada.
    telemetry: { durationMs: Date.now() - comecou },
  }
}
