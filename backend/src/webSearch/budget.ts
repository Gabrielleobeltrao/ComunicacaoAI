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
  await eventos.createIndex({ agentId: 1, month: 1 })
  await eventos.createIndex({ agentId: 1, createdAt: -1 })
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

/**
 * Uma busca que aconteceu — por AGENTE.
 *
 * O orçamento acima conta requisições da instalação, que é o que protege a fatura. Isto
 * conta outra coisa: quem gastou, no quê, e com que resultado. São perguntas diferentes,
 * e um número global não responde "este pesquisador está valendo a pena?".
 */
export interface SearchEvent {
  agentId: string | null
  ownerId: string | null
  provider: string
  query: string
  /**
   * O que aconteceu, em três estados que pedem ações diferentes:
   *
   *   `sent`    — a requisição saiu e gastou franquia.
   *   `blocked` — a franquia acabou: NÃO saiu e NÃO gastou. Nada a corrigir no agente.
   *   `avoided` — a base já respondia: não precisou sair. É a economia da memória.
   *
   * Antes havia só `performed`, e um bloqueio de franquia era gravado como busca feita —
   * o painel mostrava consumo que não existiu, e um agente parado por falta de cota
   * parecia um agente gastando.
   */
  outcome?: 'sent' | 'blocked' | 'avoided'
  /** Mantido: `outcome === 'sent'`. Continua aqui para não quebrar leitor antigo. */
  performed: boolean
  skipReason?: string | null
  found: number
  pagesRead: number
  evidence: number
  /** Quantas páginas viraram documento na base do agente. */
  saved: number
  ok: boolean
  code?: string | null
  durationMs: number
  createdAt: Date
  day: string
  month: string
}

const eventos = db.collection<SearchEvent>('web_search_events')

export async function recordSearchEvent(e: Omit<SearchEvent, 'createdAt' | 'day' | 'month'>, agora: Date = new Date()): Promise<void> {
  // `performed` é derivado de `outcome` quando ele vem, para os dois campos nunca
  // discordarem. Um evento antigo, sem `outcome`, é lido pelo `performed` que já tinha.
  const outcome = e.outcome ?? (e.performed ? 'sent' : 'avoided')
  await eventos
    .insertOne({
      ...e,
      outcome,
      performed: outcome === 'sent',
      // A consulta é do dono, e pode carregar o que ele digitou. Vai cortada, e é o
      // suficiente para reconhecer a busca no painel.
      query: (e.query ?? '').slice(0, 200),
      createdAt: agora,
      day: agora.toISOString().slice(0, 10),
      month: searchPeriod(agora),
    } as SearchEvent)
    .catch(() => undefined)
}

export interface AgentSearchStats {
  /** Buscas que SAÍRAM no mês corrente (UTC) — as que gastaram franquia. */
  searchesThisMonth: number
  searchesToday: number
  /** Buscas que NÃO aconteceram porque a base já respondia. É a economia. */
  avoidedThisMonth: number
  /** Buscas barradas pela franquia: não saíram e não gastaram. Não são consumo. */
  blockedThisMonth: number
  pagesRead: number
  documentsSaved: number
  failures: number
  lastSearchAt: string | null
  lastQuery: string | null
}

/** O que este agente gastou — e o que ele deixou de gastar. */
export async function agentSearchStats(agentId: string, agora: Date = new Date()): Promise<AgentSearchStats> {
  const month = searchPeriod(agora)
  const day = agora.toISOString().slice(0, 10)
  // `outcome` decide; um evento antigo, sem ele, é lido pelo `performed`. Assim a leitura
  // nunca conta um bloqueio de franquia como consumo — que era o defeito.
  const estado = { $ifNull: ['$outcome', { $cond: ['$performed', 'sent', 'avoided'] }] }
  const enviada = { $eq: [estado, 'sent'] }
  const [resumo] = await eventos
    .aggregate<{ feitas: number; evitadas: number; bloqueadas: number; hoje: number; paginas: number; salvos: number; falhas: number }>([
      { $match: { agentId, month } },
      {
        $group: {
          _id: null,
          feitas: { $sum: { $cond: [enviada, 1, 0] } },
          evitadas: { $sum: { $cond: [{ $eq: [estado, 'avoided'] }, 1, 0] } },
          bloqueadas: { $sum: { $cond: [{ $eq: [estado, 'blocked'] }, 1, 0] } },
          hoje: { $sum: { $cond: [{ $and: [enviada, { $eq: ['$day', day] }] }, 1, 0] } },
          paginas: { $sum: '$pagesRead' },
          salvos: { $sum: '$saved' },
          falhas: { $sum: { $cond: [{ $and: [enviada, { $eq: ['$ok', false] }] }, 1, 0] } },
        },
      },
    ])
    .toArray()
    .catch(() => [])

  const [ultima] = await eventos.find({ agentId, performed: true }).sort({ createdAt: -1 }).limit(1).toArray().catch(() => [])
  return {
    searchesThisMonth: resumo?.feitas ?? 0,
    searchesToday: resumo?.hoje ?? 0,
    avoidedThisMonth: resumo?.evitadas ?? 0,
    blockedThisMonth: resumo?.bloqueadas ?? 0,
    pagesRead: resumo?.paginas ?? 0,
    documentsSaved: resumo?.salvos ?? 0,
    failures: resumo?.falhas ?? 0,
    lastSearchAt: ultima?.createdAt ? ultima.createdAt.toISOString() : null,
    lastQuery: ultima?.query ?? null,
  }
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
  await eventos.deleteMany({ provider })
}
