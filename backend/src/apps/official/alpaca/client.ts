import type { AppEnvironment } from '../../types.js'

/**
 * O CLIENTE da Alpaca. Tudo que é da Alpaca mora aqui.
 *
 * Endereço, nome de cabeçalho, formato de erro, jeito de pedir barra: nada disso
 * aparece em outro arquivo. É a diferença entre "uma integração" e "dez condicionais
 * espalhadas pelo sistema" — e a segunda só se descobre quando entra a terceira
 * corretora.
 */

export class AlpacaError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'refused' | 'rate_limit' | 'unavailable' | 'network' | 'blocked',
  ) {
    super(message)
  }
}

/**
 * Os endereços. `live` NÃO tem endereço aqui de propósito.
 *
 * A recusa já existe em `connectionProfile`, que barra o ambiente antes de resolver a
 * conexão. Esta é a segunda tranca, no lugar onde a ordem sairia de verdade: se algum
 * caminho novo esquecer a primeira, aqui não há URL para onde mandar.
 */
export const TRADING_BASE: Record<string, string> = {
  default: 'https://paper-api.alpaca.markets',
  paper: 'https://paper-api.alpaca.markets',
}

/** Dado de mercado é o mesmo endereço nos dois ambientes: cotação não é conta. */
export const DATA_BASE = 'https://data.alpaca.markets'

export const ALPACA_DOMAINS = ['paper-api.alpaca.markets', 'data.alpaca.markets', 'stream.data.alpaca.markets']

export function tradingBaseFor(environment: string): string {
  const base = TRADING_BASE[environment]
  if (!base) {
    throw new AlpacaError(
      `o ambiente "${environment}" não está liberado neste sistema — uma ordem de verdade não passa a existir por configuração`,
      'blocked',
    )
  }
  return base
}

export interface AlpacaCredentials {
  keyId: string
  secretKey: string
}

export interface ClientDeps {
  /** Injetável para os testes. Nenhum teste fala com a corretora. */
  fetch?: typeof fetch
  now?: () => number
}

/**
 * Risca a credencial de qualquer texto que vá ser devolvido.
 *
 * Um erro de autenticação costuma vir com a chave que o causou junto, e esse texto vai
 * para o resultado da ferramenta — que o modelo lê e o trace guarda.
 */
export function scrub(texto: string, cred: AlpacaCredentials): string {
  let limpo = texto
  for (const segredo of [cred.keyId, cred.secretKey]) {
    if (segredo && segredo.length >= 8) limpo = limpo.split(segredo).join('***')
  }
  return limpo
}

/**
 * Traduz a resposta da corretora para o vocabulário de dentro.
 *
 * O que interessa a quem lê não é o número HTTP, é o que fazer: reconectar, esperar,
 * corrigir a ordem, ou desistir por enquanto.
 */
export function translateStatus(status: number, corpo: string): AlpacaError {
  if (status === 401 || status === 403) return new AlpacaError('a corretora recusou a credencial — reconecte o App em Apps', 'auth')
  if (status === 429) return new AlpacaError('limite de chamadas da corretora atingido; tente de novo em instantes', 'rate_limit')
  if (status === 422 || status === 400) return new AlpacaError(`a corretora recusou: ${corpo.slice(0, 300)}`, 'refused')
  if (status === 404) return new AlpacaError('a corretora não encontrou o que foi pedido', 'refused')
  if (status >= 500) return new AlpacaError('a corretora está indisponível agora', 'unavailable')
  return new AlpacaError(`a corretora respondeu ${status}: ${corpo.slice(0, 200)}`, 'refused')
}

export interface AlpacaClient {
  trading<T>(path: string, init?: { method?: string; body?: unknown; query?: Record<string, string | undefined> }): Promise<T>
  data<T>(path: string, query?: Record<string, string | undefined>): Promise<T>
  readonly environment: string
}

const comQuery = (url: string, query?: Record<string, string | undefined>): string => {
  if (!query) return url
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, v)
  const s = params.toString()
  return s ? `${url}?${s}` : url
}

export function createAlpacaClient(cred: AlpacaCredentials, environment: AppEnvironment | string, deps: ClientDeps = {}): AlpacaClient {
  // Confere o ambiente AGORA, e não na primeira chamada.
  //
  // Preguiçoso, o bloqueio só apareceria quando alguém tentasse mandar uma ordem — e
  // até lá as ferramentas existiriam, seriam oferecidas ao modelo e apareceriam na
  // tela. Um ambiente bloqueado não deve produzir cliente nenhum.
  const base = tradingBaseFor(environment)
  const doFetch = deps.fetch ?? fetch
  // A credencial vai no cabeçalho, montada aqui, e não é devolvida por nenhum caminho.
  const headers = {
    'APCA-API-KEY-ID': cred.keyId,
    'APCA-API-SECRET-KEY': cred.secretKey,
    'Content-Type': 'application/json',
  }

  const chamar = async <T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> => {
    let res: Response
    try {
      res = await doFetch(url, {
        method: init?.method ?? 'GET',
        headers,
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      })
    } catch (error) {
      throw new AlpacaError(`não foi possível falar com a corretora: ${scrub((error as Error).message, cred)}`, 'network')
    }
    const texto = scrub(await res.text(), cred)
    if (!res.ok) throw translateStatus(res.status, texto)
    if (!texto.trim()) return {} as T
    try {
      return JSON.parse(texto) as T
    } catch {
      throw new AlpacaError('a corretora respondeu algo que não é JSON', 'unavailable')
    }
  }

  return {
    environment,
    trading: (path, init) => chamar(comQuery(`${base}${path}`, init?.query), init),
    data: (path, query) => chamar(comQuery(`${DATA_BASE}${path}`, query)),
  }
}
