import { createHash, randomUUID } from 'node:crypto'
import type { ResolvedTool } from '../../../agentTools.js'
import type { NativeFactory } from '../../types.js'
import { PolicyDenied, guardOrder } from '../../../policies/guard.js'
import type { GuardScope } from '../../../policies/guard.js'
import type { OrderIntent } from '../../../policies/evaluate.js'
import { PROBE_TIMEOUT_MS, registerConnectionProbe } from '../../connectionTests.js'
import { ACTION_DETAIL_KEY, reportActionDetail } from '../../actionEvents.js'
import type { ActionOutcomeDetail } from '../../actionEvents.js'
import { AlpacaError, createAlpacaClient } from './client.js'
import type { AlpacaClient, ClientDeps } from './client.js'

/**
 * As ferramentas da Alpaca.
 *
 * Cada uma devolve JSON com só o que interessa. Devolver a resposta crua da corretora
 * seria entregar ao modelo trinta campos para ele escolher um — e uns quantos que não
 * são da conta dele.
 */

const str = (description: string) => ({ type: 'string', description })
const num = (description: string) => ({ type: 'number', description })
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
})

/** Como o adapter conta o que aconteceu para a auditoria, sem devolver isso ao modelo. */
type Contador = (detalhe: ActionOutcomeDetail) => void

/** Toda ferramenta responde igual: ou o dado, ou o motivo — nunca uma exceção crua. */
const responder = async (trabalho: () => Promise<unknown>, contar: Contador): Promise<{ ok: boolean; result: string }> => {
  try {
    return { ok: true, result: JSON.stringify(await trabalho()) }
  } catch (error) {
    // A recusa por política é diferente de uma falha da corretora: nada saiu daqui, e o
    // que o modelo precisa saber é qual regra barrou — para não tentar de novo igual.
    if (error instanceof PolicyDenied) {
      // O veredito vai para a auditoria: quais regras foram conferidas e quais barraram.
      contar({
        policy: { allowed: false, evaluated: error.verdict.evaluated, violations: error.verdict.violations.map((v) => v.code) },
      })
      return {
        ok: false,
        result: JSON.stringify({
          status: 'policy_denied',
          environment: error.environment,
          violations: error.verdict.violations,
        }),
      }
    }
    if (error instanceof AlpacaError) {
      return { ok: false, result: JSON.stringify({ status: 'provider_error', kind: error.kind, reason: error.message }) }
    }
    return { ok: false, result: JSON.stringify({ status: 'provider_error', kind: 'unavailable', reason: 'falha inesperada na corretora' }) }
  }
}

const numeroOuNulo = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '')

// --- as formas que saem daqui ----------------------------------------------------------
// Contrato de dentro, não o da corretora: quem consome não deveria precisar saber que
// `qty` é string na Alpaca e número em outra.

const conta = (raw: Record<string, unknown>) => ({
  accountNumber: texto(raw.account_number),
  status: texto(raw.status),
  currency: texto(raw.currency),
  equity: numeroOuNulo(raw.equity),
  cash: numeroOuNulo(raw.cash),
  buyingPower: numeroOuNulo(raw.buying_power),
  // Uma conta bloqueada não recusa a ordem no envio: ela aceita e não executa.
  tradingBlocked: raw.trading_blocked === true,
})

const posicao = (raw: Record<string, unknown>) => ({
  symbol: texto(raw.symbol),
  quantity: numeroOuNulo(raw.qty),
  side: texto(raw.side),
  averagePrice: numeroOuNulo(raw.avg_entry_price),
  marketValue: numeroOuNulo(raw.market_value),
  unrealizedPl: numeroOuNulo(raw.unrealized_pl),
})

const ordem = (raw: Record<string, unknown>) => ({
  id: texto(raw.id),
  symbol: texto(raw.symbol),
  side: texto(raw.side),
  type: texto(raw.type),
  quantity: numeroOuNulo(raw.qty),
  filledQuantity: numeroOuNulo(raw.filled_qty),
  limitPrice: numeroOuNulo(raw.limit_price),
  stopPrice: numeroOuNulo(raw.stop_price),
  status: texto(raw.status),
  submittedAt: texto(raw.submitted_at),
  filledAt: texto(raw.filled_at),
})

