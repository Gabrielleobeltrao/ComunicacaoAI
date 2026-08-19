// Production wiring for delegation: binds the injected DelegationDeps to the real
// agent store, tool resolver, task runtime, provider keys and delegation log. Kept
// separate from ./delegation.ts so that module stays IO-free and unit-testable.
import { getAgentById, listAgents } from './agents.js'
import type { Agent } from './agents.js'
import { getFloor, listFloors } from './floors.js'
import { getSectorById, normalizeSectorMode } from './sectors.js'
import { resolveAgentTools } from './builtinTools.js'
import { executeAgentTask } from './agentRuntime.js'
import { reportAgentState } from './agentLiveState.js'
import { finishSectorExecution, startSectorExecution } from './sectorExecutions.js'
import { sectorEntryDecisionFor } from './sectorAccess.js'
import { getFloorCommunication } from './floorCommunication.js'
import { ensureDefaultBuilding } from './building.js'
import type { AgentBubbleState } from './agentLiveState.js'
import { getProviderApiKey } from './userSettings.js'
import type { Provider } from './llm.js'
import type { ResolvedTool } from './agentTools.js'
import { ObjectId } from 'mongodb'
import { finishDelegation, startDelegation } from './delegationLog.js'
import { recordAgentEvent } from './agentEvents.js'
import { recordReplyUsageOnce } from './tokenUsage.js'
import { listDocuments, retrieveContext } from './knowledge.js'
import { ensureAgentWebKnowledgeFresh } from './webKnowledge.js'
import { askAux, auxiliaryModel } from './llm.js'
import { AUTO_MODEL } from './autoModel.js'
import { agentCanDelegate, buildDelegationTools, capabilityMissingTool } from './delegation.js'
import type { DelegationContext, DelegationDeps } from './delegation.js'
import { TEAM_TOOL_NAMES } from './delegation.js'
import { livePassagesFor } from './automations/liveSources.js'
import { createLiveTracker } from './agentLiveTracker.js'

// The tool list an agent runs with in a delegation-aware context: its own tools,
// the capability_missing escape hatch (every task agent), plus the delegation tools
// bound to the child context when it may delegate.
export async function resolveToolsWithDelegation(
  agent: Agent,
  ownerId: string,
  childCtx: DelegationContext,
  deps: DelegationDeps,
  // Quantas vezes já se pediu esclarecimento nesta conversa — o teto vem daqui.
  jaPerguntou = 0,
): Promise<ResolvedTool[]> {
  const base = await resolveAgentTools(agent, ownerId, jaPerguntou)
  // An agent coordinating a sector RIGHT NOW gets the delegation tools even when its
  // own policy is 'none': the sector grant is the authorisation, and without the
  // tools it could not reach the team it was put in charge of. The grant itself stays
  // narrow (that sector's members, one level).
  const coordinatingNow = Boolean(childCtx.sectorGrant?.memberIds.length)
  const canDelegate = agentCanDelegate(agent) || coordinatingNow
  return [...base, capabilityMissingTool(), ...(canDelegate ? buildDelegationTools(childCtx, deps) : [])]
}

/**
 * As mesmas dependências de produção, com as ferramentas que ESCREVEM removidas.
 *
 * O Playground roda o fluxo de verdade — coordenador, especialistas, base, memória —
 * e é justamente por isso que ele não pode mandar e-mail, criar cobrança ou chamar a
 * API de ninguém: quem está testando não espera que o teste aconteça de verdade.
 *
 * O filtro vive no `resolveTools`, que é por onde TODO agente da cadeia passa: o
 * coordenador e cada membro que ele acionar. Passam leitura, `buscar_memoria` (que é
 * leitura) e as ferramentas de time — sem elas não haveria time para testar. Risco
 * ausente conta como escrita, como em todo lugar.
 */
export function playgroundDelegationDeps(jaPerguntou = 0): DelegationDeps {
  const deps = productionDelegationDeps()
  const permitidas = new Set<string>(TEAM_TOOL_NAMES)
  return {
    ...deps,
    resolveTools: async (agent, ownerId, childCtx) => {
      const todas = await resolveToolsWithDelegation(agent, ownerId, childCtx, deps, jaPerguntou)
      return todas.filter((t) => (t.risk ?? 'write') === 'read' || permitidas.has(t.name))
    },
  }
}

