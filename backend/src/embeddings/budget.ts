// A franquia gratuita do provedor de embedding — e a garantia de não passar dela.
//
// O problema que este módulo resolve não é contar tokens. É que a conta do provedor tem
// uma franquia, e o dia em que ela acaba o sistema não para: ele começa a COBRAR, em
// silêncio, uma chamada de cada vez. Ninguém percebe até a fatura.
//
// A regra é simples e a implementação não pode ser ingênua: "somar o uso e comparar com
// o teto" é uma condição de corrida. Vinte indexações paralelas leem o mesmo saldo, cada
// uma conclui que cabe, e juntas passam. Por isso aqui não se CONSULTA saldo: reserva-se.
// A reserva é um `findOneAndUpdate` condicional — o próprio banco decide, uma por vez,
// se ainda cabe. Quem não conseguir a reserva não chama a API.
//
// Depois da chamada a reserva é acertada com o número REAL que o provedor informou (ou
// devolvida inteira, se a chamada falhou). Estimativa serve para decidir; o que fica
// registrado é o que aconteceu.
//
// A franquia é da CONTA, não do modelo: trocar de modelo não ganha franquia nova. Por
// isso o contador é um só, e a instalação inteira compartilha — não é por dono.
import { db } from '../db.js'

/** O que se sabe sobre um provedor de embedding, sem falar com ele. */
export interface EmbeddingBudgetConfig {
  provider: string
  /** Uso pago liberado? Falso = o sistema para na franquia em vez de faturar. */
  paidUsageEnabled: boolean
  /** O teto é aplicado? Desligar isto é uma decisão explícita de quem opera. */
  hardLimitEnabled: boolean
  /** A franquia declarada da conta, em tokens. Só informa o percentual. */
  freeTokenLimit: number
  /** Onde o sistema PARA. Abaixo da franquia de propósito: estimativa erra. */
  hardStopTokens: number
  /** Teto de tokens numa única chamada. Um documento gigante não vira uma requisição só. */
  maxTokensPerRequest: number
  /** Teto por dia. Zero = sem teto diário. */
  dailyTokenLimit: number
  /** Teto por mês, interno. Zero = só a franquia manda. */
  monthlyTokenLimit: number
}

const numero = (nome: string, padrao: number): number => {
  const bruto = Number(process.env[nome])
  return Number.isFinite(bruto) && bruto >= 0 ? bruto : padrao
}
const ligado = (nome: string, padrao: boolean): boolean => {
  const bruto = process.env[nome]?.trim().toLowerCase()
  if (bruto === '1' || bruto === 'true') return true
  if (bruto === '0' || bruto === 'false') return false
  return padrao
}

/**
 * A configuração vigente. Lida a cada chamada porque o operador pode mudá-la sem deploy.
 *
 * O padrão é o SEGURO: uso pago desligado e teto ligado. Uma instalação que nunca leu
 * esta documentação não gera fatura por engano — no máximo para de indexar, que é um
 * problema visível e reversível.
 */
export function embeddingBudgetConfig(): EmbeddingBudgetConfig {
  const franquia = numero('VOYAGE_FREE_TOKEN_LIMIT', 200_000_000)
  // O corte fica ABAIXO da franquia: a estimativa erra para menos às vezes, e a margem
  // é o que impede que o erro vire cobrança.
  const corte = numero('VOYAGE_HARD_STOP_TOKENS', Math.floor(franquia * 0.95))
  return {
    provider: 'voyage',
    paidUsageEnabled: ligado('VOYAGE_PAID_USAGE_ENABLED', false),
    hardLimitEnabled: ligado('VOYAGE_HARD_LIMIT_ENABLED', true),
    freeTokenLimit: franquia,
    hardStopTokens: Math.min(corte, franquia),
    maxTokensPerRequest: numero('VOYAGE_MAX_TOKENS_PER_REQUEST', 120_000),
    dailyTokenLimit: numero('VOYAGE_DAILY_TOKEN_LIMIT', 0),
    monthlyTokenLimit: numero('VOYAGE_MONTHLY_TOKEN_LIMIT', 0),
  }
}

