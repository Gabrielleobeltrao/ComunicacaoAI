import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import type { ExecutionRoot } from '../executionRoots.js'
import type { AutomationRun, StepRun } from '../automations/runTypes.js'
import type { MonitorDefinition } from '../monitors/state.js'

// A ATIVIDADE do escritório, correlacionada — e lida, nunca gravada de novo.
//
// A pergunta que esta projeção responde é uma só: "o que aconteceu, do começo ao fim?".
// Hoje a resposta está espalhada em coleções que já existem — a raiz de execução, a
// execução da automação, os passos e o monitor que pediu. Gravar uma quinta coleção com o
// mesmo conteúdo criaria uma segunda verdade que envelhece: bastaria um passo falhar
// entre as duas escritas para o painel contar uma história que o histórico nega.
//
// Por isso aqui não há coleção nova, não há TTL novo e não há contagem própria. Cada
// número vem de onde ele nasce, e cada linha é montada na leitura.
//
// E o que NÃO entra: payload de gatilho, prompt, resposta, documento e credencial. A
// linha do tempo diz o que rodou, quanto levou e como terminou — o conteúdo continua
// onde ele já mora, sob a permissão dele.

export interface ActivityStep {
  stepId: string
  stepType: string
  status: string
  durationMs: number | null
  /** Por que não rodou. Só existe quando o passo foi pulado. */
  skipReason?: string
  /** O erro já vem tipado e sem stack do próprio motor. */
  errorKind?: string | null
}

export interface ActivityItem {
  /** A correlação única: uma execução, uma linha. */
  executionKey: string
  status: ExecutionRoot['status']
  source: ExecutionRoot['source']
  environment: ExecutionRoot['environment']
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  durationMs: number | null
  /** De onde veio, quando dá para dizer: o monitor que reconheceu a transição. */
  origin: { kind: 'monitor'; id: string; name: string; eventId: string } | { kind: 'event'; eventId: string } | null
  flow: { id: string; name: string; version: number; triggerType: string } | null
  steps: ActivityStep[]
  /** As entregas que saíram — pelo passo que as executa, sem contar de novo. */
  deliveries: number
  usage: { inputTokens: number; outputTokens: number }
  errorKind: string | null
}

const roots = db.collection<ExecutionRoot>('execution_roots')
const runs = db.collection<AutomationRun>('automation_runs')
const steps = db.collection<StepRun>('step_runs')
const monitors = db.collection<MonitorDefinition>('monitors')
const automations = db.collection<{ _id: ObjectId; ownerId: string; name: string }>('automations')

export interface ActivityQuery {
  ownerId: string
  floorId?: string
  status?: ExecutionRoot['status']
  source?: ExecutionRoot['source']
  limit?: number
  before?: Date
}

const MAX_LIMIT = 50

/**
 * A correlação do monitor viaja no `requestId` — `monitor:<monitorId>:<eventId>`.
 *
 * Ela é derivada do evento e não carrega payload: é o que permite ligar a execução ao
 * monitor sem gravar em lugar nenhum o que o monitor viu.
 */
export function parseMonitorRequest(requestId: string | null | undefined): { monitorId: string; eventId: string } | null {
  const m = /^monitor:([a-f0-9]{24}):(.+)$/i.exec(String(requestId ?? ''))
  return m ? { monitorId: m[1], eventId: m[2] } : null
}

const parseEventRequest = (requestId: string | null | undefined): string | null => {
  const m = /^event:(.+)$/.exec(String(requestId ?? ''))
  return m ? m[1] : null
}

