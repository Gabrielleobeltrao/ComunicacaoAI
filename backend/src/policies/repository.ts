import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { ValidationError } from '../building.js'
import type { PolicyRules, TradingPolicy } from './types.js'

// As políticas guardadas. Versionadas por (dono, conexão, agente): mudar uma regra
// cria uma versão nova em vez de reescrever a anterior.
const policies = db.collection<TradingPolicy>('trading_policies')

export async function ensurePolicyIndexes(): Promise<void> {
  // A busca do que VALE agora.
  await policies.createIndex({ ownerId: 1, installationId: 1, agentId: 1, active: 1, version: -1 })
  await policies.createIndex({ ownerId: 1, createdAt: -1 })
}

/**
 * Um erro que sabe DE QUAL CAMPO ele é.
 *
 * A `ValidationError` genérica vira uma frase na tela sem dizer onde corrigir. Aqui o
 * formulário tem doze campos, e "valor inválido" sem o nome do campo obriga a caçar.
 */
export class PolicyFieldError extends ValidationError {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message)
  }
}

const LIMITES: Record<string, { max: number; rotulo: string }> = {
  maxOrderValue: { max: 1_000_000_000, rotulo: 'valor máximo por operação' },
  maxQuantity: { max: 1_000_000, rotulo: 'quantidade máxima' },
  maxPortfolioPercent: { max: 100, rotulo: 'percentual da carteira' },
  maxDailyLoss: { max: 1_000_000_000, rotulo: 'perda máxima no dia' },
  maxOrdersPerDay: { max: 10_000, rotulo: 'operações por dia' },
}

/**
 * Um número de limite: ausente, ou um número válido.
 *
 * O que ele NUNCA faz é virar "sem limite" em silêncio. Era o comportamento antigo, e é
 * o pior possível para uma trava: quem digita `-5` ou `abc` acha que apertou a regra e
 * na verdade desligou.
 */
function limite(campo: keyof typeof LIMITES, valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'))
  const { max, rotulo } = LIMITES[campo]
  if (!Number.isFinite(n)) throw new PolicyFieldError(campo, `O ${rotulo} precisa ser um número.`)
  if (n <= 0) throw new PolicyFieldError(campo, `O ${rotulo} precisa ser maior que zero — para desligar a regra, deixe em branco.`)
  if (n > max) throw new PolicyFieldError(campo, `O ${rotulo} não pode passar de ${max.toLocaleString('pt-BR')}.`)
  return n
}

const HORA = /^\d{1,2}:\d{2}$/

/**
 * Regras vindas da API, validadas.
 *
 * Nada é saneado em silêncio: o que não dá para interpretar vira erro com o nome do
 * campo. Guardar um limite ilegível seria pior — ele barraria tudo, ou nada, dependendo
 * de onde o defeito caísse.
 */
export function normalizeRules(bruto: unknown): PolicyRules {
  const r = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Record<string, unknown>
  const regras: PolicyRules = {}
  for (const campo of ['maxOrderValue', 'maxQuantity', 'maxPortfolioPercent', 'maxDailyLoss', 'maxOrdersPerDay'] as const) {
    const n = limite(campo, r[campo])
    if (n !== null) regras[campo] = n
  }
  for (const campo of ['requireStopLoss', 'requireTakeProfit', 'blockDuplicatePosition', 'blockShort', 'blockOptions'] as const) {
    if (r[campo] === undefined || r[campo] === null) continue
    if (typeof r[campo] !== 'boolean') throw new PolicyFieldError(campo, 'Esta trava só aceita ligado ou desligado.')
    if (r[campo] === true) regras[campo] = true
  }
  if (r.symbolAllowlist !== undefined && r.symbolAllowlist !== null) {
    if (!Array.isArray(r.symbolAllowlist)) throw new PolicyFieldError('symbolAllowlist', 'A lista de ativos precisa ser uma lista.')
    const lista = [...new Set(r.symbolAllowlist.map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean))]
    if (lista.length > 200) throw new PolicyFieldError('symbolAllowlist', 'No máximo 200 ativos na lista.')
    if (lista.length) regras.symbolAllowlist = lista
  }
  const janela = (typeof r.tradingHours === 'object' && r.tradingHours !== null ? r.tradingHours : null) as Record<string, unknown> | null
  if (janela) {
    const start = String(janela.start ?? '')
    const end = String(janela.end ?? '')
    const timezone = String(janela.timezone ?? '').trim()
    if (!HORA.test(start)) throw new PolicyFieldError('tradingHours.start', 'O início da janela precisa estar no formato HH:MM.')
    if (!HORA.test(end)) throw new PolicyFieldError('tradingHours.end', 'O fim da janela precisa estar no formato HH:MM.')
    // Sem fuso, "das 10 às 17" não quer dizer nada — e um padrão silencioso escolheria
    // por alguém que não pediu.
    if (!timezone) throw new PolicyFieldError('tradingHours.timezone', 'A janela de horário precisa do fuso.')
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    } catch {
      throw new PolicyFieldError('tradingHours.timezone', `Fuso desconhecido: ${timezone}.`)
    }
    let days: number[] = []
    if (janela.days !== undefined && janela.days !== null) {
      if (!Array.isArray(janela.days)) throw new PolicyFieldError('tradingHours.days', 'Os dias precisam ser uma lista.')
      days = janela.days.map((d) => Number(d))
      if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        throw new PolicyFieldError('tradingHours.days', 'Cada dia precisa ser um número de 0 (domingo) a 6 (sábado).')
      }
    }
    regras.tradingHours = { timezone, start, end, ...(days.length ? { days } : {}) }
  }
  return regras
}


