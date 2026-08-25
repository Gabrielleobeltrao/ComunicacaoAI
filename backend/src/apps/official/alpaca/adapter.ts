import type { ResolvedTool } from '../../../agentTools.js'
import type { NativeFactory } from '../../types.js'
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

/** Toda ferramenta responde igual: ou o dado, ou o motivo — nunca uma exceção crua. */
const responder = async (trabalho: () => Promise<unknown>): Promise<{ ok: boolean; result: string }> => {
  try {
    return { ok: true, result: JSON.stringify(await trabalho()) }
  } catch (error) {
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

export function buildAlpacaTools(config: Record<string, string>, environment: string, deps: ClientDeps = {}): ResolvedTool[] {
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

  const ferramenta = (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    risk: ResolvedTool['risk'],
    run: (args: Record<string, unknown>) => Promise<unknown>,
  ): ResolvedTool => ({ name, description, inputSchema, risk, run: (args) => responder(() => run(args)) })

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
      async (args) => ordem(await cliente.trading<Record<string, unknown>>('/v2/orders', { method: 'POST', body: ordemBase(args) })),
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
      async (args) => {
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
        return ordem(await cliente.trading<Record<string, unknown>>('/v2/orders', { method: 'POST', body }))
      },
    ),

    ferramenta(
      'alpaca_cancelar_ordem',
      'Cancela uma ordem ainda aberta. Ação crítica.',
      schema({ orderId: str('o id da ordem') }, ['orderId']),
      'high_risk',
      async (args) => {
        const id = texto(args.orderId).trim()
        if (!id) throw new AlpacaError('informe o id da ordem', 'refused')
        await cliente.trading(`/v2/orders/${encodeURIComponent(id)}`, { method: 'DELETE' })
        return { canceled: true, orderId: id }
      },
    ),

    ferramenta(
      'alpaca_substituir_ordem',
      'Altera quantidade ou preço de uma ordem aberta. Ação crítica.',
      schema({ orderId: str('o id da ordem'), quantity: num('nova quantidade'), limitPrice: num('novo preço limite'), stopPrice: num('novo preço de stop') }, ['orderId']),
      'high_risk',
      async (args) => {
        const id = texto(args.orderId).trim()
        if (!id) throw new AlpacaError('informe o id da ordem', 'refused')
        const qty = numeroOuNulo(args.quantity)
        const limit = numeroOuNulo(args.limitPrice)
        const stop = numeroOuNulo(args.stopPrice)
        if (qty === null && limit === null && stop === null) throw new AlpacaError('informe o que deve mudar na ordem', 'refused')
        const body = {
          ...(qty !== null ? { qty: String(qty) } : {}),
          ...(limit !== null ? { limit_price: String(limit) } : {}),
          ...(stop !== null ? { stop_price: String(stop) } : {}),
        }
        return ordem(await cliente.trading<Record<string, unknown>>(`/v2/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body }))
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
export const alpacaTools: NativeFactory = (_ownerId, config, ctx) => buildAlpacaTools(config, ctx?.environment ?? 'paper')

export const adapters: NativeFactory[] = [alpacaTools]