export function productionDelegationDeps(): DelegationDeps {
  const deps: DelegationDeps = {
    // The building's floor-communication configuration. The gate decides what it
    // means; this only fetches it, owner-scoped.
    loadCommunication: async (ownerId) => {
      const building = await ensureDefaultBuilding(ownerId)
      return getFloorCommunication(ownerId, building._id)
    },
    // Which protected sector (if any) refuses a direct call to this agent. One query,
    // owner-scoped: a sector from another account cannot protect anything here.
    sectorEntryFor: async (ownerId, targetAgentId) => {
      const decision = await sectorEntryDecisionFor(ownerId, targetAgentId)
      return decision
    },
    // The sector execution root: created before the first agent, closed on every
    // exit. Awaited, because the participations must be able to point at it.
    startSectorExecution: (input) => startSectorExecution(input),
    finishSectorExecution: (executionKey, outcome) => finishSectorExecution(executionKey, outcome),
    // Fire-and-forget: telemetry never delays or breaks a delegation.
    /**
     * Quem distribui o pedido entre os membros do setor.
     *
     * Usa o modelo AUXILIAR do coordenador: escolher quem trabalha é uma decisão curta
     * sobre uma lista curta, e pagar o modelo principal por ela seria caro sem ser
     * melhor. Falha aqui não derruba nada — o planejador cai no determinístico.
     */
    planWithModel: async (ownerId, coordinator, prompt) => {
      const apiKey = await getProviderApiKey(ownerId, coordinator.provider)
      const modelo =
        coordinator.cheapAuxModel === false && coordinator.model && coordinator.model !== AUTO_MODEL
          ? coordinator.model
          : auxiliaryModel(coordinator.provider)
      return askAux(coordinator.provider, prompt, modelo, apiKey, 700)
    },
    // A base viva do agente, verificada antes de ele trabalhar. Quem decide se vale a
    // leitura é a política da fonte — aqui é só a ligação.
    ensureWebKnowledgeFresh: (ownerId, agentId) => ensureAgentWebKnowledgeFresh(ownerId, agentId, 'on_demand'),
    // Só os TÍTULOS: dizem quem tem o dado sem abrir o dado.
    knowledgeTitlesFor: async (_ownerId, agentId) => (await listDocuments(agentId)).map((d) => d.title).filter(Boolean),
    // O balão de quem EXECUTA. `reportState` acima é o de quem DELEGA — os dois
    // existem porque são fatos diferentes acontecendo ao mesmo tempo.
    trackerFor: (ownerId, agentId, floorId, rootExecutionId) => createLiveTracker({ ownerId, agentId, floorId, rootExecutionId }),
    reportState: (input) => {
      void reportAgentState({
        ownerId: input.ownerId,
        agentId: input.agentId,
        floorId: input.floorId,
        rootExecutionId: input.rootExecutionId,
        state: input.state as AgentBubbleState,
        detail: input.detail,
      }).catch(() => undefined)
    },
    loadAgent: (ownerId, id) => getAgentById(ownerId, id),
    loadSector: async (ownerId, id) => {
      const s = await getSectorById(ownerId, id)
      if (!s) return null
      return {
        _id: s._id,
        name: s.name,
        officeId: s.officeId,
        mode: normalizeSectorMode(s.mode),
        coordinatorAgentId: s.coordinatorAgentId ?? null,
        instruction: s.instruction ?? '',
        members: s.members,
        stages: (s.stages ?? []).map((st) => ({
          id: st.id,
          name: st.name,
          agentId: st.agentId,
          instruction: st.instruction,
          dependsOn: st.dependsOn ?? [],
          expectedOutput: st.expectedOutput ?? '',
          onError: st.onError ?? 'stop',
          retryPolicy: st.retryPolicy ?? { maxAttempts: 1, backoffMs: 2000 },
        })),
      }
    },
    // Every agent whose FLOOR belongs to this building — delegation spans floors of
    // the same building, not just one floor.
    listAgentsInBuilding: async (ownerId, buildingId) => {
      const floors = await listFloors(ownerId, { includeArchived: true })
      const floorIds = new Set(floors.filter((f) => f.buildingId.toString() === buildingId).map((f) => f._id.toString()))
      const all = await listAgents(ownerId)
      return all.filter((a) => floorIds.has(a.officeId.toString()))
    },
    buildingIdForFloor: async (ownerId, floorId) => {
      const floor = await getFloor(ownerId, floorId)
      return floor ? floor.buildingId.toString() : null
    },
    resolveTools: (agent, ownerId, childCtx) => resolveToolsWithDelegation(agent, ownerId, childCtx, deps),
    apiKeyFor: (ownerId, provider) => getProviderApiKey(ownerId, provider as Provider),
    runTask: (req) => executeAgentTask(req),
    startDelegation,
    finishDelegation,
    // Returns the promise so the caller can AWAIT it (no fire-and-forget).
    recordEvent: (e) => recordAgentEvent({ ...e, buildingId: ObjectId.isValid(e.buildingId) ? new ObjectId(e.buildingId) : null }).then(() => undefined),
    // Owner accounting for delegated/sector inferences — charged once per event key,
    // so a redelivered/replayed emit never bills twice.
    // Canonical retrieval path: agent base + sector base (ONLY with an explicit,
    // already owner-verified sector context). The WHOLE result travels — status and
    // provenance included — so a delegation can tell "found nothing" from "could not
    // look", and can cite what it used.
    retrieveContext: (agentId, query, opts) => retrieveContext(agentId, query, { verifiedSectorId: opts.sectorId ?? null }),
    livePassages: (ownerId, agent) => livePassagesFor(ownerId, agent),
    chargeUsage: (ownerId, usage, chargeKey) => recordReplyUsageOnce(ownerId, usage, chargeKey).then(() => undefined),
  }
  return deps
}
