import { API_URL } from './api'

/**
 * As políticas de negociação. Só regras trafegam aqui — nenhum valor da conta, nenhum
 * dado da corretora, nenhuma credencial.
 *
 * A tela é uma conveniência: quem confere é o servidor, imediatamente antes de a ordem
 * sair. Um formulário pode ser contornado; a política, não.
 */

export interface TradingHours {
  timezone: string
  start: string
  end: string
  days?: number[]
}

export interface PolicyRules {
  maxOrderValue?: number | null
  maxQuantity?: number | null
  maxPortfolioPercent?: number | null
  maxDailyLoss?: number | null
  maxOrdersPerDay?: number | null
  requireStopLoss?: boolean
  requireTakeProfit?: boolean
  blockDuplicatePosition?: boolean
  symbolAllowlist?: string[]
  blockShort?: boolean
  blockOptions?: boolean
  tradingHours?: TradingHours | null
}

export interface TradingPolicy {
  id: string
  installationId: string | null
  agentId: string | null
  version: number
  active: boolean
  rules: PolicyRules
  createdAt: string
  updatedAt: string
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.message ?? body?.error ?? 'Não foi possível concluir.')
  }
  return res.status === 204 ? (null as T) : ((await res.json()) as T)
}

const query = (installationId: string | null, agentId?: string | null) => {
  const p = new URLSearchParams()
  if (installationId) p.set('installationId', installationId)
  if (agentId) p.set('agentId', agentId)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const activePolicy = (installationId: string | null, agentId?: string | null) =>
  request<TradingPolicy | null>(`/api/trading-policies/active${query(installationId, agentId)}`)

export const savePolicy = (installationId: string | null, agentId: string | null, rules: PolicyRules) =>
  request<TradingPolicy>('/api/trading-policies', { method: 'POST', body: JSON.stringify({ installationId, agentId, rules }) })

const dinheiro = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * A política em uma frase por regra.
 *
 * É o que aparece antes de alguém autorizar uma ação crítica: ler três linhas é mais
 * rápido do que abrir a configuração — e é a diferença entre autorizar sabendo e
 * autorizar achando.
 */
export function describeRules(rules: PolicyRules): string[] {
  const linhas: string[] = []
  if (rules.maxOrderValue) linhas.push(`Até ${dinheiro(rules.maxOrderValue)} por operação`)
  if (rules.maxQuantity) linhas.push(`Até ${rules.maxQuantity} por operação`)
  if (rules.maxPortfolioPercent) linhas.push(`Até ${rules.maxPortfolioPercent}% da carteira por operação`)
  if (rules.maxDailyLoss) linhas.push(`Para se a perda do dia chegar a ${dinheiro(rules.maxDailyLoss)}`)
  if (rules.maxOrdersPerDay) linhas.push(`No máximo ${rules.maxOrdersPerDay} operações por dia`)
  if (rules.requireStopLoss) linhas.push('Exige stop-loss')
  if (rules.requireTakeProfit) linhas.push('Exige take-profit')
  if (rules.blockDuplicatePosition) linhas.push('Não abre posição repetida')
  if (rules.blockShort) linhas.push('Não vende o que não tem')
  if (rules.blockOptions) linhas.push('Não opera opções')
  if (rules.symbolAllowlist?.length) linhas.push(`Só estes ativos: ${rules.symbolAllowlist.join(', ')}`)
  if (rules.tradingHours) linhas.push(`Só das ${rules.tradingHours.start} às ${rules.tradingHours.end} (${rules.tradingHours.timezone})`)
  return linhas
}
