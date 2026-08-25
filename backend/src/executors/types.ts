// O que é "executar um agente" — antes de existir mais de um jeito de fazer isso.
//
// Hoje todo agente é uma chamada a um modelo. Isso funciona e vai continuar funcionando,
// mas nem todo trabalho precisa de um: somar uma coluna, chamar um endpoint, formatar um
// documento. Fazer essas coisas por modelo é caro, lento e não determinístico — a mesma
// entrada pode dar respostas diferentes, e para uma soma isso não é aceitável.
//
// Esta é a FASE 1: só o contrato. Nada aqui é chamado ainda; os runtimes existentes
// continuam intactos. A razão de escrever os tipos antes é que eles obrigam a responder,
// agora, a pergunta que decide o resto: o que um executor devolve?
//
// A resposta está em `ExecutorResult`, e ela separa duas coisas que hoje andam coladas:
// o DADO (que outro agente consome, e um schema valida) e o TEXTO (que uma pessoa lê).
// Um agente que devolve JSON hoje entrega uma string que alguém precisa reparsear; um que
// devolve prosa não tem dado nenhum. Com os dois separados, quem chama escolhe o que usa
// e o contrato de saída passa a ser verificável.
import type { ObjectId } from 'mongodb'

/** Como o trabalho deste agente é feito. Não confundir com `executionMode`, que é de rotina. */
export type ExecutorKind = 'llm' | 'function' | 'tool'

/** O que o agente devolve: dado, texto, ou os dois. */
export type ResponseMode = 'structured' | 'text' | 'structured_and_text'

// --- a configuração, discriminada pelo tipo ------------------------------------------------

/**
 * O executor por modelo — o de hoje.
 *
 * Vazio de propósito: provedor, modelo, temperatura e o resto já moram em campos próprios
 * do agente (`provider`, `model`, `runConfig`). Duplicá-los aqui criaria duas verdades
 * sobre qual modelo roda, e a que estivesse errada seria descoberta em produção.
 */
export interface LlmExecutorConfig {
  kind: 'llm'
}

/**
 * Uma função determinística registrada no sistema.
 *
 * Guarda só o NOME e a versão: o código vive no servidor, não na configuração do agente.
 * Gravar o corpo aqui transformaria um documento de banco em código executável, que é a
 * porta de entrada mais direta que existe para execução arbitrária.
 */
export interface FunctionExecutorConfig {
  kind: 'function'
  functionName: string
  /** Fixar a versão é o que impede um agente de mudar de comportamento sozinho. */
  version?: string
  /** Parâmetros da função. Dados, nunca segredo. */
  config?: Record<string, unknown>
}

/**
 * Uma ação de App ou uma ferramenta já cadastrada.
 *
 * REFERÊNCIA, nunca credencial. A chave vive na instalação cifrada do App, e é lá que ela
 * fica: um id no documento do agente não dá acesso a nada por si só, e um documento
 * vazado não vira acesso vazado.
 */
export interface ToolExecutorConfig {
  kind: 'tool'
  /** Um dos dois: a ferramenta reutilizável da conta, ou a ação de um App instalado. */
  toolId?: string
  appKey?: string
  actionKey?: string
}

export type ExecutorConfig = LlmExecutorConfig | FunctionExecutorConfig | ToolExecutorConfig

// --- o contrato de execução -------------------------------------------------------------------

export interface ExecutorRequest {
  agentId: ObjectId
  ownerId: string
  /** O pedido, em texto — o que sempre existiu. */
  objective: string
  /** O que veio de quem chamou. Validado contra `inputJsonSchema` quando ele existe. */
  input?: unknown
  /** Correlação para log e painel. Nunca conteúdo. */
  correlationId?: string
}

/** O dado que o agente produziu, já validado contra o contrato de saída. */
export interface StructuredAgentOutput {
  data: unknown
  /** O schema conferiu? `false` com `data` presente quer dizer "entregue sob protesto". */
  valid: boolean
  /** Precisou de correção para caber no formato? */
  repaired: boolean
}

/** O que custou. Separado do resultado porque a conta existe mesmo quando a execução falha. */
export interface ExecutorTelemetry {
  durationMs: number
  /** Só para `llm`. Uma função determinística não consome token. */
  inputTokens?: number
  outputTokens?: number
  /** Quantas chamadas externas aconteceram — ferramenta, App, endpoint. */
  externalCalls?: number
}

export type ExecutorErrorKind =
  | 'invalid_input'
  | 'invalid_output'
  | 'not_configured'
  | 'provider'
  | 'tool'
  | 'timeout'
  | 'limit'

export interface ExecutorError {
  kind: ExecutorErrorKind
  /** Uma frase para quem administra. Nunca corpo de terceiro, nunca credencial. */
  message: string
}

/**
 * O resultado de uma execução.
 *
 * `structured` e `text` são campos SEPARADOS, e é a razão de este arquivo existir. Hoje a
 * resposta é uma string: quem precisa do dado reparseia e torce, e quem precisa do texto
 * recebe JSON cru quando o agente é estruturado. Separados, o `responseMode` do agente
 * diz qual deles é obrigatório, e o contrato passa a ser verificável antes da entrega.
 */
export interface ExecutorResult {
  ok: boolean
  /** Presente quando o modo pede dado. */
  structured?: StructuredAgentOutput
  /** Presente quando o modo pede texto — é o que uma pessoa lê. */
  text?: string
  /** Sobre a execução, nunca o conteúdo dela. */
  metadata: Record<string, unknown>
  telemetry: ExecutorTelemetry
  /** Presente exatamente quando `ok` é falso. */
  error?: ExecutorError
}

/**
 * Quem sabe executar um tipo de agente.
 *
 * Uma interface por TIPO, não por agente: o runtime escolhe a implementação pelo
 * `executorKind` e não precisa saber o que existe do outro lado.
 */
export interface AgentExecutor {
  readonly kind: ExecutorKind
  execute(request: ExecutorRequest): Promise<ExecutorResult>
}
