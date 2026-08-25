import type { ObjectId } from 'mongodb'

/**
 * As POLÍTICAS de negociação: o que o dono decidiu que nunca deve acontecer.
 *
 * Elas não são conselho para o modelo. Um prompt pode ser ignorado, uma instrução pode
 * ser reinterpretada, e o frontend pode ser contornado por quem chama a API direto. A
 * política é conferida no servidor, imediatamente antes de a ordem sair — e é a única
 * camada em que confiar.
 *
 * Versionadas: mudar uma regra cria uma versão nova em vez de reescrever a anterior.
 * Quando alguém perguntar "por que essa ordem passou em março", a resposta precisa ser
 * a regra que valia em março.
 */

export interface TradingHours {
  /** Fuso da janela. Sem ele, "das 10 às 17" não quer dizer nada. */
  timezone: string
  /** HH:MM, inclusive. */
  start: string
  /** HH:MM, exclusivo. */
  end: string
  /** Dias da semana permitidos, 0 = domingo. Vazio = todos. */
  days?: number[]
}

export interface PolicyRules {
  /** Teto do valor de UMA operação, na moeda da conta. */
  maxOrderValue?: number | null
  maxQuantity?: number | null
  /** Teto do valor da operação como fração do patrimônio (0–100). */
  maxPortfolioPercent?: number | null
  /** Perda máxima no dia. Atingida, nenhuma ordem nova sai. */
  maxDailyLoss?: number | null
  maxOrdersPerDay?: number | null
  requireStopLoss?: boolean
  requireTakeProfit?: boolean
  /** Impede abrir de novo o que já está aberto. */
  blockDuplicatePosition?: boolean
  /** Vazio = qualquer ativo. Preenchida, é exaustiva. */
  symbolAllowlist?: string[]
  blockShort?: boolean
  blockOptions?: boolean
  tradingHours?: TradingHours | null
}

export interface TradingPolicy {
  _id: ObjectId
  ownerId: string
  /**
   * A que a política se aplica.
   *
   * Uma conexão de simulação e uma de produção são conexões DIFERENTES, então uma
   * política nunca atravessa de uma para a outra por acidente — é escopo, não filtro.
   * `agentId` restringe ainda mais: a mesma conexão pode ser frouxa para um agente de
   * leitura e apertada para o que manda ordem.
   */
  installationId: string | null
  agentId: string | null
  version: number
  active: boolean
  rules: PolicyRules
  createdAt: Date
  updatedAt: Date
}

export const emptyRules = (): PolicyRules => ({})

export type ViolationCode =
  | 'max_order_value'
  | 'max_quantity'
  | 'max_portfolio_percent'
  | 'max_daily_loss'
  | 'max_orders_per_day'
  | 'stop_loss_required'
  | 'take_profit_required'
  | 'duplicate_position'
  | 'symbol_not_allowed'
  | 'short_blocked'
  | 'options_blocked'
  | 'outside_trading_hours'

export interface PolicyViolation {
  code: ViolationCode
  /** Uma frase para quem configurou. Nunca credencial, nunca corpo de terceiro. */
  message: string
}
