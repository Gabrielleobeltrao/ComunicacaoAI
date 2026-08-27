/**
 * POR QUE a chamada ao provedor falhou — em uma frase que diz o que fazer.
 *
 * Existia uma frase só para tudo: "O provedor não respondeu. Tente novamente em
 * instantes." Ela cobria chave inválida, modelo inexistente, conta sem crédito, limite
 * de taxa e parâmetro recusado — cinco causas com cinco respostas diferentes, e nenhuma
 * delas é "tente de novo". Quem via aquilo tentava outra vez e falhava outra vez, sem
 * nunca saber que faltava trocar uma chave ou um nome de modelo.
 *
 * O que NUNCA sai daqui é o texto do provedor. Ele pode trazer a URL da requisição, e
 * com ela a chave. O que sai é a classificação e, quando ajuda, o nome do modelo — que
 * é configuração nossa, não segredo de ninguém.
 */

export type LlmFailureCode =
  /** A chave não vale: ausente, revogada, ou de outra conta. */
  | 'provider_key_invalid'
  /** O modelo não existe ou esta chave não o alcança. */
  | 'provider_model_unavailable'
  /** A conta do provedor está sem crédito ou sem cota. */
  | 'provider_no_credit'
  /** Bateu no limite de requisições. Aqui sim, esperar resolve. */
  | 'provider_rate_limited'
  /** O provedor recusou a forma do pedido — um parâmetro que aquele modelo não aceita. */
  | 'provider_rejected_request'
  /** Não respondeu a tempo, ou a rede não chegou lá. */
  | 'provider_timeout'
  /** O provedor está fora do ar. */
  | 'provider_unavailable'
  /** Não deu para classificar. */
  | 'provider_error'

export interface LlmFailure {
  code: LlmFailureCode
  message: string
}

const statusDe = (error: unknown): number | null => {
  const e = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } }
  const bruto = e?.status ?? e?.statusCode ?? e?.response?.status
  return typeof bruto === 'number' ? bruto : null
}

/** Só o que o provedor devolve como CÓDIGO — nunca a mensagem, que pode ter a chave. */
const codigoDe = (error: unknown): string => {
  const e = error as { code?: unknown; error?: { code?: unknown; type?: unknown }; type?: unknown }
  return String(e?.code ?? e?.error?.code ?? e?.error?.type ?? e?.type ?? '').toLowerCase()
}

/**
 * A mensagem do provedor, só para CLASSIFICAR — ela não é repassada.
 *
 * Alguns erros só se distinguem pelo texto (um 400 de parâmetro recusado é igual a um
 * 400 de prompt grande demais no status). Ler aqui é seguro porque nada disto sai da
 * função: o que volta é uma frase nossa.
 */
const textoDe = (error: unknown): string => String((error as { message?: unknown })?.message ?? '').toLowerCase()

export function classifyLlmFailure(error: unknown, modelo?: string | null): LlmFailure {
  const status = statusDe(error)
  const codigo = codigoDe(error)
  const texto = textoDe(error)
  const doModelo = modelo ? ` (modelo "${modelo}")` : ''

  if (status === 401 || status === 403 || /invalid_api_key|authentication|permission_denied|unauthorized/.test(`${codigo} ${texto}`)) {
    return { code: 'provider_key_invalid', message: 'A chave do provedor não foi aceita. Confira a chave em Configurações — ela pode ter sido revogada ou ser de outra conta.' }
  }
  if (status === 404 || /model_not_found|does not exist|unknown model/.test(`${codigo} ${texto}`)) {
    return {
      code: 'provider_model_unavailable',
      message: `O provedor não reconheceu o modelo configurado${doModelo}. Escolha outro modelo em Configurações ou libere o acesso a ele na conta do provedor.`,
    }
  }
  if (status === 402 || /insufficient_quota|billing|credit|quota/.test(`${codigo} ${texto}`)) {
    return { code: 'provider_no_credit', message: 'A conta do provedor está sem crédito ou sem cota. Recarregue lá e tente de novo.' }
  }
  if (status === 429 || /rate_limit/.test(`${codigo} ${texto}`)) {
    // A única em que "tente novamente em instantes" é mesmo a resposta certa.
    return { code: 'provider_rate_limited', message: 'O provedor está limitando as requisições agora. Tente novamente em instantes.' }
  }
  if (/timeout|etimedout|econnreset|socket hang up|aborted/.test(`${codigo} ${texto}`)) {
    return { code: 'provider_timeout', message: 'O provedor não respondeu a tempo. Tente novamente em instantes.' }
  }
  if (status !== null && status >= 500) {
    return { code: 'provider_unavailable', message: 'O provedor está fora do ar no momento. Tente novamente em instantes.' }
  }
  if (status === 400) {
    /**
     * 400 é o provedor dizendo "esse pedido não serve", e a causa mais comum aqui é um
     * parâmetro que AQUELE modelo não aceita — um controle de raciocínio num modelo que
     * não raciocina, por exemplo. Tentar de novo nunca resolve isso.
     */
    return {
      code: 'provider_rejected_request',
      message: `O provedor recusou o pedido${doModelo}. Isso costuma ser o modelo escolhido não aceitar alguma opção da configuração — trocar o modelo em Configurações costuma resolver.`,
    }
  }
  return { code: 'provider_error', message: 'A chamada ao provedor falhou. Veja os detalhes no registro do servidor.' }
}