/**
 * Uma estimativa de tokens a partir do texto.
 *
 * Aproximada e deliberadamente PESSIMISTA: quatro caracteres por token é a regra usada
 * de forma geral, e arredondar para cima é o que faz a reserva ser um teto e não um
 * palpite. Subestimar aqui é o único jeito de o corte falhar.
 */
export const estimateTokens = (texts: string[]): number =>
  texts.reduce((soma, t) => soma + Math.ceil((t?.length ?? 0) / 4) + 1, 0)

// --- o estado, no banco ---------------------------------------------------------------------

/** O contador da instalação. Um documento por provedor: a franquia é da conta. */
interface BudgetDoc {
  _id: string
  /** Tokens já consumidos (reais quando o provedor informou; estimados quando não). */
  used: number
  /** Tokens comprometidos AGORA: reservas em voo mais o que já foi usado. */
  reserved: number
  requests: number
  updatedAt: Date
}

/** Um evento por chamada: é ele que responde "quem gastou o quê, e por quê". */
export interface EmbeddingUsageEvent {
  provider: string
  model: string
  operation: string
  estimatedTokens: number
  actualTokens: number | null
  texts: number
  ok: boolean
  error?: string | null
  ownerId?: string | null
  agentId?: string | null
  sectorId?: string | null
  createdAt: Date
  /** YYYY-MM-DD e YYYY-MM (UTC): as agregações são varredura de faixa, não cálculo. */
  day: string
  month: string
}

const orcamento = db.collection<BudgetDoc>('embedding_budget')
const eventos = db.collection<EmbeddingUsageEvent>('embedding_usage')

export async function ensureEmbeddingUsageIndexes(): Promise<void> {
  await eventos.createIndex({ createdAt: -1 })
  await eventos.createIndex({ provider: 1, day: 1 })
  await eventos.createIndex({ provider: 1, month: 1 })
  await eventos.createIndex({ agentId: 1, createdAt: -1 })
}

const dia = (d: Date) => d.toISOString().slice(0, 10)
const mes = (d: Date) => d.toISOString().slice(0, 7)

/** Por que uma chamada foi recusada. Cada motivo tem uma ação diferente de quem opera. */
export type BudgetDenial = 'HARD_STOP' | 'REQUEST_TOO_LARGE' | 'DAILY_LIMIT' | 'MONTHLY_LIMIT'

export interface Reservation {
  ok: boolean
  code?: BudgetDenial
  reason?: string
  tokens: number
}

/**
 * Reserva o direito de gastar `tokens` — ou recusa, ANTES de a API ser chamada.
 *
 * O `findOneAndUpdate` condicional é o coração: a condição `reserved <= teto - tokens`
 * vive no FILTRO, então o banco a avalia e aplica o incremento na mesma operação. Duas
 * chamadas paralelas não conseguem ambas passar — a segunda não casa mais o filtro.
 *
 * Ler o saldo e depois decidir, em duas etapas, seria exatamente o defeito que este
 * módulo existe para evitar.
 */
