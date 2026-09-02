import { ObjectId } from 'mongodb'
import { resolveAgentSubject } from '../resources/scope.js'
import { getDataStore, getDataset, grantsForSubject } from './store.js'
import type { DatabaseCapability, DataStoreGrant } from './types.js'

// QUEM PODE FAZER O QUÊ com um database — com precedência determinística.
//
// Diferente de Knowledge (que tem política própria) e de App (que tem instalação e ação),
// aqui não existia nada. A regra é a mais simples que resolve o problema real:
//
//   1. `deny` VENCE, sempre. Uma exceção que perde para uma herança é decorativa.
//   2. Grant DIRETO no agente vence a herança — ele é a decisão mais específica.
//   3. Setor vence andar, que vence prédio: do mais específico para o mais geral.
//   4. Sem nenhum grant: sem acesso. Proximidade visual não concede nada.
//
// A hierarquia é lida AGORA, no momento da autorização: tirar um agente do setor tira o
// acesso na próxima execução, sem ninguém precisar limpar grant nenhum.

export interface DatabaseAccessDecision {
  allowed: boolean
  capabilities: DatabaseCapability[]
  origin: 'direct' | 'sector' | 'floor' | 'building' | 'owner' | 'none'
  reason: string
}

const PESO: Record<DataStoreGrant['subjectType'], number> = { agent: 3, sector: 2, floor: 1, building: 0 }
const ORIGEM: Record<DataStoreGrant['subjectType'], DatabaseAccessDecision['origin']> = {
  agent: 'direct',
  sector: 'sector',
  floor: 'floor',
  building: 'building',
}
const MOTIVO: Record<DataStoreGrant['subjectType'], string> = {
  agent: 'concedido diretamente a este agente',
  sector: 'concedido ao setor de que ele participa',
  floor: 'concedido ao andar dele',
  building: 'concedido ao prédio',
}

const negado = (reason = 'este agente não tem acesso a este database'): DatabaseAccessDecision => ({
  allowed: false,
  capabilities: [],
  origin: 'none',
  reason,
})

export interface DatabaseAccessQuery {
  accountId: string
  dataStoreId: ObjectId
  datasetKey?: string | null
  agentId?: ObjectId | null
  capability?: DatabaseCapability | null
}

export async function resolveDatabaseAccess(q: DatabaseAccessQuery): Promise<DatabaseAccessDecision> {
  const store = await getDataStore(q.accountId, q.dataStoreId)
  if (!store) return negado('este database não está disponível para esta conta')

  if (!q.agentId) {
    // Pergunta administrativa: quem administra a conta administra os databases dela.
    return { allowed: true, capabilities: ['discover', 'query', 'insert', 'update', 'delete', 'manage_schema', 'manage_access'], origin: 'owner', reason: 'você administra esta conta' }
  }

  const sujeito = await resolveAgentSubject(q.accountId, q.agentId)
  if (!sujeito) return negado()

  /**
   * Store pausado ou arquivado não responde a agente nenhum — nem com grant.
   *
   * Pausar precisa PARAR de verdade: um estado que só muda a cor de um selo é um estado
   * em que ninguém confia na hora em que ele importa.
   */
  if (store.status !== 'active') {
    return negado(`este database está ${store.status === 'paused' ? 'pausado' : 'arquivado'}`)
  }

  const ids = [sujeito.subjectId, ...sujeito.sectorIds, ...(sujeito.floorId ? [sujeito.floorId] : []), ...(sujeito.buildingId ? [sujeito.buildingId] : [])]
  const grants = await grantsForSubject(q.accountId, q.dataStoreId, ids)
  if (grants.length === 0) return negado()

  // O dataset restringe: um grant limitado a `pedidos` não vale para `clientes`.
  const aplicaveis = grants.filter((g) => !q.datasetKey || g.datasetKeys.length === 0 || g.datasetKeys.includes(q.datasetKey))
  if (aplicaveis.length === 0) return negado('o acesso concedido não inclui este dataset')

  // `deny` primeiro, e ele vence qualquer allow — inclusive um mais específico.
  const proibido = new Set<DatabaseCapability>()
  for (const g of aplicaveis.filter((g) => g.effect === 'deny')) for (const c of g.capabilities) proibido.add(c)

  const permissoes = aplicaveis.filter((g) => g.effect === 'allow').sort((a, b) => PESO[b.subjectType] - PESO[a.subjectType])
  if (permissoes.length === 0) {
    return negado(proibido.size > 0 ? 'há uma negação explícita para este agente' : 'este agente não tem acesso a este database')
  }

  const vencedor = permissoes[0]
  const capacidades = vencedor.capabilities.filter((c) => !proibido.has(c))
  if (capacidades.length === 0) {
    return { allowed: false, capabilities: [], origin: ORIGEM[vencedor.subjectType], reason: 'todas as capacidades concedidas foram negadas explicitamente' }
  }

  if (q.capability && !capacidades.includes(q.capability)) {
    return {
      allowed: false,
      capabilities: capacidades,
      origin: ORIGEM[vencedor.subjectType],
      reason: proibido.has(q.capability) ? `"${q.capability}" foi negado explicitamente` : `"${q.capability}" não está entre as capacidades concedidas`,
    }
  }

  return { allowed: true, capabilities: capacidades, origin: ORIGEM[vencedor.subjectType], reason: MOTIVO[vencedor.subjectType] }
}

/**
 * A trava de MUTABILIDADE — conferida depois do grant, e independente dele.
 *
 * Um grant malformado com `delete` num dataset `append_only` não pode apagar nada. As
 * duas perguntas são diferentes: "esta pessoa pode?" e "isto é possível neste dataset?".
 * Confundi-las é como uma série temporal perde o passado por causa de um grant escrito às
 * pressas.
 */
export async function assertMutationAllowed(
  accountId: string,
  dataStoreId: ObjectId,
  datasetKey: string,
  capability: 'insert' | 'update' | 'delete',
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const dataset = await getDataset(accountId, dataStoreId, datasetKey)
  if (!dataset) return { ok: false, reason: 'dataset não encontrado' }
  if (dataset.mutability === 'read_only') return { ok: false, reason: 'este dataset é somente leitura' }
  if (dataset.mutability === 'append_only' && capability !== 'insert') {
    return { ok: false, reason: 'este dataset só aceita novos registros — alterar e apagar mudariam o passado' }
  }
  return { ok: true }
}
