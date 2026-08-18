// Quais modelos rodam quando ninguém escolhe — e nada mais.
//
// Estas constantes moravam dentro dos adapters, que arrastam o SDK do provedor, o
// executor de ferramentas e, por ele, o banco. Quem só quer saber "qual é o modelo
// padrão da OpenAI" não deveria precisar de uma conexão com o MongoDB para descobrir:
// era o que acontecia quando `agentDefinition` passou a resolver o modelo automático, e
// os testes sem banco quebraram por causa disso.
//
// Puro: lê variáveis de ambiente e devolve strings. Os adapters reexportam daqui, então
// continua havendo uma fonte só.

export const ANTHROPIC_DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
export const ANTHROPIC_AUX_MODEL = process.env.ANTHROPIC_AUX_MODEL ?? 'claude-haiku-4-5'

export const OPENAI_DEFAULT_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.1'
export const OPENAI_AUX_MODEL = process.env.OPENAI_AUX_MODEL ?? 'gpt-5-mini'

/** O modelo de bastidor do provedor: memória, extração, guardrail, roteamento. */
export const auxModelOf = (provider: string | null | undefined): string =>
  provider === 'openai' ? OPENAI_AUX_MODEL : ANTHROPIC_AUX_MODEL

/** O modelo principal do provedor — o que roda quando o campo fica vazio. */
export const defaultModelOf = (provider: string | null | undefined): string =>
  provider === 'openai' ? OPENAI_DEFAULT_MODEL : ANTHROPIC_DEFAULT_MODEL
