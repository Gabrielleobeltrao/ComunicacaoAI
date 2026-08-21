// A franquia mensal do serviço de busca — global, e da INSTALAÇÃO.
//
// O plano gratuito do Brave conta requisições por mês. Passar dele não devolve erro: vira
// cobrança. Então o teto é aplicado aqui, antes da chamada sair.
//
// Duas escolhas que definem o comportamento:
//
// 1. O contador é GLOBAL. A franquia pertence à CHAVE, não ao usuário nem ao agente:
//    dois donos usando o mesmo servidor gastam a mesma cota. Contar por dono daria um
//    número bonito e uma fatura errada.
//
// 2. Uma tentativa conta MESMO QUE FALHE. Do lado do Brave, uma requisição que saiu foi
//    uma requisição — ele não devolve a cota porque a resposta deu erro. Devolver aqui
//    faria nosso número divergir do dele, e divergir para menos é o lado perigoso.
//
// A reserva é atômica pelo mesmo motivo do orçamento de embedding: consultar e depois
// decidir é uma corrida que várias execuções paralelas vencem juntas.
import { db } from '../db.js'

/** O teto do PLANO GRATUITO. Com uso pago desligado, nada configura acima disto. */
export const BRAVE_FREE_MONTHLY_REQUESTS = 900

export interface SearchBudgetConfig {
  paidUsageEnabled: boolean
  monthlyRequestLimit: number
}

const ligado = (nome: string, padrao: boolean): boolean => {
  const bruto = process.env[nome]?.trim().toLowerCase()
  if (bruto === '1' || bruto === 'true') return true
  if (bruto === '0' || bruto === 'false') return false
  return padrao
}

/**
 * O teto vigente.
 *
 * Com uso pago DESLIGADO o valor é limitado a 900 mesmo que a variável peça mais. Isso é
 * deliberado: quem configura 5000 sem ligar o uso pago está pedindo uma conta, não um
 * limite — e a variável não é o lugar de tomar essa decisão sozinha.
 */
export function searchBudgetConfig(): SearchBudgetConfig {
  const paidUsageEnabled = ligado('BRAVE_PAID_USAGE_ENABLED', false)
  const pedido = Number(process.env.BRAVE_MONTHLY_REQUEST_LIMIT)
  const bruto = Number.isFinite(pedido) && pedido > 0 ? Math.trunc(pedido) : BRAVE_FREE_MONTHLY_REQUESTS
  return {
    paidUsageEnabled,
    monthlyRequestLimit: paidUsageEnabled ? bruto : Math.min(bruto, BRAVE_FREE_MONTHLY_REQUESTS),
  }
}

/** Um documento por MÊS. O período novo nasce sozinho na primeira chamada dele. */
interface SearchBudgetDoc {
  _id: string // `${provider}:${YYYY-MM}` em UTC
  provider: string
  period: string
  used: number
  updatedAt: Date
}

const orcamento = db.collection<SearchBudgetDoc>('web_search_budget')

export async function ensureWebSearchIndexes(): Promise<void> {
  // Idempotente: `createIndex` sobre um índice que já existe não faz nada.
  await orcamento.createIndex({ provider: 1, period: 1 })
}

/** O mês em UTC. É o fuso do provedor de nuvem, e não o de quem olha a tela. */
export const searchPeriod = (agora: Date = new Date()): string => agora.toISOString().slice(0, 7)

/** Quando o contador zera: o primeiro instante do mês seguinte, em UTC. */
export function searchPeriodResetAt(agora: Date = new Date()): Date {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 1, 0, 0, 0, 0))
}

export type SearchDenial = 'monthly_limit_reached' | 'not_configured'

export interface SearchReservation {
  ok: boolean
  code?: SearchDenial
  reason?: string
  used: number
  limit: number
}

/**
 * Reserva UMA requisição — ou recusa, antes de o Brave ser chamado.
 *
 * A condição `used < limite` vive no FILTRO, então o banco a avalia e incrementa na mesma
 * operação: a chamada 901 não casa mais o filtro e não sai. Duas execuções paralelas na
 * posição 900 não passam as duas.
 */
export async function reserveSearchRequest(
  provider: string,
  cfg: SearchBudgetConfig = searchBudgetConfig(),
  agora: Date = new Date(),
): Promise<SearchReservation> {
  const period = searchPeriod(agora)
  const _id = `${provider}:${period}`
  const limite = cfg.monthlyRequestLimit

  // Garante o documento do período. Um mês novo começa em zero sem ninguém migrar nada.
  await orcamento.updateOne({ _id }, { $setOnInsert: { provider, period, used: 0, updatedAt: agora } }, { upsert: true })

  const r = await orcamento.findOneAndUpdate(
    { _id, used: { $lt: limite } },
    { $inc: { used: 1 }, $set: { updatedAt: agora } },
    { returnDocument: 'after' },
  )
  if (!r) {
    const atual = await orcamento.findOne({ _id })
    return {
      ok: false,
      code: 'monthly_limit_reached',
      reason: `a franquia mensal de busca acabou: ${atual?.used ?? limite} de ${limite} requisições neste mês (UTC). Ela volta em ${searchPeriodResetAt(agora).toISOString().slice(0, 10)}.`,
      used: atual?.used ?? limite,
      limit: limite,
    }
  }
  return { ok: true, used: r.used, limit: limite }
}

/**
 * Devolve uma requisição que NÃO chegou a ser enviada.
 *
 * Só para isso. Uma chamada que saiu e falhou não volta: do lado do Brave ela foi
 * cobrada, e o contador que diverge para menos é o que produz a fatura surpresa.
 */
export async function releaseSearchRequest(provider: string, agora: Date = new Date()): Promise<void> {
  await orcamento.updateOne({ _id: `${provider}:${searchPeriod(agora)}`, used: { $gt: 0 } }, { $inc: { used: -1 } }).catch(() => undefined)
}

export interface SearchBudgetStatus {
  configured: boolean
  provider: string
  used: number
  limit: number
  remaining: number
  period: string
  resetAt: string
  paidUsageEnabled: boolean
}

/**
 * O que o painel mostra. NUNCA a chave, nem o nome dela, nem um pedaço.
 *
 * `configured` é a única coisa que se diz sobre a credencial: existe ou não existe.
 */
export async function searchBudgetStatus(
  provider: string,
  configured: boolean,
  cfg: SearchBudgetConfig = searchBudgetConfig(),
  agora: Date = new Date(),
): Promise<SearchBudgetStatus> {
  const period = searchPeriod(agora)
  const doc = await orcamento.findOne({ _id: `${provider}:${period}` }).catch(() => null)
  const used = doc?.used ?? 0
  return {
    configured,
    provider,
    used,
    limit: cfg.monthlyRequestLimit,
    remaining: Math.max(0, cfg.monthlyRequestLimit - used),
    period,
    resetAt: searchPeriodResetAt(agora).toISOString(),
    paidUsageEnabled: cfg.paidUsageEnabled,
  }
}

/** Só para teste. */
export async function resetSearchBudget(provider = 'brave'): Promise<void> {
  await orcamento.deleteMany({ provider })
}
