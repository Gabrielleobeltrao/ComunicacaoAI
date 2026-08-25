import type { StreamAdapter } from '../../../streams/types.js'
import { MARKET_SCHEMA_VERSION } from '../../../marketData/types.js'
import type { PublishInput } from '../../../events/types.js'

/**
 * O stream de mercado da Alpaca.
 *
 * Tudo que é específico dela está aqui: a URL, o formato do `subscribe`, o fato de que
 * um quadro é uma LISTA de mensagens, e que `T` diz o que cada uma é. O gerenciador
 * não sabe nada disso — e é por isso que a segunda corretora será outro arquivo, e não
 * mais um `if`.
 */

/**
 * IEX é a fonte gratuita e é o padrão. `sip` exige assinatura na corretora, e escolher
 * por conta própria daria um erro de permissão que ninguém entenderia.
 */
const FEED = (process.env.ALPACA_STREAM_FEED ?? 'iex').trim().toLowerCase()

const asNumber = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Um quadro da Alpaca é sempre uma lista, mesmo com uma mensagem só. */
const mensagens = (raw: unknown): Record<string, unknown>[] =>
  Array.isArray(raw) ? (raw.filter((m) => typeof m === 'object' && m !== null) as Record<string, unknown>[]) : []

export const alpacaStreamAdapter: StreamAdapter = {
  appKey: 'alpaca',

  // Ambiente não muda o endereço do dado: cotação é a mesma para quem simula e para
  // quem opera. O que muda de ambiente é a CONTA, e conta não passa por aqui.
  url: () => `wss://stream.data.alpaca.markets/v2/${FEED}`,

  // A credencial vai numa mensagem, e não num cabeçalho de handshake. Ela é montada
  // aqui e entregue direto ao socket — o gerenciador nunca a registra.
  authMessage: (cred) => ({ action: 'auth', key: cred.keyId, secret: cred.secretKey }),

  /**
   * Negócios, cotações e barras — os três, na mesma assinatura.
   *
   * A barra do provider é de um minuto e chega pronta; ela NÃO substitui a nossa vela
   * (que sai dos negócios e existe em seis períodos), serve para conferir e para quem
   * quiser reagir ao que a corretora considera fechado. Dois candles para o mesmo
   * minuto seriam duas verdades, então cada um vira um contrato diferente.
   */
  subscribeMessage: (symbols) => ({ action: 'subscribe', trades: [...symbols], quotes: [...symbols], bars: [...symbols] }),
  unsubscribeMessage: (symbols) => ({ action: 'unsubscribe', trades: [...symbols], quotes: [...symbols], bars: [...symbols] }),

  // A Alpaca fecha uma conexão parada. O ping mantém o socket vivo entre pregões.
  heartbeatMessage: () => ({ action: 'listen' }),

  // `authenticated` é o único aviso de que a credencial passou. Sem ele, um teste só
  // saberia que o socket abriu — e ele abre com chave errada também.
  authOkOf: (raw) => mensagens(raw).some((m) => m.T === 'success' && String(m.msg ?? '') === 'authenticated'),

  errorOf: (raw) => {
    const erro = mensagens(raw).find((m) => m.T === 'error')
    return erro ? `alpaca: ${String(erro.msg ?? 'erro sem descrição')} (${String(erro.code ?? '?')})` : null
  },

  parse: (raw, ctx): PublishInput[] => {
    const saida: PublishInput[] = []
    for (const m of mensagens(raw)) {
      // `success`, `subscription` e `error` são controle — responder a eles com um
      // evento encheria o barramento de nada.
      const symbol = String(m.S ?? '').toUpperCase()
      const at = new Date(String(m.t ?? ''))
      if (!symbol || Number.isNaN(at.getTime())) continue
      const base = {
        ownerId: ctx.ownerId,
        provider: 'alpaca',
        installationId: ctx.installationId,
        environment: ctx.environment,
        symbol,
        at: at.toISOString(),
      }

      if (m.T === 't') {
        const price = asNumber(m.p)
        if (price === null) continue
        saida.push({
          ownerId: ctx.ownerId,
          type: 'market.price.updated',
          source: ctx.source,
          schemaVersion: MARKET_SCHEMA_VERSION,
          payload: { ...base, price, size: asNumber(m.s) ?? 0, tradeId: m.i === undefined ? null : String(m.i) },
          occurredAt: at,
          // O id do negócio na corretora é o que torna o eco da reconexão reconhecível.
          // Sem ele, o par (ativo, instante) é o melhor que dá — e dois negócios no mesmo
          // milissegundo viram um só, que é menos errado do que contar o mesmo duas vezes.
          dedupeKey: `alpaca:${ctx.installationId}:t:${symbol}:${m.i ?? at.getTime()}`,
        })
        continue
      }

      if (m.T === 'q') {
        const bid = asNumber(m.bp)
        const ask = asNumber(m.ap)
        // Uma cotação sem os dois lados não descreve um mercado.
        if (bid === null || ask === null) continue
        saida.push({
          ownerId: ctx.ownerId,
          type: 'market.quote.updated',
          source: ctx.source,
          schemaVersion: MARKET_SCHEMA_VERSION,
          payload: { ...base, bid, ask, bidSize: asNumber(m.bs) ?? 0, askSize: asNumber(m.as) ?? 0 },
          occurredAt: at,
          dedupeKey: `alpaca:${ctx.installationId}:q:${symbol}:${at.getTime()}`,
        })
        continue
      }

      if (m.T === 'b') {
        const o = asNumber(m.o)
        const h = asNumber(m.h)
        const l = asNumber(m.l)
        const c = asNumber(m.c)
        if (o === null || h === null || l === null || c === null) continue
        saida.push({
          ownerId: ctx.ownerId,
          type: 'market.bar.closed',
          source: ctx.source,
          schemaVersion: MARKET_SCHEMA_VERSION,
          // A barra do stream da Alpaca é sempre de um minuto.
          payload: { ...base, timeframe: '1m', open: o, high: h, low: l, close: c, volume: asNumber(m.v) ?? 0 },
          occurredAt: at,
          dedupeKey: `alpaca:${ctx.installationId}:b:${symbol}:${at.getTime()}`,
        })
      }
    }
    return saida
  },
}