export interface PolicyScope {
  ownerId: string
  installationId: string | null
  agentId: string | null
}

/**
 * Guardar uma versão nova. A anterior fica.
 *
 * Quando alguém perguntar "por que essa ordem passou em março", a resposta precisa ser
 * a regra que valia em março — e não a que vale hoje.
 */
export async function savePolicy(scope: PolicyScope, rules: PolicyRules, now = new Date()): Promise<TradingPolicy> {
  const anterior = await policies
    .find({ ownerId: scope.ownerId, installationId: scope.installationId, agentId: scope.agentId })
    .sort({ version: -1 })
    .limit(1)
    .toArray()
  const version = (anterior[0]?.version ?? 0) + 1
  const doc: TradingPolicy = {
    _id: new ObjectId(),
    ownerId: scope.ownerId,
    installationId: scope.installationId,
    agentId: scope.agentId,
    version,
    active: true,
    rules,
    createdAt: now,
    updatedAt: now,
  }
  await policies.insertOne(doc)
  // Só uma versão vale por vez. Desativar DEPOIS de inserir é de propósito: entre as
  // duas escritas existe uma janela com duas ativas, e duas políticas ativas barram
  // mais do que deviam — o contrário abriria uma janela sem política nenhuma.
  await policies.updateMany(
    { ownerId: scope.ownerId, installationId: scope.installationId, agentId: scope.agentId, _id: { $ne: doc._id } },
    { $set: { active: false, updatedAt: now } },
  )
  return doc
}

/**
 * A política que vale AGORA para esta ação.
 *
 * A do agente ganha da da conexão: quem apertou para um agente específico quis
 * exatamente isso. Não é união nem interseção — é a mais específica, porque somar
 * regras de dois lugares produz um resultado que ninguém configurou.
 */
export async function activePolicyFor(scope: PolicyScope): Promise<TradingPolicy | null> {
  if (scope.agentId) {
    const doAgente = await policies.findOne(
      { ownerId: scope.ownerId, installationId: scope.installationId, agentId: scope.agentId, active: true },
      { sort: { version: -1 } },
    )
    if (doAgente) return doAgente
  }
  return policies.findOne({ ownerId: scope.ownerId, installationId: scope.installationId, agentId: null, active: true }, { sort: { version: -1 } })
}

export const listPolicies = (ownerId: string): Promise<TradingPolicy[]> =>
  policies.find({ ownerId, active: true }).sort({ updatedAt: -1 }).toArray()

export const policyHistory = (ownerId: string, installationId: string | null, agentId: string | null): Promise<TradingPolicy[]> =>
  policies.find({ ownerId, installationId, agentId }).sort({ version: -1 }).limit(20).toArray()

export const policyPublic = (p: TradingPolicy) => ({
  id: p._id.toString(),
  installationId: p.installationId,
  agentId: p.agentId,
  version: p.version,
  active: p.active,
  rules: p.rules,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
})

export const policiesCollection = policies
