// O que acontece em volta de uma etapa do plano — antes e depois da execução.
//
// A fase 3 fez o plano dizer DE ONDE vem cada campo. Isso não basta: o plano é uma
// promessa, e o que chega em tempo de execução é outra coisa. A etapa anterior pode ter
// devolvido um número onde o contrato pedia texto, ou nada onde o contrato exigia um
// valor. Sem uma conferência aqui, esse desencontro vira entrada do agente — e um agente
// que recebe entrada errada não falha: ele responde, com convicção, a partir do que
// entendeu.
//
// Então são duas paradas obrigatórias:
//
//   ANTES — os campos existem, com os tipos certos? Se não, a etapa NÃO roda. Não rodar é
//   barato; rodar com o campo errado custa uma resposta plausível e falsa.
//
//   DEPOIS — o que voltou cumpre o contrato de saída? O que não cumpre não vira entrada de
//   ninguém, porque um dado inválido propagado é o mesmo defeito uma etapa adiante.
//
// O erro que sai daqui carrega etapa, agente, campo e código — e mais nada. Nem o valor do
// campo, nem o corpo do provedor, nem o texto do documento: o diagnóstico serve para
// consertar o plano, e para isso o NOME do campo é o suficiente.
import { describeErrors, validateAgainstSchema } from '../jsonSchema.js'
import { agentContractOf } from './contract.js'
import type { AgentContract } from './contract.js'
import type { Binding, ExecutionTask } from '../sectorPlanner.js'
import { isLegacyTask, resolveBindings } from '../sectorPlanner.js'
import type { ExecutorResult, ResponseMode, StructuredAgentOutput } from './types.js'

/** O que deu errado numa etapa — endereçável, e sem nada de dentro. */
export interface StepError {
  code: 'missing_input' | 'invalid_input' | 'invalid_output' | 'executor'
  stepId: string
  agentId: string
  /** O campo em questão, quando há um. NOME, nunca valor. */
  field?: string
  message: string
}

/** O agente, do ponto de vista de uma etapa: o contrato e nada mais. */
export interface StepAgent {
  agentId: string
  contract: AgentContract
}

export const stepAgentOf = (agentId: string, agent: Parameters<typeof agentContractOf>[0]): StepAgent => ({
  agentId,
  contract: agentContractOf(agent),
})

const primeiros = (mensagem: string, quantos = 3): string => mensagem.split('; ').slice(0, quantos).join('; ')

/**
 * A entrada desta etapa, conferida contra o contrato do agente.
 *
 * `ok: false` quer dizer NÃO EXECUTE. É a diferença entre uma etapa que não rodou — e diz
 * por quê — e uma que rodou sem o dado e devolveu algo que parece resposta.
 */
export function prepareStepInput(
  task: ExecutionTask,
  agente: StepAgent,
  fontes: { context?: unknown; steps?: Record<string, unknown> },
): { ok: true; input?: Record<string, unknown>; missing: string[] } | { ok: false; error: StepError } {
  const erro = (code: StepError['code'], message: string, field?: string): { ok: false; error: StepError } => ({
    ok: false,
    error: { code, stepId: task.id, agentId: agente.agentId, message, ...(field ? { field } : {}) },
  })

  // Tarefa legada não declara campo nenhum: a entrada dela é o texto dos antecessores, e
  // cobrar contrato de quem foi planejado antes de o contrato existir quebraria o que roda.
  if (isLegacyTask(task)) return { ok: true, missing: [] }

  // O caminho perigoso já foi barrado ao ler o plano; aqui é a segunda tranca, para o caso
  // de um plano montado por outro caminho — um registro antigo, um teste, uma API futura.
  for (const [campo, b] of Object.entries(task.inputBindings ?? {})) {
    if (b.from !== 'literal' && b.path.some((p) => PROIBIDOS.has(p)))
      return erro('invalid_input', `origem proibida para "${campo}"`, campo)
  }

  const { input, missing } = resolveBindings(task.inputBindings, fontes)
  if (missing.length > 0) return erro('missing_input', `campo sem valor: ${missing.join(', ')}`, missing[0])

  const schema = agente.contract.inputJsonSchema
  if (schema) {
    const v = validateAgainstSchema(schema, input)
    if (!v.valid) {
      const primeiro = v.errors[0]
      // O caminho do erro é o nome do campo; a MENSAGEM diz o que estava errado no formato,
      // nunca o que estava escrito no valor.
      return erro('invalid_input', primeiros(describeErrors(v.errors)), primeiro?.path?.split('.')[0] || undefined)
    }
  }
  return { ok: true, input, missing: [] }
}

