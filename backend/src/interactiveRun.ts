// A execução de uma resposta INTERATIVA — Playground, chat manual e canais.
//
// Estes três chamavam o provedor direto. O runtime (`executeAgentTask`), que é quem
// aplica prazo, tentativas, cancelamento e o contrato de saída, só era usado pelas
// automações. O resultado: o `runConfig.timeoutMs` do dono valia numa rotina e não valia
// no chat; um JSON malformado era entregue ao cliente sem ninguém conferir; e um timeout
// deixava a chamada rodando, com a ferramenta de escrita disparando depois.
//
// Aqui está o caminho único dos três. Ele não substitui o runtime — os interativos têm
// histórico, memória de conversa e instruções de canal que o runtime não modela — mas
// aplica as MESMAS regras, do mesmo jeito, a partir das mesmas funções.
import { AgentRunError } from './agentRuntime.js'
import { enforceOutputContract } from './agentDefinition.js'
import { classifyProviderError, shouldRetryInference } from './runConfig.js'
import type { EffectiveRunConfig } from './runConfig.js'
import type { AgentReplyResult, ChatTurn } from './llm.js'
import type { ResolvedTool } from './agentTools.js'

export type ToolRisk = 'read' | 'write' | 'high_risk'

/**
 * Como chamar o provedor. Recebido como função para este módulo não conhecer `llm.js`
 * nem os adapters — e para um teste poder observar exatamente o que foi pedido.
 */
export type InteractiveReply = (opts: {
  objective: string
  knowledge: string[]
  memory: string
  history: ChatTurn[]
  tools: ResolvedTool[]
  signal: AbortSignal
  onToolStart: (risk: ToolRisk) => void
}) => Promise<AgentReplyResult>

export interface InteractiveRunOptions {
  reply: InteractiveReply
  objective: string
  knowledge?: string[]
  memory?: string
  history: ChatTurn[]
  tools?: ResolvedTool[]
  runConfig?: EffectiveRunConfig
  // O contrato de saída do agente. Ausente ou `text` = nada a validar.
  output?: { format: string; jsonSchema?: Record<string, unknown> | null }
  onRetry?: (tentativa: number) => void
}

export interface InteractiveRunResult {
  text: string
  usage: { inputTokens: number; outputTokens: number }
  toolCalls: AgentReplyResult['toolCalls']
  /**
   * O contrato de saída foi cumprido?
   *
   * `false` significa que nem a resposta nem o reparo produziram JSON válido. Quem
   * consome PRECISA decidir o que fazer — um canal não envia, o Playground mostra o
   * diagnóstico. Entregar como sucesso seria mandar ao cliente um texto que o próprio
   * sistema sabe estar errado.
   */
  outputValid: boolean
  outputRepaired: boolean
  outputProblem?: string
  /**
   * O DADO, quando o contrato pede dado.
   *
   * Quem consome recebia a string e reparseava — cada um do seu jeito, e o de quem
   * esquecesse ficava mostrando JSON cru numa tela de conversa. Aqui ele sai já lido,
   * uma vez, por quem acabou de validá-lo.
   */
  json?: unknown
}

const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Espera com prazo — e CANCELA quem passou dele.
 *
 * Rejeitar sem abortar deixaria a chamada viva: o modelo responde depois, o laço de
 * ferramentas continua, e uma escrita acontece quando ninguém mais espera por ela.
 */
async function comPrazo<T>(p: Promise<T>, ms: number | undefined, controller: AbortController): Promise<T> {
  if (!ms || ms <= 0) return p
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new AgentRunError('timeout', `resposta excedeu ${ms}ms`))
        }, ms)
        if (typeof timer.unref === 'function') timer.unref()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Uma resposta interativa, com as mesmas regras das automações.
 *
 * Tentativas: só em falha de trânsito, e NUNCA depois de uma ferramenta de escrita ter
 * começado — nem em timeout, que é justamente quando não se sabe se ela completou do
 * outro lado. Risco desconhecido conta como escrita.
 *
 * O reparo do JSON usa o mesmo orçamento de prazo, roda SEM ferramentas (o problema é a
 * forma do texto, não falta de informação) e tem os tokens somados ao uso — ele custou,
 * e quem paga precisa ver.
 */
