import { db } from '../db.js'
import type { SeriesKey } from './candleStore.js'
import type { Trade } from './types.js'

/**
 * O tick CRU, desligado por padrão.
 *
 * Guardar cada negócio é a forma mais fácil de encher um banco sem perceber: um ativo
 * líquido faz milhares por minuto, e ninguém olha nenhum deles. A vela é o que se usa;
 * o tick só serve para conferir a vela quando algo parece errado.
 *
 * Por isso ligar exige dizer QUANTOS — e o limite não é um pedido educado, é uma
 * coleção limitada: o Mongo descarta o mais antigo sozinho quando estoura.
 */
export const rawTickLimit = (): number => {
  const n = Number(process.env.MARKET_RAW_TICKS_MAX ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

export const rawTicksEnabled = (): boolean => rawTickLimit() > 0

const NOME = 'market_ticks'

export async function ensureTickCollection(): Promise<void> {
  if (!rawTicksEnabled()) return
  const existe = await db.listCollections({ name: NOME }).toArray()
  if (existe.length) return
  const max = rawTickLimit()
  // ~256 bytes por tick com folga. O teto de documentos é o que foi pedido; o de bytes
  // é o cinto de segurança para o caso de um provider mandar campos gordos.
  await db.createCollection(NOME, { capped: true, size: max * 256, max })
}

export async function recordTick(k: SeriesKey, trade: Trade, now = new Date()): Promise<void> {
  if (!rawTicksEnabled()) return
  await db
    .collection(NOME)
    .insertOne({
      ownerId: k.ownerId,
      provider: k.provider,
      installationId: k.installationId,
      environment: k.environment,
      symbol: trade.symbol,
      price: trade.price,
      size: trade.size,
      at: trade.at,
      tradeId: trade.tradeId,
      recordedAt: now,
    })
    .catch(() => undefined)
}
