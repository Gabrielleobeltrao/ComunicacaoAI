import { db } from '../db.js'
import type { MarketState, Quote, Trade } from './types.js'
import type { SeriesKey } from './candleStore.js'

// O ÚLTIMO preço conhecido. Não é histórico — é o estado atual, e some sozinho.
const estados = db.collection<MarketState>('market_state')

/** Por quanto tempo um preço sem atualização ainda é "o último preço". */
export const STATE_TTL_MS = Number(process.env.MARKET_STATE_TTL_MS ?? 24 * 60 * 60_000)

export async function ensureMarketStateIndexes(): Promise<void> {
  await estados.createIndex(
    { ownerId: 1, provider: 1, installationId: 1, environment: 1, symbol: 1 },
    { unique: true },
  )
  await estados.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

const filtroDe = (k: SeriesKey) => ({
  ownerId: k.ownerId,
  provider: k.provider,
  installationId: k.installationId,
  environment: k.environment,
  symbol: k.symbol,
})

/**
 * Guardar, só se for mesmo mais novo.
 *
 * Não dá para fazer isso com um upsert condicional: quando o guardado já é mais novo,
 * o filtro não casa e o Mongo tenta INSERIR — batendo no índice único. O erro que isso
 * produzia era de chave duplicada, que não tem nada a ver com o que realmente
 * aconteceu (chegou um dado atrasado).
 *
 * Então é explícito: tenta atualizar com a guarda, insere se não existir, e se a
 * inserção colidir volta para o update — na segunda passada o documento existe, e não
 * casar quer dizer o que parece: o nosso dado é o velho.
 */
async function guardar(k: SeriesKey, at: Date, campos: Record<string, unknown>, iniciais: Record<string, unknown>, now: Date): Promise<boolean> {
  const filtro = filtroDe(k)
  const set = { ...campos, at, updatedAt: now, expiresAt: new Date(now.getTime() + STATE_TTL_MS) }
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const r = await estados.updateOne({ ...filtro, at: { $lt: at } }, { $set: set })
    if (r.matchedCount === 1) return true
    try {
      await estados.insertOne({ ...filtro, ...iniciais, ...set } as MarketState)
      return true
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error
      // Alguém inseriu entre a nossa leitura e a nossa escrita. Volta para o update.
    }
  }
  return false
}

/**
 * O último preço. Uma mensagem atrasada que chega depois da nova não pode fazer o
 * preço andar para trás — senão uma reconexão que reenvia dois minutos de histórico
 * deixaria o painel mostrando um preço de dois minutos atrás.
 */
export const rememberTrade = (k: SeriesKey, trade: Trade, now = new Date()): Promise<boolean> =>
  guardar(k, trade.at, { price: trade.price }, { bid: null, ask: null }, now)

export const rememberQuote = (k: SeriesKey, quote: Quote, now = new Date()): Promise<boolean> =>
  guardar(k, quote.at, { bid: quote.bid, ask: quote.ask }, { price: null }, now)

export const readState = (k: SeriesKey): Promise<MarketState | null> => estados.findOne(filtroDe(k))
export const listStates = (ownerId: string): Promise<MarketState[]> => estados.find({ ownerId }).sort({ symbol: 1 }).toArray()
export const marketStateCollection = estados