export async function listActivity(query: ActivityQuery): Promise<{ items: ActivityItem[]; nextBefore: Date | null }> {
  const limite = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? 20))
  const filtro: Record<string, unknown> = { ownerId: query.ownerId }
  if (query.status) filtro.status = query.status
  if (query.source) filtro.source = query.source
  if (query.floorId && ObjectId.isValid(query.floorId)) filtro.originFloorId = new ObjectId(query.floorId)
  if (query.before) filtro.createdAt = { $lt: query.before }

  const raizes = await roots.find(filtro).sort({ createdAt: -1 }).limit(limite).toArray()
  if (raizes.length === 0) return { items: [], nextBefore: null }

  // As execuções destas raízes, de uma vez. Uma consulta por linha transformaria a
  // primeira página do painel em vinte idas ao banco.
  const runIds = raizes.map((r) => r.sourceRefId).filter((id): id is ObjectId => Boolean(id))
  const execucoes = runIds.length ? await runs.find({ ownerId: query.ownerId, _id: { $in: runIds } }).toArray() : []
  const porRun = new Map(execucoes.map((r) => [r._id.toString(), r]))

  const passos = execucoes.length
    ? await steps.find({ ownerId: query.ownerId, runId: { $in: execucoes.map((r) => r._id) } }).sort({ startedAt: 1 }).toArray()
    : []
  const porExecucao = new Map<string, StepRun[]>()
  for (const p of passos) {
    const chave = p.runId.toString()
    const lista = porExecucao.get(chave) ?? []
    lista.push(p)
    porExecucao.set(chave, lista)
  }

  const nomesDeFlow = new Map(
    (execucoes.length
      ? await automations.find({ ownerId: query.ownerId, _id: { $in: execucoes.map((r) => r.automationId) } }, { projection: { name: 1 } }).toArray()
      : []
    ).map((a) => [a._id.toString(), a.name]),
  )

  const idsDeMonitor = execucoes
    .map((r) => parseMonitorRequest(r.requestId)?.monitorId ?? '')
    .filter((id) => ObjectId.isValid(id))
  const nomesDeMonitor = new Map(
    (idsDeMonitor.length
      ? await monitors.find({ ownerId: query.ownerId, _id: { $in: idsDeMonitor.map((id) => new ObjectId(id)) } }, { projection: { name: 1 } }).toArray()
      : []
    ).map((m) => [m._id.toString(), m.name]),
  )

  const items = raizes.map((raiz) => montar(raiz, porRun, porExecucao, nomesDeFlow, nomesDeMonitor))
  return { items, nextBefore: raizes.length === limite ? raizes[raizes.length - 1].createdAt : null }
}

function montar(
  raiz: ExecutionRoot,
  porRun: Map<string, AutomationRun>,
  porExecucao: Map<string, StepRun[]>,
  nomesDeFlow: Map<string, string>,
  nomesDeMonitor: Map<string, string>,
): ActivityItem {
  const run = raiz.sourceRefId ? porRun.get(raiz.sourceRefId.toString()) : undefined
  const passos = run ? (porExecucao.get(run._id.toString()) ?? []) : []
  const doMonitor = parseMonitorRequest(run?.requestId)
  const doEvento = parseEventRequest(run?.requestId)

  return {
    executionKey: raiz.executionKey,
    status: raiz.status,
    source: raiz.source,
    environment: raiz.environment,
    createdAt: raiz.createdAt,
    startedAt: raiz.startedAt,
    finishedAt: raiz.finishedAt,
    durationMs: raiz.startedAt && raiz.finishedAt ? raiz.finishedAt.getTime() - raiz.startedAt.getTime() : null,
    origin: doMonitor
      ? {
          kind: 'monitor',
          id: doMonitor.monitorId,
          // Monitor apagado depois da execução: a linha continua verdadeira, e o nome
          // some em vez de a linha sumir.
          name: nomesDeMonitor.get(doMonitor.monitorId) ?? 'monitor removido',
          eventId: doMonitor.eventId,
        }
      : doEvento
        ? { kind: 'event', eventId: doEvento }
        : null,
    flow: run
      ? {
          id: run.automationId.toString(),
          name: nomesDeFlow.get(run.automationId.toString()) ?? 'operação removida',
          version: run.automationVersion,
          triggerType: run.triggerType,
        }
      : null,
    steps: passos.map((p) => ({
      stepId: p.stepId,
      stepType: p.stepType,
      status: p.status,
      durationMs: p.startedAt && p.finishedAt ? p.finishedAt.getTime() - p.startedAt.getTime() : null,
      ...(p.skipReason ? { skipReason: p.skipReason } : {}),
      ...(p.error ? { errorKind: p.error.kind ?? null } : {}),
    })),
    /**
     * A entrega contada uma vez, pelo PASSO que a executa.
     *
     * Contar também no nível da execução somaria a mesma entrega duas vezes — é
     * exatamente a duplicação hierárquica que o painel não pode ter.
     */
    deliveries: passos.filter((p) => p.stepType === 'delivery.send' && p.status === 'succeeded').length,
    usage: run?.usage ?? { inputTokens: 0, outputTokens: 0 },
    errorKind: raiz.errorKind,
  }
}
