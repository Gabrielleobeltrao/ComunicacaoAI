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

const numeroOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

const HORA = /^\d{1,2}:\d{2}$/

/**
 * Regras vindas da API, saneadas.
 *
 * Um valor inválido vira ausência — e ausência quer dizer "sem esse limite". Guardar
 * um limite que ninguém consegue interpretar seria pior: ele barraria tudo, ou nada,
 * dependendo de onde o defeito caísse.
 */
export function normalizeRules(bruto: unknown): PolicyRules {
  const r = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Record<string, unknown>
  const regras: PolicyRules = {}
  for (const campo of ['maxOrderValue', 'maxQuantity', 'maxPortfolioPercent', 'maxDailyLoss', 'maxOrdersPerDay'] as const) {
    const n = numeroOuNulo(r[campo])
    if (n !== null) regras[campo] = n
  }
  if (regras.maxPortfolioPercent !== undefined && regras.maxPortfolioPercent !== null && regras.maxPortfolioPercent > 100) {
    throw new ValidationError('o percentual máximo da carteira não pode passar de 100')
  }
  for (const campo of ['requireStopLoss', 'requireTakeProfit', 'blockDuplicatePosition', 'blockShort', 'blockOptions'] as const) {
    if (r[campo] === true) regras[campo] = true
  }
  if (Array.isArray(r.symbolAllowlist)) {
    const lista = [...new Set(r.symbolAllowlist.map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean))].slice(0, 200)
    if (lista.length) regras.symbolAllowlist = lista
  }
  const janela = (typeof r.tradingHours === 'object' && r.tradingHours !== null ? r.tradingHours : null) as Record<string, unknown> | null
  if (janela) {
    const start = String(janela.start ?? '')
    const end = String(janela.end ?? '')
    const timezone = String(janela.timezone ?? '').trim()
    if (!HORA.test(start) || !HORA.test(end)) throw new ValidationError('a janela de horário precisa de início e fim no formato HH:MM')
    // Sem fuso, "das 10 às 17" não quer dizer nada — e um padrão silencioso escolheria
    // por alguém que não pediu.
    if (!timezone) throw new ValidationError('a janela de horário precisa do fuso')
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    } catch {
      throw new ValidationError(`fuso desconhecido: ${timezone}`)
    }
    const days = Array.isArray(janela.days) ? janela.days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : []
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
