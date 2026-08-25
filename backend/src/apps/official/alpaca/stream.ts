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

  subscribeMessage: (symbols) => ({ action: 'subscribe', trades: [...symbols] }),
  unsubscribeMessage: (symbols) => ({ action: 'unsubscribe', trades: [...symbols] }),

  // A Alpaca fecha uma conexão parada. O ping mantém o socket vivo entre pregões.
  heartbeatMessage: () => ({ action: 'listen' }),

  errorOf: (raw) => {
    const erro = mensagens(raw).find((m) => m.T === 'error')
    return erro ? `alpaca: ${String(erro.msg ?? 'erro sem descrição')} (${String(erro.code ?? '?')})` : null
  },

  parse: (raw, ctx): PublishInput[] => {
    const saida: PublishInput[] = []
    for (const m of mensagens(raw)) {
      // Só negócio vira fato de mercado. `success`, `subscription` e `error` são
      // controle — responder a eles com um evento encheria o barramento de nada.
      if (m.T !== 't') continue
      const symbol = String(m.S ?? '').toUpperCase()
      const price = asNumber(m.p)
      const at = new Date(String(m.t ?? ''))
      if (!symbol || price === null || Number.isNaN(at.getTime())) continue
      saida.push({
        ownerId: ctx.ownerId,
        type: 'market.price.updated',
        source: ctx.source,
        schemaVersion: MARKET_SCHEMA_VERSION,
        payload: {
          ownerId: ctx.ownerId,
          provider: 'alpaca',
          installationId: ctx.installationId,
          environment: ctx.environment,
          symbol,
          price,
          size: asNumber(m.s) ?? 0,
          at: at.toISOString(),
          tradeId: m.i === undefined ? null : String(m.i),
        },
        occurredAt: at,
        // O id do negócio na corretora é o que torna o eco da reconexão reconhecível.
        // Sem ele, o par (ativo, instante) é o melhor que dá — e dois negócios no mesmo
        // milissegundo viram um só, que é menos errado do que contar o mesmo duas vezes.
        dedupeKey: `alpaca:${ctx.installationId}:${symbol}:${m.i ?? at.getTime()}`,
      })
    }
    return saida
  },
}
