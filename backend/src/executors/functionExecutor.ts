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
import { ErroDeFuncao, findAdapterFor, findFunction } from './functionRegistry.js'
import type { FunctionExecutorConfig } from './types.js'
import type { ExecutorError, ExecutorResult } from './types.js'

/**
 * Teto de entrada. Generoso para dado de verdade, pequeno perto do que derruba um processo.
 */
const MAX_ENTRADA_CHARS = 256_000
/** A mesma peneira de nomes que a trilha usa, pelo mesmo motivo. */
const CHAVE_DE_SEGREDO = /(authorization|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|bearer|token|secret|password|senha|credential|cookie|private[-_]?key)/i

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

  /**
   * O TAMANHO da entrada, antes do schema.
   *
   * O validador percorre a estrutura inteira; um payload de dezenas de megabytes o faz
   * percorrer dezenas de megabytes, no event loop, antes de recusar. A recusa precisa vir
   * antes do trabalho que ela evita.
   */
  const tamanho = JSON.stringify(entrada)?.length ?? 0
  if (tamanho > MAX_ENTRADA_CHARS) {
    return falha('invalid_input', `Entrada grande demais: ${tamanho} caracteres (máximo ${MAX_ENTRADA_CHARS}).`, comecou, metadata)
  }

  /**
   * Os PARÂMETROS que o dono fixou no agente — dados, nunca segredo.
   *
   * Uma credencial aqui ficaria em texto claro no documento do agente, e um documento
   * vazado viraria acesso vazado. A recusa é por NOME de campo, com a mesma peneira que o
   * resto do sistema usa, e acontece antes de o handler ver qualquer coisa.
   */
  const parametros = config.config
  if (parametros) {
    const suspeita = Object.keys(parametros).find((k) => CHAVE_DE_SEGREDO.test(k))
    if (suspeita) {
      return falha('invalid_input', `O parâmetro "${suspeita}" parece uma credencial. Credenciais ficam na conexão do App, não na configuração do agente.`, comecou, metadata)
    }
  }

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
    saida = await comLimite(
      Promise.resolve(registrada ? registrada.handler(entrada, parametros) : adaptador!.invoke(config.functionName, entrada, { timeoutMs })),
      timeoutMs,
    )
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
    /**
     * O que o handler levantou DE PROPÓSITO sai; o que escapou dele vira categoria.
     *
     * "receita zero: a margem não é definida" foi escrita neste repositório para quem
     * administra ler. Trocá-la por "falhou durante a execução" apaga a única informação
     * que permite consertar — e uma exceção inesperada continua sem sair, porque `stack`
     * conta caminho de arquivo e a mensagem crua costuma carregar valor de variável.
     */
    if (erro instanceof ErroDeFuncao) {
      return falha('invalid_input', erro.message, comecou, metadata)
    }
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

/**
 * Uma função produz DADO. Ela não produz prosa.
 *
 * Um agente de função marcado como `structured_and_text` promete as duas coisas e entrega
 * uma. Devolver string vazia como se fosse o texto seria relatar sucesso completo para uma
 * entrega pela metade — e quem consome descobriria em produção, com um campo em branco.
 *
 * A saída honesta é dizer que falta uma etapa de MODELO para apresentar o dado.
 */
export const TEXTO_NAO_PRODUZIDO =
  'Este agente executa uma função e produz dados, não texto. Para uma resposta escrita, encadeie um agente de IA que apresente o resultado.'
