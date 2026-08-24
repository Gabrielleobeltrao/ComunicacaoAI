// Executar uma função registrada: valida, roda com teto de tempo, valida de novo.
//
// A diferença que justifica este executor existir: aqui o erro NÃO vira uma segunda
// chamada ao modelo. Quando um agente-modelo responde fora do formato, faz sentido pedir
// que ele corrija — ele pode ter escrito errado. Uma função determinística que devolveu
// fora do contrato tem um defeito no código, e pedir para "tentar de novo" só gastaria
// tempo para chegar exatamente ao mesmo resultado. O erro é tipado e sobe.
//
// E o que sai daqui nunca carrega stack nem mensagem crua de exceção: elas contam caminho
// de arquivo e, com alguma frequência, valor de variável.
import { describeErrors, validateAgainstSchema } from '../jsonSchema.js'
import { findAdapterFor, findFunction } from './functionRegistry.js'
import type { FunctionExecutorConfig } from './types.js'
import type { ExecutorError, ExecutorResult } from './types.js'

const falha = (kind: ExecutorError['kind'], message: string, comecou: number, metadata: Record<string, unknown> = {}): ExecutorResult => ({
  ok: false,
  metadata,
  telemetry: { durationMs: Date.now() - comecou },
  error: { kind, message },
})

/** O teto de tempo, como promessa cumprida: o que passa dele não vira resultado. */
function comLimite<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const relogio = setTimeout(() => reject(new Error('__timeout__')), ms)
    promessa.then(
      (v) => {
        clearTimeout(relogio)
        resolve(v)
      },
      (e) => {
        clearTimeout(relogio)
        reject(e)
      },
    )
  })
}

export async function executeRegisteredFunction(
  config: FunctionExecutorConfig,
  input: unknown,
): Promise<ExecutorResult> {
  const comecou = Date.now()
  const registrada = findFunction(config.functionName)
  const adaptador = registrada ? null : findAdapterFor(config.functionName)

  if (!registrada && !adaptador) {
    // Chave que não está no registry não roda. É a fronteira inteira desta fase: o que
    // executa é código deste repositório, e o agente guarda apenas o nome.
    return falha('not_configured', `A função "${config.functionName}" não está disponível neste servidor.`, comecou, {
      functionName: config.functionName,
    })
  }

  // Versão fixada que não bate: um agente não pode mudar de comportamento sozinho porque
  // a função foi atualizada.
  if (registrada && config.version && config.version !== registrada.version) {
    return falha(
      'not_configured',
      `A função "${config.functionName}" está na versão ${registrada.version}, e este agente pede a ${config.version}.`,
      comecou,
      { functionName: config.functionName, version: registrada.version },
    )
  }

  const metadata: Record<string, unknown> = {
    functionName: config.functionName,
    version: registrada?.version ?? null,
    via: registrada ? 'registry' : adaptador!.name,
  }

  const entrada = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>

  // ANTES: o handler nunca vê dado que não cumpre o contrato de entrada.
  if (registrada) {
    const v = validateAgainstSchema(registrada.inputSchema, entrada)
    if (!v.valid) {
      return falha('invalid_input', `Entrada fora do contrato: ${describeErrors(v.errors)}`, comecou, metadata)
    }
  }

  const timeoutMs = registrada?.timeoutMs ?? 10_000
  let saida: unknown
  try {
    saida = await comLimite(Promise.resolve(registrada ? registrada.handler(entrada) : adaptador!.invoke(config.functionName, entrada, { timeoutMs })), timeoutMs)
  } catch (erro) {
    const expirou = erro instanceof Error && erro.message === '__timeout__'
    if (expirou) {
      return falha('timeout', `A função "${config.functionName}" passou de ${timeoutMs}ms e foi interrompida.`, comecou, metadata)
    }
    /**
     * A exceção não sai daqui.
     *
     * Stack conta caminho de arquivo, e mensagem crua costuma carregar valor de variável.
     * O log do servidor recebe o detalhe; o cliente recebe que falhou e em quê.
     */
    console.error(`[function] ${config.functionName} falhou:`, erro)
    return falha('tool', `A função "${config.functionName}" falhou durante a execução.`, comecou, metadata)
  }

  // DEPOIS: o contrato de saída vale tanto quanto o de entrada.
  if (registrada) {
    const v = validateAgainstSchema(registrada.outputSchema, saida)
    if (!v.valid) {
      // Sem pedir correção a ninguém: isto é defeito de código, e repetir daria no mesmo.
      console.error(`[function] ${config.functionName} devolveu fora do contrato:`, describeErrors(v.errors))
      // O CAMPO vai na mensagem, como já vai no erro de entrada. É o nome do campo e o tipo
      // esperado — o vocabulário do schema, escrito por quem configurou o agente. Sem ele,
      // quem administra sabe que algo quebrou e não sabe o quê, e o único lugar com a
      // resposta é o log do servidor.
      return falha('invalid_output', `A função "${config.functionName}" devolveu fora do contrato: ${describeErrors(v.errors)}`, comecou, metadata)
    }
  }

  return {
    ok: true,
    structured: { data: saida, valid: true, repaired: false },
    metadata,
    telemetry: { durationMs: Date.now() - comecou },
  }
}
