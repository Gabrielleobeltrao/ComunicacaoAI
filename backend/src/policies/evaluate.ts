import type { PolicyRules, PolicyViolation, TradingHours } from './types.js'

/**
 * A avaliação, PURA.
 *
 * Sem banco, sem rede, sem relógio implícito: tudo entra por parâmetro. É o que permite
 * provar cada regra com um teste determinístico — e é o que garante que a mesma entrada
 * dá a mesma resposta às três da manhã e no fechamento do pregão.
 */

export interface OrderIntent {
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
  type: 'market' | 'limit'
  limitPrice?: number | null
  stopLossPrice?: number | null
  takeProfitPrice?: number | null
  /**
   * O preço com que o valor da operação é estimado.
   *
   * Numa ordem limitada é o limite; numa a mercado é a última cotação. Ausente, as
   * regras de VALOR não podem ser avaliadas — e uma regra que não pode ser avaliada
   * BARRA, ela não é ignorada.
   */
  estimatedPrice?: number | null
}

export interface OpenPosition {
  symbol: string
  quantity: number
  side: string
}

export interface PolicyContext {
  equity?: number | null
  /** Patrimônio no fechamento anterior — é dele que sai a perda do dia. */
  lastEquity?: number | null
  positions?: OpenPosition[]
  ordersToday?: number
  now: Date
}

const definido = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * Um símbolo de opção, no formato OCC: raiz + AAMMDD + C/P + 8 dígitos de strike.
 *
 * Reconhecer pela FORMA é o que funciona sem consultar o provider — e uma consulta a
 * mais antes de cada ordem seria uma consulta que pode falhar e liberar o que devia
 * barrar.
 */
export const looksLikeOption = (symbol: string): boolean => /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(symbol.trim().toUpperCase())

/** HH:MM → minutos desde a meia-noite. Devolve null para o que não é hora. */
export function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * O instante, no fuso da janela.
 *
 * Usa `Intl` em vez de aritmética de offset porque horário de verão existe: somar três
 * horas funciona metade do ano e erra a outra metade, sempre em uma semana que ninguém
 * está olhando.
 */
export function localParts(now: Date, timezone: string): { minutes: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
  const partes = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const hora = Number(partes.hour ?? '0')
  return { minutes: (hora === 24 ? 0 : hora) * 60 + Number(partes.minute ?? '0'), weekday: dias[partes.weekday ?? 'Sun'] ?? 0 }
}

export function withinTradingHours(janela: TradingHours, now: Date): boolean {
  const inicio = minutesOfDay(janela.start)
  const fim = minutesOfDay(janela.end)
  // Janela malformada não libera geral: uma configuração que ninguém consegue
  // interpretar é motivo para barrar, não para ignorar a regra.
  if (inicio === null || fim === null) return false
  let atual: { minutes: number; weekday: number }
  try {
    atual = localParts(now, janela.timezone)
  } catch {
    return false
  }
  if (janela.days?.length && !janela.days.includes(atual.weekday)) return false
  // Janela que atravessa a meia-noite.
  return inicio <= fim ? atual.minutes >= inicio && atual.minutes < fim : atual.minutes >= inicio || atual.minutes < fim
}

/** Quais dados a avaliação vai precisar. Buscar só o necessário é uma chamada a menos. */
export function needsContext(rules: PolicyRules): { account: boolean; positions: boolean; ordersToday: boolean; price: boolean } {
  return {
    account: definido(rules.maxPortfolioPercent) || definido(rules.maxDailyLoss),
    positions: rules.blockDuplicatePosition === true || rules.blockShort === true,
    ordersToday: definido(rules.maxOrdersPerDay),
    price: definido(rules.maxOrderValue) || definido(rules.maxPortfolioPercent),
  }
}

export interface PolicyVerdict {
  allowed: boolean
  violations: PolicyViolation[]
  /** As regras que foram REALMENTE avaliadas. Vai para o log — é a prova do que valeu. */
  evaluated: string[]
}