export async function reserveTokens(
  tokens: number,
  cfg: EmbeddingBudgetConfig = embeddingBudgetConfig(),
  agora: Date = new Date(),
): Promise<Reservation> {
  if (tokens > cfg.maxTokensPerRequest) {
    return {
      ok: false,
      code: 'REQUEST_TOO_LARGE',
      reason: `esta chamada precisaria de ~${tokens} tokens, acima do teto de ${cfg.maxTokensPerRequest} por requisição`,
      tokens,
    }
  }

  // Uso pago liberado E teto desligado: não há o que reservar. Ainda assim o consumo é
  // contado, porque saber quanto se gastou não depende de haver limite.
  if (cfg.paidUsageEnabled && !cfg.hardLimitEnabled) {
    await orcamento.updateOne(
      { _id: cfg.provider },
      { $inc: { reserved: tokens }, $setOnInsert: { used: 0, requests: 0 }, $set: { updatedAt: agora } },
      { upsert: true },
    )
    return { ok: true, tokens }
  }

  const teto = cfg.hardStopTokens
  // Garante o documento antes do update condicional: sem ele o filtro nunca casa, e a
  // primeira chamada da vida da instalação seria recusada.
  await orcamento.updateOne(
    { _id: cfg.provider },
    { $setOnInsert: { used: 0, reserved: 0, requests: 0, updatedAt: agora } },
    { upsert: true },
  )

  const r = await orcamento.findOneAndUpdate(
    { _id: cfg.provider, reserved: { $lte: teto - tokens } },
    { $inc: { reserved: tokens }, $set: { updatedAt: agora } },
    { returnDocument: 'after' },
  )
  if (!r) {
    const atual = await orcamento.findOne({ _id: cfg.provider })
    const usados = atual?.reserved ?? 0
    return {
      ok: false,
      code: 'HARD_STOP',
      reason:
        `a franquia gratuita de embedding acabou: ${usados} de ${teto} tokens comprometidos, e esta chamada precisaria de mais ${tokens}. ` +
        (cfg.paidUsageEnabled
          ? 'Aumente VOYAGE_HARD_STOP_TOKENS para continuar.'
          : 'O uso pago está desligado (VOYAGE_PAID_USAGE_ENABLED=false), então nada é cobrado — e nada é indexado até o limite subir.'),
      tokens,
    }
  }

  // Os tetos por dia e por mês são do OPERADOR, e não do provedor: por isso conferidos
  // depois da reserva, que é o que já protege a franquia. Estourar um deles devolve a
  // reserva — nada foi gasto.
  for (const [limite, code, campo] of [
    [cfg.dailyTokenLimit, 'DAILY_LIMIT' as const, dia(agora)],
    [cfg.monthlyTokenLimit, 'MONTHLY_LIMIT' as const, mes(agora)],
  ] as const) {
    if (limite <= 0) continue
    const gasto = await tokensNoPeriodo(cfg.provider, campo)
    if (gasto + tokens > limite) {
      await orcamento.updateOne({ _id: cfg.provider }, { $inc: { reserved: -tokens } })
      return {
        ok: false,
        code,
        reason: `o limite configurado de ${limite} tokens para este período já foi alcançado (${gasto} usados)`,
        tokens,
      }
    }
  }

  return { ok: true, tokens }
}

