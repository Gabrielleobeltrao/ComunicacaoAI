import { ObjectId } from 'mongodb'
import { countActionsSince } from '../apps/actionEvents.js'
import { activePolicyFor } from './repository.js'
import { evaluatePolicy, needsContext } from './evaluate.js'
import type { OrderIntent, OpenPosition, PolicyContext, PolicyVerdict } from './evaluate.js'
import type { PolicyRules } from './types.js'

/**
 * A PORTEIRA, no último instante possível.
 *
 * Fica aqui e não no adapter porque a regra é da plataforma, não da corretora; e é
 * chamada de dentro do adapter, imediatamente antes de a chamada sair, porque qualquer
 * lugar antes disso é um lugar de onde dá para escapar — o modelo pode não chamar a
 * ferramenta que valida, o frontend pode ser contornado, e o prompt pode ser ignorado.
 */

export class PolicyDenied extends Error {
  constructor(
    readonly verdict: PolicyVerdict,
    readonly environment: string,
  ) {
    super(verdict.violations.map((v) => v.message).join(' '))
  }
}

export interface GuardScope {
  ownerId: string
  installationId: string
  agentId?: string | null
  environment: string
}

/**
 * De onde vêm os dados que a avaliação precisa.
 *
 * Injetado pelo adapter: quem sabe pedir saldo e posição à corretora é ele. Cada um só
 * é chamado se alguma regra ativa depender dele — uma consulta a mais antes de cada
 * ordem é latência que ninguém pediu.
 */
export interface GuardFetchers {
  account?: () => Promise<{ equity: number | null; lastEquity: number | null }>
  positions?: () => Promise<OpenPosition[]>
  /**
   * O preço de referência, buscado só se alguma regra de VALOR estiver ativa.
   *
   * Fica aqui e não no chamador porque é aqui que se sabe se ele é necessário: sem
   * política de valor, uma cotação antes de cada ordem é latência que ninguém pediu.
   */
  estimatePrice?: () => Promise<number | null>
  /** As ações que contam como "operação" para o teto diário. */
  orderActionKeys?: string[]
  now?: () => Date
}

const inicioDoDia = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

export async function buildPolicyContext(scope: GuardScope, rules: PolicyRules, fetchers: GuardFetchers): Promise<PolicyContext> {
  const now = fetchers.now?.() ?? new Date()
  const precisa = needsContext(rules)
  const ctx: PolicyContext = { now }

  if (precisa.account && fetchers.account) {
    const conta = await fetchers.account()
    ctx.equity = conta.equity
    ctx.lastEquity = conta.lastEquity
  }
  if (precisa.positions && fetchers.positions) ctx.positions = await fetchers.positions()
  if (precisa.ordersToday && fetchers.orderActionKeys?.length && ObjectId.isValid(scope.installationId)) {
    ctx.ordersToday = await countActionsSince(scope.ownerId, new ObjectId(scope.installationId), fetchers.orderActionKeys, inicioDoDia(now))
  }
  return ctx
}

/**
 * Confere e deixa passar, ou barra dizendo o que barrou.
 *
 * Sem política configurada, nada é barrado — mas o veredito ainda existe e é devolvido,
 * porque "nenhuma regra se aplicava" é uma informação de auditoria, não um silêncio.
 */
export async function guardOrder(scope: GuardScope, intent: OrderIntent, fetchers: GuardFetchers = {}): Promise<PolicyVerdict> {
  const policy = await activePolicyFor({
    ownerId: scope.ownerId,
    installationId: scope.installationId,
    agentId: scope.agentId ?? null,
  })
  if (!policy) return { allowed: true, violations: [], evaluated: [] }

  const ctx = await buildPolicyContext(scope, policy.rules, fetchers)
  const precisaPreco = needsContext(policy.rules).price
  const comPreco: OrderIntent =
    precisaPreco && intent.estimatedPrice === undefined && fetchers.estimatePrice
      ? { ...intent, estimatedPrice: await fetchers.estimatePrice() }
      : intent
  const verdict = evaluatePolicy(policy.rules, comPreco, ctx)
  if (!verdict.allowed) throw new PolicyDenied(verdict, scope.environment)
  return verdict
}