const simbolo = (v: unknown): string => String(v ?? '').trim().toUpperCase()

/**
 * Uma ordem sem quantidade, sem lado ou sem ativo é uma ordem que a corretora recusa —
 * e recusar aqui custa uma ida a menos e diz o que faltou.
 */
function ordemBase(args: Record<string, unknown>): Record<string, unknown> {
  const symbol = simbolo(args.symbol)
  const side = texto(args.side).toLowerCase()
  const quantity = Number(args.quantity)
  if (!symbol) throw new AlpacaError('informe o ativo', 'refused')
  if (side !== 'buy' && side !== 'sell') throw new AlpacaError('o lado precisa ser "buy" ou "sell"', 'refused')
  if (!Number.isFinite(quantity) || quantity <= 0) throw new AlpacaError('a quantidade precisa ser um número positivo', 'refused')
  const type = texto(args.type).toLowerCase() || 'market'
  const limit = numeroOuNulo(args.limitPrice)
  if (type === 'limit' && limit === null) throw new AlpacaError('uma ordem limitada precisa do preço limite', 'refused')
  return {
    symbol,
    side,
    qty: String(quantity),
    type,
    time_in_force: texto(args.timeInForce).toLowerCase() || 'day',
    ...(limit !== null ? { limit_price: String(limit) } : {}),
  }
}

/** As ações que contam como "operação" para o teto diário. */
export const ORDER_ACTION_KEYS = ['alpaca_criar_ordem', 'alpaca_ordem_bracket']

export interface AlpacaContext {
  ownerId: string
  installationId: string
  agentId?: string | null
  /** A execução e a etapa. Ver `resolveGrant`: é daqui que sai a chave da ordem. */
  executionRef?: string | null
}

/**
 * A chave de idempotência da ordem, DERIVADA — nunca sorteada.
 *
 * Com um id novo a cada tentativa, uma repetição manda a segunda ordem: a corretora não
 * tem como saber que é a mesma. Derivando de (execução, etapa, corpo da ordem), a
 * mesma etapa tentando de novo produz a MESMA chave, e a pergunta "essa ordem já
 * existe?" passa a ter resposta.
 *
 * O corpo entra na chave porque duas ordens diferentes na mesma etapa são duas ordens
 * — e duas ordens iguais na mesma etapa são, por construção, uma repetição.
 */
export function clientOrderId(executionRef: string | null | undefined, body: Record<string, unknown>): string {
  if (!executionRef) return `cai-${randomUUID()}`
  const canonico = JSON.stringify(Object.keys(body).sort().map((k) => [k, body[k]]))
  return `cai-${createHash('sha256').update(`${executionRef}|${canonico}`).digest('hex').slice(0, 24)}`
}