/** Quanto foi consumido num dia (YYYY-MM-DD) ou num mês (YYYY-MM). */
async function tokensNoPeriodo(provider: string, periodo: string): Promise<number> {
  const campo = periodo.length === 7 ? 'month' : 'day'
  const [linha] = await eventos
    .aggregate<{ total: number }>([
      { $match: { provider, [campo]: periodo, ok: true } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$actualTokens', '$estimatedTokens'] } } } },
    ])
    .toArray()
  return linha?.total ?? 0
}

/**
 * Fecha a conta de uma chamada: acerta a reserva pelo número real e registra o evento.
 *
 * O acerto é um delta, nunca uma reescrita: outras chamadas estão reservando ao mesmo
 * tempo, e escrever o total calculado aqui apagaria o trabalho delas.
 */
export async function settleReservation(
  evento: Omit<EmbeddingUsageEvent, 'createdAt' | 'day' | 'month'>,
  agora: Date = new Date(),
): Promise<void> {
  const real = evento.ok ? (evento.actualTokens ?? evento.estimatedTokens) : 0
  const delta = real - evento.estimatedTokens
  await orcamento
    .updateOne(
      { _id: evento.provider },
      { $inc: { reserved: delta, used: real, requests: evento.ok ? 1 : 0 }, $set: { updatedAt: agora } },
      { upsert: true },
    )
    .catch(() => undefined)
  await eventos
    .insertOne({ ...evento, createdAt: agora, day: dia(agora), month: mes(agora) } as EmbeddingUsageEvent)
    .catch(() => undefined)
}

/** Devolve uma reserva inteira: a chamada nem chegou a acontecer. */
export async function releaseReservation(provider: string, tokens: number): Promise<void> {
  await orcamento.updateOne({ _id: provider }, { $inc: { reserved: -tokens } }).catch(() => undefined)
}

// --- o que o painel mostra --------------------------------------------------------------------

export interface EmbeddingUsageReport {
  provider: string
  model: string
  fallbackModel: string | null
  paidUsageEnabled: boolean
  hardLimitEnabled: boolean
  freeTokenLimit: number
  hardStopTokens: number
  usedTokens: number
  reservedTokens: number
  remainingTokens: number
  percentUsed: number
  requests: number
  tokensToday: number
  tokensThisMonth: number
  requestsToday: number
  byModel: { model: string; tokens: number; requests: number }[]
  byAgent: { agentId: string; tokens: number; requests: number }[]
  lastError: { at: string; model: string; reason: string } | null
}

export async function embeddingUsageReport(
  cfg: EmbeddingBudgetConfig,
  modelo: string,
  fallback: string | null,
  agora: Date = new Date(),
): Promise<EmbeddingUsageReport> {
  const estado = await orcamento.findOne({ _id: cfg.provider })
  const usados = estado?.used ?? 0
  const comprometidos = estado?.reserved ?? 0
  const hoje = dia(agora)
  const esteMes = mes(agora)

  const [porModelo, porAgente, doDia, doMes, falha] = await Promise.all([
    eventos
      .aggregate<{ _id: string; tokens: number; requests: number }>([
        { $match: { provider: cfg.provider, ok: true } },
        { $group: { _id: '$model', tokens: { $sum: { $ifNull: ['$actualTokens', '$estimatedTokens'] } }, requests: { $sum: 1 } } },
        { $sort: { tokens: -1 } },
        { $limit: 10 },
      ])
      .toArray(),
    eventos
      .aggregate<{ _id: string; tokens: number; requests: number }>([
        { $match: { provider: cfg.provider, ok: true, agentId: { $ne: null } } },
        { $group: { _id: '$agentId', tokens: { $sum: { $ifNull: ['$actualTokens', '$estimatedTokens'] } }, requests: { $sum: 1 } } },
        { $sort: { tokens: -1 } },
        { $limit: 10 },
      ])
      .toArray(),
    tokensNoPeriodo(cfg.provider, hoje),
    tokensNoPeriodo(cfg.provider, esteMes),
    eventos.find({ provider: cfg.provider, ok: false }).sort({ createdAt: -1 }).limit(1).toArray(),
  ])

  const requisicoesHoje = await eventos.countDocuments({ provider: cfg.provider, day: hoje, ok: true }).catch(() => 0)
  const teto = cfg.hardStopTokens || 1

  return {
    provider: cfg.provider,
    model: modelo,
    fallbackModel: fallback,
    paidUsageEnabled: cfg.paidUsageEnabled,
    hardLimitEnabled: cfg.hardLimitEnabled,
    freeTokenLimit: cfg.freeTokenLimit,
    hardStopTokens: cfg.hardStopTokens,
    usedTokens: usados,
    reservedTokens: comprometidos,
    // O que resta é medido contra o COMPROMETIDO, não contra o usado: uma reserva em voo
    // já não está disponível para mais ninguém.
    remainingTokens: Math.max(0, cfg.hardStopTokens - comprometidos),
    percentUsed: Math.min(100, Math.round((comprometidos / teto) * 1000) / 10),
    requests: estado?.requests ?? 0,
    tokensToday: doDia,
    tokensThisMonth: doMes,
    requestsToday: requisicoesHoje,
    byModel: porModelo.map((l) => ({ model: l._id, tokens: l.tokens, requests: l.requests })),
    byAgent: porAgente.map((l) => ({ agentId: l._id, tokens: l.tokens, requests: l.requests })),
    lastError: falha[0] ? { at: falha[0].createdAt.toISOString(), model: falha[0].model, reason: falha[0].error ?? 'erro' } : null,
  }
}

/** Só para teste: zera o contador da instalação. */
export async function resetEmbeddingBudget(provider = 'voyage'): Promise<void> {
  await orcamento.deleteOne({ _id: provider })
  await eventos.deleteMany({ provider })
}