export async function runInteractive(opts: InteractiveRunOptions): Promise<InteractiveRunResult> {
  const tentativas = Math.max(0, opts.runConfig?.retries ?? 0)
  const timeoutMs = opts.runConfig?.timeoutMs

  const usage = { inputTokens: 0, outputTokens: 0 }
  let escritaIniciada = false
  let resultado: AgentReplyResult | null = null
  let ultimoErro: unknown = null

  for (let tentativa = 0; tentativa <= tentativas; tentativa++) {
    // Um controlador POR TENTATIVA: abortar a primeira não pode cancelar a segunda.
    const controller = new AbortController()
    try {
      const chamada = opts.reply({
        objective: opts.objective,
        knowledge: opts.knowledge ?? [],
        memory: opts.memory ?? '',
        history: opts.history,
        tools: opts.tools ?? [],
        signal: controller.signal,
        onToolStart: (risk) => {
          if (risk !== 'read') escritaIniciada = true
        },
      })
      resultado = await comPrazo(chamada, timeoutMs, controller)
      break
    } catch (erro) {
      // A tentativa acabou: o que ela ainda estivesse fazendo para de valer aqui.
      controller.abort()
      ultimoErro = erro
      if (escritaIniciada) break
      const kind = erro instanceof AgentRunError ? erro.kind : classifyProviderError(erro)
      if (tentativa >= tentativas || !shouldRetryInference(kind, { hasValidAnswer: false })) break
      opts.onRetry?.(tentativa + 1)
      // Uma pausa curta antes de insistir: repetir no mesmo instante costuma encontrar o
      // mesmo 429.
      await espera(250)
    }
  }

  if (!resultado) {
    if (ultimoErro instanceof AgentRunError) throw ultimoErro
    throw new AgentRunError('provider', ultimoErro instanceof Error ? ultimoErro.message : 'provider error')
  }

  usage.inputTokens += resultado.usage.inputTokens
  usage.outputTokens += resultado.usage.outputTokens

  const conferido = await enforceOutputContract(resultado.text, opts.output, async (instrucao) => {
    const controller = new AbortController()
    const reparo = await comPrazo(
      opts.reply({
        objective: opts.objective,
        knowledge: [],
        memory: '',
        history: [...opts.history, { role: 'assistant', content: resultado!.text }, { role: 'user', content: instrucao }],
        // Sem ferramentas: o reparo reescreve o texto, e dar ferramentas a ele repetiria
        // ações que já aconteceram.
        tools: [],
        signal: controller.signal,
        onToolStart: () => undefined,
      }),
      timeoutMs,
      controller,
    )
    // O reparo custou tokens. Somá-los é o que faz a cobrança, a métrica e a auditoria
    // baterem com a fatura do provedor.
    usage.inputTokens += reparo.usage.inputTokens
    usage.outputTokens += reparo.usage.outputTokens
    return reparo.text
  })

  // Lido uma vez, aqui, por quem acabou de validá-lo. `valid` já garante que dá para ler.
  let dado: unknown
  if (opts.output?.format === 'json' && conferido.valid) {
    try {
      dado = JSON.parse(conferido.text)
    } catch {
      dado = undefined
    }
  }

  return {
    text: conferido.text,
    usage,
    toolCalls: resultado.toolCalls,
    outputValid: conferido.valid,
    outputRepaired: conferido.repaired,
    ...(conferido.problem ? { outputProblem: conferido.problem } : {}),
    ...(dado !== undefined ? { json: dado } : {}),
  }
}

/**
 * O diagnóstico dos parâmetros descartados, pronto para log e auditoria.
 *
 * Só o par campo/motivo, os dois gerados por este código. Nunca prompt, contexto,
 * resposta, chave ou credencial — um diagnóstico que carrega conteúdo é um vazamento com
 * outro nome.
 */
export const describeDropped = (runConfig: EffectiveRunConfig | undefined): string =>
  (runConfig?.dropped ?? []).map((d) => `${d.field}: ${d.reason}`).join('; ')