export function buildAlpacaTools(
  config: Record<string, string>,
  environment: string,
  deps: ClientDeps = {},
  contexto?: AlpacaContext,
): ResolvedTool[] {
  const keyId = config.keyId?.trim() ?? ''
  const secretKey = config.secretKey?.trim() ?? ''
  // Sem credencial não se monta ferramenta nenhuma: o grant vira "configuração
  // incompleta" em vez de uma ferramenta que falha na primeira chamada.
  if (!keyId || !secretKey) return []

  let cliente: AlpacaClient
  try {
    cliente = createAlpacaClient({ keyId, secretKey }, environment, deps)
  } catch {
    // Ambiente bloqueado: nenhuma ferramenta existe. É a tranca mais forte possível —
    // não há o que chamar.
    return []
  }

  /**
   * A porteira, chamada no último instante — logo antes de a ordem sair.
   *
   * Sem contexto de conexão não há política a consultar (é o caso do playground e dos
   * testes de contrato do adapter), e aí a ordem segue: a política é da CONEXÃO, e sem
   * conexão não existe uma para aplicar.
   */
  const conferir = async (args: Record<string, unknown>, contar?: Contador) => {
    if (!contexto) return
    const scope: GuardScope = {
      ownerId: contexto.ownerId,
      installationId: contexto.installationId,
      agentId: contexto.agentId ?? null,
      environment,
    }
    const veredito = await guardOrder(scope, intencao(args), {
      estimatePrice: () => precoEstimado(args),
      account: async () => {
        const c = await cliente.trading<Record<string, unknown>>('/v2/account')
        return { equity: numeroOuNulo(c.equity), lastEquity: numeroOuNulo(c.last_equity) }
      },
      positions: async () =>
        (await cliente.trading<Record<string, unknown>[]>('/v2/positions')).map((p) => ({
          symbol: texto(p.symbol),
          quantity: numeroOuNulo(p.qty) ?? 0,
          side: texto(p.side),
        })),
      orderActionKeys: ORDER_ACTION_KEYS,
      now: () => (deps.now ? new Date(deps.now()) : new Date()),
    })
    // Passou: o registro guarda O QUE FOI CONFERIDO, e não só "deu certo". Sem isso,
    // "por que essa ordem passou" não tem resposta.
    contar?.({ policy: { allowed: true, evaluated: veredito.evaluated, violations: [] } })
  }

  /**
   * O preço com que o valor da operação é estimado.
   *
   * Numa limitada é o próprio limite. Numa a mercado, a última cotação — e se ela não
   * vier, o valor fica indefinido e as regras de valor BARRAM. É o certo: um limite que
   * some justo quando o mercado está estranho não é um limite.
   */
  const precoEstimado = async (args: Record<string, unknown>): Promise<number | null> => {
    const limite = numeroOuNulo(args.limitPrice)
    if (limite !== null) return limite
    try {
      const r = await cliente.data<{ quote?: Record<string, unknown> }>(`/v2/stocks/${encodeURIComponent(simbolo(args.symbol))}/quotes/latest`)
      return numeroOuNulo(r.quote?.ap) ?? numeroOuNulo(r.quote?.bp)
    } catch {
      return null
    }
  }

  const intencao = (args: Record<string, unknown>): OrderIntent => ({
    symbol: simbolo(args.symbol),
    side: texto(args.side).toLowerCase() === 'sell' ? 'sell' : 'buy',
    quantity: Number(args.quantity) || 0,
    type: texto(args.type).toLowerCase() === 'limit' ? 'limit' : 'market',
    limitPrice: numeroOuNulo(args.limitPrice),
    stopLossPrice: numeroOuNulo(args.stopLossPrice),
    takeProfitPrice: numeroOuNulo(args.takeProfitPrice),
  })

  /**
   * Enviar a ordem com chave de idempotência, e RECONCILIAR em vez de repetir.
   *
   * O caso que isto resolve: a conexão cai depois de a ordem chegar na corretora e
   * antes de a resposta voltar. Repetir mandaria a segunda ordem; desistir deixaria a
   * primeira aberta sem ninguém saber. Perguntar pelo `client_order_id` é a única
   * resposta que não inventa nem esconde.
   */
  const enviarOrdem = async (body: Record<string, unknown>) => {
    const chave = clientOrderId(contexto?.executionRef, body)
    /**
     * ANTES de escrever: esta ordem já existe?
     *
     * Uma tentativa anterior pode ter chegado e a resposta ter se perdido. Perguntar
     * primeiro custa uma leitura e evita a única falha que não dá para desfazer — a
     * ordem duplicada. Só faz sentido com chave derivada; com chave sorteada não há o
     * que perguntar.
     */
    if (contexto?.executionRef) {
      const jaExiste = await cliente
        .trading<Record<string, unknown>>('/v2/orders:by_client_order_id', { query: { client_order_id: chave } })
        .catch(() => null)
      if (jaExiste && texto(jaExiste.id)) return jaExiste
    }
    try {
      return await cliente.trading<Record<string, unknown>>('/v2/orders', { method: 'POST', body: { ...body, client_order_id: chave } })
    } catch (error) {
      // Só quando o resultado ficou INCERTO. Uma recusa é uma resposta: ela não deixou
      // nada pendurado do outro lado.
      if (!(error instanceof AlpacaError) || (error.kind !== 'network' && error.kind !== 'unavailable')) throw error
      try {
        const existente = await cliente.trading<Record<string, unknown>>('/v2/orders:by_client_order_id', {
          query: { client_order_id: chave },
        })
        if (existente && texto(existente.id)) return existente
      } catch {
        // A consulta também não foi. Não repetir é a escolha certa: uma ordem duplicada
        // é pior do que uma ordem que talvez não tenha saído.
      }
      throw error
    }
  }

  const ferramenta = (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    risk: ResolvedTool['risk'],
    run: (args: Record<string, unknown>, contar: Contador) => Promise<unknown>,
  ): ResolvedTool => ({
    name,
    description,
    inputSchema,
    risk,
    run: (args) => {
      // A chave da chamada chega pelos argumentos e SAI deles antes de qualquer coisa:
      // ela não é argumento da ação e não pode ir para a corretora nem para a validação.
      const { [ACTION_DETAIL_KEY]: chamada, ...limpos } = args as Record<string, unknown>
      const contar: Contador = (detalhe) => {
        if (typeof chamada === 'string') reportActionDetail(chamada, detalhe)
      }
      return responder(() => run(limpos, contar), contar)
    },
  })

  return [
    ferramenta(
      'alpaca_conta',
      'Consulta o saldo, o patrimônio e o poder de compra da conta na corretora.',
      schema({}),
      'read',
      async () => conta(await cliente.trading<Record<string, unknown>>('/v2/account')),
    ),

    ferramenta(
      'alpaca_posicoes',
      'Lista as posições abertas na conta, com preço médio e resultado não realizado.',
      schema({}),
      'read',
      async () => (await cliente.trading<Record<string, unknown>[]>('/v2/positions')).map(posicao),
    ),

    ferramenta(
      'alpaca_ordens',
      'Lista ordens da conta. Por padrão, as abertas.',
      schema({ status: str('open, closed ou all. Padrão: open.'), limit: num('quantas ordens listar (máx. 100)') }),
      'read',
      async (args) => {
        const limite = Math.min(Math.max(Number(args.limit) || 20, 1), 100)
        const lista = await cliente.trading<Record<string, unknown>[]>('/v2/orders', {
          query: { status: texto(args.status) || 'open', limit: String(limite) },
        })
        return lista.map(ordem)
      },
    ),

    ferramenta(
      'alpaca_cotacao',
      'Consulta a última cotação (melhor compra e melhor venda) de um ativo.',
      schema({ symbol: str('o ativo, ex.: AAPL') }, ['symbol']),
      'read',
      async (args) => {
        const symbol = simbolo(args.symbol)
        if (!symbol) throw new AlpacaError('informe o ativo', 'refused')
        const r = await cliente.data<{ quote?: Record<string, unknown> }>(`/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest`)
        const q = r.quote ?? {}
        return { symbol, bid: numeroOuNulo(q.bp), ask: numeroOuNulo(q.ap), bidSize: numeroOuNulo(q.bs), askSize: numeroOuNulo(q.as), at: texto(q.t) }
      },
    ),

    ferramenta(
      'alpaca_barras',
      'Busca as velas (OHLCV) já fechadas de um ativo. Serve para alimentar uma análise.',
      schema({ symbol: str('o ativo, ex.: AAPL'), timeframe: str('1Min, 5Min, 15Min, 1Hour ou 1Day'), limit: num('quantas velas (máx. 500)') }, ['symbol']),
      'read',
      async (args) => {
        const symbol = simbolo(args.symbol)
        if (!symbol) throw new AlpacaError('informe o ativo', 'refused')
        const limite = Math.min(Math.max(Number(args.limit) || 100, 1), 500)
        const r = await cliente.data<{ bars?: Record<string, unknown>[] }>(`/v2/stocks/${encodeURIComponent(symbol)}/bars`, {
          timeframe: texto(args.timeframe) || '5Min',
          limit: String(limite),
        })
        // Já no formato que o App de análise recebe — nenhuma conversão no meio do caminho.
        return (r.bars ?? []).map((b) => ({
          timestamp: Date.parse(texto(b.t)),
          open: numeroOuNulo(b.o) ?? 0,
          high: numeroOuNulo(b.h) ?? 0,
          low: numeroOuNulo(b.l) ?? 0,
          close: numeroOuNulo(b.c) ?? 0,
          volume: numeroOuNulo(b.v) ?? 0,
          closed: true,
        }))
      },
    ),

    ferramenta(
      'alpaca_criar_ordem',
      'Envia uma ordem de compra ou venda. Ação crítica: exige autorização autônoma explícita.',
      schema(
        {
          symbol: str('o ativo, ex.: AAPL'),
          side: str('buy ou sell'),
          quantity: num('quantidade de ações'),
          type: str('market ou limit. Padrão: market.'),
          limitPrice: num('preço limite, obrigatório em ordem limitada'),
          timeInForce: str('day, gtc, ioc ou fok. Padrão: day.'),
        },
        ['symbol', 'side', 'quantity'],
      ),
      'high_risk',
      async (args, contar) => {
        const body = ordemBase(args)
        await conferir(args, contar)
        const bruta = await enviarOrdem(body)
        contar({ orderId: texto(bruta.id) || null })
        return ordem(bruta)
      },
    ),

    ferramenta(
      'alpaca_ordem_bracket',
      'Envia uma ordem com stop-loss e take-profit já presos a ela. Ação crítica.',
      schema(
        {
          symbol: str('o ativo, ex.: AAPL'),
          side: str('buy ou sell'),
          quantity: num('quantidade de ações'),
          type: str('market ou limit. Padrão: market.'),
          limitPrice: num('preço limite da entrada, em ordem limitada'),
          takeProfitPrice: num('preço do take-profit'),
          stopLossPrice: num('preço do stop-loss'),
          timeInForce: str('day ou gtc. Padrão: gtc.'),
        },
        ['symbol', 'side', 'quantity', 'takeProfitPrice', 'stopLossPrice'],
      ),
      'high_risk',
      async (args, contar) => {
        const take = numeroOuNulo(args.takeProfitPrice)
        const stop = numeroOuNulo(args.stopLossPrice)
        // Um bracket sem uma das pernas não é um bracket: é uma ordem solta com a falsa
        // sensação de ter proteção.
        if (take === null || stop === null) throw new AlpacaError('a ordem bracket precisa do take-profit E do stop-loss', 'refused')
        const body = {
          ...ordemBase(args),
          time_in_force: texto(args.timeInForce).toLowerCase() || 'gtc',
          order_class: 'bracket',
          take_profit: { limit_price: String(take) },
          stop_loss: { stop_price: String(stop) },
        }
        await conferir(args, contar)
        const bruta = await enviarOrdem(body)
        contar({ orderId: texto(bruta.id) || null })
        return ordem(bruta)
      },
    ),

    ferramenta(
      'alpaca_cancelar_ordem',
      'Cancela uma ordem ainda aberta. Ação crítica.',
      schema({ orderId: str('o id da ordem') }, ['orderId']),
      'high_risk',
      async (args, contar) => {
        const id = texto(args.orderId).trim()
        if (!id) throw new AlpacaError('informe o id da ordem', 'refused')
        await cliente.trading(`/v2/orders/${encodeURIComponent(id)}`, { method: 'DELETE' })
        contar({ orderId: id })
        return { canceled: true, orderId: id }
      },
    ),

    ferramenta(
      'alpaca_substituir_ordem',
      'Altera quantidade ou preço de uma ordem aberta. Ação crítica.',
      schema({ orderId: str('o id da ordem'), quantity: num('nova quantidade'), limitPrice: num('novo preço limite'), stopPrice: num('novo preço de stop') }, ['orderId']),
      'high_risk',
      async (args, contar) => {
        const id = texto(args.orderId).trim()
        if (!id) throw new AlpacaError('informe o id da ordem', 'refused')
        const qty = numeroOuNulo(args.quantity)
        const limit = numeroOuNulo(args.limitPrice)
        const stop = numeroOuNulo(args.stopPrice)
        if (qty === null && limit === null && stop === null) throw new AlpacaError('informe o que deve mudar na ordem', 'refused')

        /**
         * Alterar uma ordem pode AUMENTAR a exposição — e aí é uma ordem nova para a
         * política, ainda que a corretora chame de PATCH. Sem isto, o teto de valor era
         * contornável em dois passos: mandar o mínimo e depois alterar para o dobro.
         *
         * Reduzir continua livre: uma regra que impede diminuir posição é uma regra que
         * prende alguém dentro dela.
         */
        const atual = await cliente.trading<Record<string, unknown>>(`/v2/orders/${encodeURIComponent(id)}`)
        const qtdAtual = numeroOuNulo(atual.qty) ?? 0
        const precoAtual = numeroOuNulo(atual.limit_price)
        const aumenta = (qty !== null && qty > qtdAtual) || (limit !== null && precoAtual !== null && limit > precoAtual)
        if (aumenta) {
          await conferir({
            symbol: texto(atual.symbol),
            side: texto(atual.side),
            quantity: qty ?? qtdAtual,
            type: limit !== null ? 'limit' : texto(atual.type),
            limitPrice: limit ?? precoAtual,
          }, contar)
        }

        const body = {
          ...(qty !== null ? { qty: String(qty) } : {}),
          ...(limit !== null ? { limit_price: String(limit) } : {}),
          ...(stop !== null ? { stop_price: String(stop) } : {}),
        }
        const trocada = await cliente.trading<Record<string, unknown>>(`/v2/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body })
        contar({ orderId: texto(trocada.id) || id })
        return ordem(trocada)
      },
    ),

    ferramenta(
      'alpaca_fechar_posicao',
      'Encerra uma posição aberta, vendendo (ou recomprando) o que houver. Ação crítica.',
      schema({ symbol: str('o ativo da posição'), quantity: num('quantidade a encerrar; vazio encerra tudo') }, ['symbol']),
      'high_risk',
      async (args) => {
        const symbol = simbolo(args.symbol)
        if (!symbol) throw new AlpacaError('informe o ativo', 'refused')
        const qty = numeroOuNulo(args.quantity)
        return ordem(
          await cliente.trading<Record<string, unknown>>(`/v2/positions/${encodeURIComponent(symbol)}`, {
            method: 'DELETE',
            ...(qty !== null ? { query: { qty: String(qty) } } : {}),
          }),
        )
      },
    ),
  ]
}

// O ambiente vem da CONEXÃO, nunca de um campo de configuração: é ele que decide se a
// ordem vai para a simulação ou para o mercado.
//
// Cancelar e encerrar posição NÃO passam pela política, de propósito: uma regra que
// impede alguém de sair de uma posição é pior do que regra nenhuma.
export const alpacaTools: NativeFactory = (ownerId, config, ctx) =>
  buildAlpacaTools(
    config,
    ctx?.environment ?? 'paper',
    {},
    ctx?.installationId
      ? { ownerId, installationId: ctx.installationId, agentId: ctx.agentId ?? null, executionRef: ctx.executionRef ?? null }
      : undefined,
  )

export const adapters: NativeFactory[] = [alpacaTools]

/**
 * A sonda de conexão: uma leitura de verdade, com prazo, que não devolve nada da conta.
 *
 * `GET /v2/account` é a chamada mais barata que só funciona com credencial válida. O
 * que sai daqui é "deu" ou "não deu" e o motivo — nunca saldo, nunca número de conta,
 * nunca o corpo da resposta.
 */
export const alpacaProbe = async (
  config: Record<string, string>,
  environment: string,
  deps: ClientDeps = {},
): Promise<{ ok: boolean; message: string }> => {
  const keyId = config.keyId?.trim() ?? ''
  const secretKey = config.secretKey?.trim() ?? ''
  if (!keyId || !secretKey) return { ok: false, message: 'Faltam as duas chaves da corretora.' }
  try {
    const cliente = createAlpacaClient({ keyId, secretKey }, environment, { timeoutMs: PROBE_TIMEOUT_MS, ...deps })
    const conta = await cliente.trading<Record<string, unknown>>('/v2/account')
    const status = typeof conta.status === 'string' ? conta.status : ''
    // O status da conta é informação de configuração, não de dinheiro: ele diz se a
    // conta consegue operar. Saldo não sai daqui.
    if (status && status !== 'ACTIVE') return { ok: false, message: `A conta existe, mas está "${status}" na corretora.` }
    return { ok: true, message: `Conexão de simulação respondendo (${environment}).` }
  } catch (error) {
    if (error instanceof AlpacaError) return { ok: false, message: error.message }
    return { ok: false, message: 'Não foi possível falar com a corretora.' }
  }
}

registerConnectionProbe('alpaca', (config, environment) => alpacaProbe(config, environment))