const dinheiro = (n: number): string => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function evaluatePolicy(rules: PolicyRules, intent: OrderIntent, ctx: PolicyContext): PolicyVerdict {
  const violations: PolicyViolation[] = []
  const evaluated: string[] = []
  const symbol = intent.symbol.trim().toUpperCase()
  const valor = definido(intent.estimatedPrice) ? intent.estimatedPrice * intent.quantity : null

  if (rules.symbolAllowlist?.length) {
    evaluated.push('symbolAllowlist')
    if (!rules.symbolAllowlist.map((s) => s.trim().toUpperCase()).includes(symbol)) {
      violations.push({ code: 'symbol_not_allowed', message: `${symbol} não está na lista de ativos permitidos.` })
    }
  }

  if (rules.blockOptions) {
    evaluated.push('blockOptions')
    if (looksLikeOption(symbol)) violations.push({ code: 'options_blocked', message: 'Opções estão bloqueadas nesta conexão.' })
  }

  if (definido(rules.maxQuantity)) {
    evaluated.push('maxQuantity')
    if (intent.quantity > rules.maxQuantity) {
      violations.push({ code: 'max_quantity', message: `A quantidade ${intent.quantity} passa do limite de ${rules.maxQuantity}.` })
    }
  }

  if (definido(rules.maxOrderValue)) {
    evaluated.push('maxOrderValue')
    // Sem preço não dá para avaliar — e o que não dá para avaliar barra. Deixar passar
    // seria transformar "limite de R$ 1.000" em "limite de R$ 1.000, exceto quando a
    // cotação falhar", que é justamente quando o mercado está estranho.
    if (valor === null) {
      violations.push({ code: 'max_order_value', message: 'Não foi possível estimar o valor da operação para conferir o limite.' })
    } else if (valor > rules.maxOrderValue) {
      violations.push({ code: 'max_order_value', message: `O valor estimado (${dinheiro(valor)}) passa do limite de ${dinheiro(rules.maxOrderValue)}.` })
    }
  }

  if (definido(rules.maxPortfolioPercent)) {
    evaluated.push('maxPortfolioPercent')
    if (valor === null || !definido(ctx.equity)) {
      violations.push({ code: 'max_portfolio_percent', message: 'Não foi possível medir a operação contra a carteira.' })
    } else {
      const pct = (valor / ctx.equity) * 100
      if (pct > rules.maxPortfolioPercent) {
        violations.push({
          code: 'max_portfolio_percent',
          message: `A operação representa ${pct.toFixed(1)}% da carteira, acima do limite de ${rules.maxPortfolioPercent}%.`,
        })
      }
    }
  }

  if (definido(rules.maxDailyLoss)) {
    evaluated.push('maxDailyLoss')
    if (!definido(ctx.equity) || !definido(ctx.lastEquity)) {
      violations.push({ code: 'max_daily_loss', message: 'Não foi possível apurar o resultado do dia.' })
    } else {
      const perda = ctx.lastEquity - ctx.equity
      if (perda >= rules.maxDailyLoss) {
        violations.push({ code: 'max_daily_loss', message: `A perda do dia (${dinheiro(perda)}) atingiu o limite de ${dinheiro(rules.maxDailyLoss)}.` })
      }
    }
  }

  if (definido(rules.maxOrdersPerDay)) {
    evaluated.push('maxOrdersPerDay')
    const feitas = ctx.ordersToday ?? 0
    if (feitas >= rules.maxOrdersPerDay) {
      violations.push({ code: 'max_orders_per_day', message: `O limite de ${rules.maxOrdersPerDay} operações por dia já foi atingido.` })
    }
  }

  if (rules.requireStopLoss) {
    evaluated.push('requireStopLoss')
    if (!definido(intent.stopLossPrice)) violations.push({ code: 'stop_loss_required', message: 'Esta conexão exige stop-loss em toda ordem.' })
  }

  if (rules.requireTakeProfit) {
    evaluated.push('requireTakeProfit')
    if (!definido(intent.takeProfitPrice)) violations.push({ code: 'take_profit_required', message: 'Esta conexão exige take-profit em toda ordem.' })
  }

  const posicoes = ctx.positions ?? []
  if (rules.blockDuplicatePosition) {
    evaluated.push('blockDuplicatePosition')
    const aberta = posicoes.find((p) => p.symbol.trim().toUpperCase() === symbol && p.quantity !== 0)
    // Só a ABERTURA é bloqueada. Vender o que se tem é reduzir posição, não duplicar —
    // barrar isso trancaria o dono dentro da própria posição.
    if (aberta && intent.side === 'buy') {
      violations.push({ code: 'duplicate_position', message: `Já existe posição aberta em ${symbol}.` })
    }
  }

  if (rules.blockShort) {
    evaluated.push('blockShort')
    const aberta = posicoes.find((p) => p.symbol.trim().toUpperCase() === symbol)
    const tem = aberta ? Math.abs(aberta.quantity) : 0
    // Vender mais do que se tem é ficar vendido. É isso que a regra proíbe — e não a
    // venda em si.
    if (intent.side === 'sell' && intent.quantity > tem) {
      violations.push({ code: 'short_blocked', message: `Vender ${intent.quantity} de ${symbol} deixaria a conta vendida; short está bloqueado.` })
    }
  }

  if (rules.tradingHours) {
    evaluated.push('tradingHours')
    if (!withinTradingHours(rules.tradingHours, ctx.now)) {
      violations.push({
        code: 'outside_trading_hours',
        message: `Fora da janela permitida (${rules.tradingHours.start}–${rules.tradingHours.end}, ${rules.tradingHours.timezone}).`,
      })
    }
  }

  return { allowed: violations.length === 0, violations, evaluated }
}
