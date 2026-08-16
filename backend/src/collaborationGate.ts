// ONE place that decides whether a call may happen.
//
// Discovery, readiness, configuration validation and the delegation tools all ask
// this — otherwise "who can call whom" would be answered by four implementations
// that drift, and the map would offer targets the runtime then refuses.
//
// The order is fixed and it matters: the cheapest, most absolute checks first, so a
// denial never costs an inference and never reveals more than the reason it gives.
//
//   1. same owner and same building;
//   2. if the floors differ, the building's policy/link allows origin → destination;
//   3. the caller's outgoing policy allows this target;
//   4. on a direct call to an agent, the target's incoming policy allows the caller;
//   5. if the target is protected by a sector's entry policy, that policy allows it;
//   6. depth, ancestry, budget and cancellation still permit continuing.
//
// Pure and synchronous: everything it needs is resolved by the caller. That is what
// makes it usable by discovery (which must hide what would be refused) as well as by
// the runtime.
import type { Agent } from './agents.js'
import type { FloorCommunicationConfig } from './floorCommunication.js'
import { canCommunicate } from './floorCommunication.js'

export type CollaborationDenyCode =
  | 'forbidden'
  | 'cross_floor_blocked'
  | 'floor_link_required'
  | 'unauthorized'
  | 'sector_entry_required'
  | 'depth_exceeded'
  | 'cycle'
  | 'budget_exceeded'
  | 'canceled'

export type CollaborationDecision =
  | { ok: true }
  | { ok: false; code: CollaborationDenyCode; reason: string; sectorId?: string; sectorName?: string }

export interface GateContext {
  buildingId: string
  callerAgentId: string
  ancestry: string[]
  depth: number
  maxDepth: number
  budget: { tokensSpent: number; tokenLimit: number }
  canceled?: boolean
  // The grant a sector's own run carries while it calls its members. Being on the
  // member list is NOT the same thing.
  sectorGrant?: { sectorId: string; memberIds: string[] } | null
}

export interface GateTarget {
  kind: 'agent' | 'sector'
  id: string
  ownerId: string
  buildingId: string
  floorId: string | null
  // Agents only: the incoming policy and its explicit list.
  callerPolicy?: Agent['callerPolicy']
  allowedCallerAgentIds?: string[]
  // A sector that only groups agents is not callable as a unit.
  executable?: boolean
  // Set when a sector protects this target from direct calls.
  protectedBy?: { sectorId: string; sectorName: string } | null
}

const policyAllows = (policy: Agent['delegationPolicy'], list: string[], id: string, sameFloor: boolean): boolean => {
  if (policy === 'all') return true
  if (policy === 'selected') return (list ?? []).includes(id)
  if (policy === 'floor') return sameFloor
  return false
}

export function checkCollaboration(caller: Agent, target: GateTarget, communication: FloorCommunicationConfig, ctx: GateContext): CollaborationDecision {
  // 1. owner and building
  if (target.ownerId !== caller.ownerId) return { ok: false, code: 'forbidden', reason: 'alvo de outro proprietário' }
  if (target.buildingId !== ctx.buildingId) return { ok: false, code: 'forbidden', reason: 'alvo de outro prédio' }

  const callerFloorId = caller.officeId ? caller.officeId.toString() : null
  const sameFloor = Boolean(callerFloorId && target.floorId && callerFloorId === target.floorId)

  // 2. crossing floors is a building-level decision, checked BEFORE any permission of
  // the two sides — a link that does not exist cannot be compensated by `all`.
  if (!sameFloor) {
    if (!canCommunicate(communication, callerFloorId, target.floorId)) {
      return communication.mode === 'isolated'
        ? { ok: false, code: 'cross_floor_blocked', reason: 'os andares deste prédio estão isolados' }
        : { ok: false, code: 'floor_link_required', reason: 'não existe conexão deste andar para o andar do alvo' }
    }
  }

  // 3. the caller's outgoing policy
  const list = target.kind === 'agent' ? (caller.callableAgentIds ?? []) : (caller.callableSectorIds ?? [])
  const grantedBySector = target.kind === 'agent' && (ctx.sectorGrant?.memberIds.includes(target.id) ?? false)
  if (!grantedBySector && !policyAllows(caller.delegationPolicy, list, target.id, sameFloor)) {
    return { ok: false, code: 'unauthorized', reason: 'este agente não está autorizado a chamar este alvo' }
  }

  if (target.kind === 'agent') {
    // 4. the target's incoming policy
    if (!grantedBySector) {
      const accepts =
        target.callerPolicy === 'all' ||
        (target.callerPolicy === 'selected' && (target.allowedCallerAgentIds ?? []).includes(caller._id.toString())) ||
        (target.callerPolicy === 'floor' && sameFloor)
      if (!accepts) return { ok: false, code: 'unauthorized', reason: 'o alvo não aceita chamadas deste agente' }
    }

    // 5. a closed core wins over an open `callerPolicy`: being reachable in general
    // does not mean reachable AROUND the sector that owns the flow.
    if (!grantedBySector && target.protectedBy) {
      return {
        ok: false,
        code: 'sector_entry_required',
        reason: `este agente participa do setor "${target.protectedBy.sectorName}", que só recebe chamadas pelo próprio setor`,
        sectorId: target.protectedBy.sectorId,
        sectorName: target.protectedBy.sectorName,
      }
    }
  } else if (target.executable === false) {
    return { ok: false, code: 'unauthorized', reason: 'este setor apenas agrupa agentes e não executa como unidade' }
  }

  // 6. what is left of the chain
  if (ctx.depth + 1 > ctx.maxDepth) return { ok: false, code: 'depth_exceeded', reason: `profundidade máxima (${ctx.maxDepth}) atingida` }
  if (target.id === ctx.callerAgentId || ctx.ancestry.includes(target.id)) return { ok: false, code: 'cycle', reason: 'ciclo de delegação detectado' }
  if (ctx.budget.tokensSpent >= ctx.budget.tokenLimit) return { ok: false, code: 'budget_exceeded', reason: 'orçamento de tokens da cadeia esgotado' }
  if (ctx.canceled) return { ok: false, code: 'canceled', reason: 'execução cancelada' }

  return { ok: true }
}

// Discovery must HIDE what would be refused, instead of letting the model try and
// fail. Same function, so the two can never disagree.
export const discoverable = <T extends GateTarget>(caller: Agent, targets: T[], communication: FloorCommunicationConfig, ctx: GateContext): T[] =>
  targets.filter((t) => checkCollaboration(caller, t, communication, ctx).ok)