const PROIBIDOS = new Set(['__proto__', 'prototype', 'constructor'])

/**
 * O resultado da etapa, conferido contra o contrato de saída e recortado pelo modo.
 *
 * `responseMode` decide o que sai: `structured` entrega só o dado, `text` só o texto, e
 * `structured_and_text` os dois. Entregar o que não foi pedido não é generosidade — é como
 * um dado intermediário vira frase e a frase vira a entrada do próximo, que era exatamente
 * o acoplamento por texto que esta fase existe para desfazer.
 */
export function finishStep(
  task: ExecutionTask,
  agente: StepAgent,
  resultado: ExecutorResult,
): { ok: true; structured?: StructuredAgentOutput; text?: string } | { ok: false; error: StepError } {
  const erro = (code: StepError['code'], message: string, field?: string): { ok: false; error: StepError } => ({
    ok: false,
    error: { code, stepId: task.id, agentId: agente.agentId, message, ...(field ? { field } : {}) },
  })

  if (!resultado.ok) return erro('executor', resultado.error?.message ?? 'a etapa não completou')

  const modo: ResponseMode = task.responseMode ?? agente.contract.responseMode
  const schema = task.expectedOutputSchema ?? agente.contract.outputJsonSchema

  if (modo !== 'text') {
    if (!resultado.structured) return erro('invalid_output', 'a etapa devolveu texto onde o contrato pede dado')
    if (schema) {
      const v = validateAgainstSchema(schema, resultado.structured.data)
      if (!v.valid) {
        // Dado inválido NÃO vira entrada de ninguém: propagá-lo é o mesmo defeito uma etapa
        // adiante, e lá ele já não tem de onde ser explicado.
        return erro('invalid_output', primeiros(describeErrors(v.errors)), v.errors[0]?.path?.split('.')[0] || undefined)
      }
    }
  }

  /**
   * `structured_and_text` promete as DUAS coisas.
   *
   * Um executor de função ou de ferramenta produz dado; prosa é trabalho de modelo.
   * Entregar string vazia como se fosse o texto relataria sucesso completo para uma entrega
   * pela metade — e quem consome descobriria em produção, com um campo em branco no lugar
   * de uma explicação.
   */
  if (modo === 'structured_and_text' && !resultado.text) {
    return erro(
      'invalid_output',
      'Este agente promete dados E texto, e produziu só dados. Uma função ou ferramenta não escreve prosa: encadeie um agente de IA para apresentar o resultado, ou mude o modo para "Dados estruturados".',
    )
  }

  return {
    ok: true,
    ...(modo !== 'text' && resultado.structured ? { structured: resultado.structured } : {}),
    ...(modo !== 'structured' ? { text: resultado.text ?? '' } : {}),
  }
}

/**
 * O que uma etapa deixa para as seguintes.
 *
 * O DADO quando ele existe; o texto só quando não existe dado. Para uma etapa nova, o
 * próximo lê `$steps.<id>.campo` e recebe o valor — em vez de receber a prosa inteira do
 * antecessor e ter que extrair o número dela.
 */
export const stepValue = (r: { structured?: StructuredAgentOutput; text?: string }): unknown => {
  const dado = r.structured?.data
  return dado && typeof dado === 'object' && !Array.isArray(dado) ? { text: r.text ?? '', ...(dado as object) } : { text: r.text ?? '', ...(dado !== undefined ? { value: dado } : {}) }
}

/** O erro em uma linha, para o log. Etapa, agente, código e campo — nunca o conteúdo. */
export const describeStepError = (e: StepError): string =>
  `${e.code}@${e.stepId}/${e.agentId}${e.field ? `[${e.field}]` : ''}: ${e.message}`

/** Os bindings desta tarefa, para o log. As ORIGENS, não os valores. */
export const bindingOrigins = (bindings: Record<string, Binding> | undefined): string[] =>
  Object.entries(bindings ?? {}).map(([k, b]) => `${k}<-${b.from}`)
