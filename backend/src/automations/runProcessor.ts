import { ObjectId } from 'mongodb'
import {
  findRunUnscoped,
  insertArtifact,
  insertStepRun,
  updateRun,
} from './runRepository.js'
import { runDefinition } from './runner.js'
import type { RunnerDeps } from './runner.js'
import { preview } from './runTypes.js'
import type { AutomationRun, RunStatus, StepRun } from './runTypes.js'
import { executeAgentTask } from '../agentRuntime.js'
import { getAgentById } from '../agents.js'
import { resolveOwnedSectorId } from '../sectors.js'
import { rootContext } from '../delegation.js'
import { productionDelegationDeps, resolveToolsWithDelegation } from '../delegationWiring.js'
import { safeFetch } from '../net/safeHttp.js'
import { getProviderApiKey } from '../userSettings.js'
import { attemptChargeKey, recordReplyUsageOnce } from '../tokenUsage.js'
import { finalizeAgentEvent, runEventKey } from '../agentEvents.js'
import { executeRoutineStep } from './routineExecution.js'
import { createLiveTracker } from '../agentLiveTracker.js'
import type { Provider } from '../llm.js'
import { retrieveContext } from '../knowledge.js'
import { decryptConfig, getConnection } from '../connections/service.js'
import { insertDeliveryIdempotent, updateDelivery } from '../connections/repository.js'
import { maskDestination, sendEmail, sendTelegram } from '../connections/adapters.js'
import type { Delivery, EmailConfig, TelegramConfig } from '../connections/types.js'

// Executing ONE run: builds the real adapters, drives the linear runner, and
// persists step-runs, artifacts and the final status. Shared by the automation
// engine embedded in the API and by the standalone worker entrypoint — the same
// code either way, so behaviour cannot differ between the two deployments.

// Adapters wiring the runner's injected IO to the real subsystems, scoped to the
// run's owner (never trust ids across owners).
function buildDeps(run: AutomationRun): RunnerDeps {
  return {
    fetchUrl: async (url, opts) => {
      const res = await safeFetch(url, { contentTypeAllowlist: opts?.contentTypeAllowlist })
      return { body: res.body, contentType: res.contentType }
    },
    runAgent: async (call) => {
      // The whole rule lives in executeRoutineStep (authorise sector → ground → run →
      // await charge + telemetry). The worker only wires the real adapters.
      const deps = productionDelegationDeps()
      const isCanceled = async () => (await findRunUnscoped(run._id))?.status === 'cancel_requested'
      const step = await executeRoutineStep(
        call,
        { ownerId: run.ownerId, runId: run._id.toString(), buildingId: run.buildingId, floorId: run.floorId },
        {
          loadAgent: getAgentById,
          resolveOwnedSectorId,
          retrieveContext,
          resolveTools: (agent, ownerId) =>
            resolveToolsWithDelegation(
              agent,
              ownerId,
              rootContext({ ownerId, buildingId: run.buildingId.toString(), correlationId: run._id.toString(), agent, isCanceled }),
              deps,
            ),
          apiKeyFor: (ownerId, provider) => getProviderApiKey(ownerId, provider as Provider),
          runTask: executeAgentTask,
          charge: recordReplyUsageOnce,
          chargeKeyFor: attemptChargeKey,
          finalizeEvent: finalizeAgentEvent,
          eventKeyFor: runEventKey,
          isCanceled,
          // The live map: one projection row per (agent, run), removed by TTL if
          // this worker dies mid-step.
          trackerFor: (agentId) =>
            createLiveTracker({ ownerId: run.ownerId, agentId, floorId: run.floorId, rootExecutionId: run._id.toString() }),
        },
      )
      return {
        output: step.output,
        usage: step.usage,
        // The runner awaits this outside the step timeout.
        settle: step.settle.then((ok) => {
          if (!ok) console.error(`run ${run._id.toString()} step ${call.stepId}: accounting/telemetry could not be persisted`)
        }),
      }
    },
    // Resolve the connection, record the delivery idempotently, then send.
    deliver: async (call) => {
      const conn = await getConnection(run.ownerId, new ObjectId(call.connectionId))
      if (!conn) throw new Error(`conexão não encontrada: ${call.connectionId}`)
      const idempotencyKey = `${run._id.toString()}:${call.connectionId}:${call.destination}`
      const record: Delivery = {
        _id: new ObjectId(),
        ownerId: run.ownerId,
        runId: run._id,
        provider: conn.provider,
        connectionId: conn._id,
        destinationMasked: maskDestination(call.destination),
        status: 'sending',
        attempt: 1,
        providerMessageId: null,
        idempotencyKey,
        error: null,
        createdAt: new Date(),
        sentAt: null,
      }
      const { delivery, created } = await insertDeliveryIdempotent(record)
      if (!created && delivery.status === 'sent') return { providerMessageId: delivery.providerMessageId }
      // The result is leaving the building: the agents behind this run show it.
      for (const tracker of trackersFor(run)) tracker.report('delivering', { targetType: 'channel' })
      try {
        const config = decryptConfig(conn)
        const result =
          conn.provider === 'email'
            ? await sendEmail(config as EmailConfig, { to: call.destination, subject: call.subject, text: call.content })
            : await sendTelegram(config as TelegramConfig, { chatId: call.destination, text: call.content })
        await updateDelivery(delivery._id, { status: 'sent', providerMessageId: result.providerMessageId, sentAt: new Date() })
        return { providerMessageId: result.providerMessageId }
      } catch (error) {
        await updateDelivery(delivery._id, { status: 'failed', error: { kind: 'delivery', message: (error as Error).message } })
        throw error
      }
    },
    now: () => Date.now(),
    // Cooperative cancellation: re-read the run status between steps.
    isCanceled: async () => {
      const fresh = await findRunUnscoped(run._id)
      return fresh?.status === 'cancel_requested'
    },
  }
}

// Which agents this run actually drives. Read from the SNAPSHOT, so a routine edited
// mid-flight cannot retarget a running execution.
function agentIdsOf(run: AutomationRun): string[] {
  const steps = (run.definitionSnapshot as { steps?: Array<{ type?: string; config?: { agentId?: unknown } }> } | undefined)?.steps ?? []
  return [...new Set(steps.filter((s) => s.type === 'agent.execute' && typeof s.config?.agentId === 'string').map((s) => String(s.config?.agentId)))]
}

const trackersFor = (run: AutomationRun) =>
  agentIdsOf(run).map((agentId) =>
    createLiveTracker({ ownerId: run.ownerId, agentId, floorId: run.floorId, rootExecutionId: run._id.toString() }),
  )

export async function processRun(runId: string): Promise<void> {
  const run = await findRunUnscoped(new ObjectId(runId))
  if (!run) return
  // Already finished: a lease that expired during the final write must never turn
  // into a second execution (which would deliver twice and charge twice).
  if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled') return
  if (run.status === 'cancel_requested') {
    await Promise.all(trackersFor(run).map((tracker) => tracker.finish('canceled')))
    await updateRun(run._id, { status: 'canceled', finishedAt: new Date() })
    return
  }

  await updateRun(run._id, { status: 'running', startedAt: new Date() })
  const outcome = await runDefinition(run.definitionSnapshot, buildDeps(run), run.triggerPayload)

  // Persist a step-run per executed step (previews truncated/sanitized).
  const now = new Date()
  for (const s of outcome.steps) {
    const stepRun: StepRun = {
      _id: new ObjectId(),
      ownerId: run.ownerId,
      runId: run._id,
      stepId: s.stepId,
      stepType: s.stepType,
      attempt: s.attempts,
      status: s.status,
      outputPreview: preview(s.output),
      artifactIds: [],
      startedAt: now,
      finishedAt: now,
      error: s.errorMessage ? { kind: s.errorKind ?? 'error', message: s.errorMessage } : null,
    }
    await insertStepRun(stepRun)
  }

  // Persist the final output as an artifact when there is one.
  if (outcome.finalOutput) {
    const kind = run.definitionSnapshot.resultFormat === 'json' ? 'json' : run.definitionSnapshot.resultFormat === 'text' ? 'text' : 'markdown'
    await insertArtifact({
      _id: new ObjectId(),
      ownerId: run.ownerId,
      buildingId: run.buildingId,
      floorId: run.floorId,
      runId: run._id,
      name: 'resultado',
      kind,
      mimeType: kind === 'json' ? 'application/json' : kind === 'text' ? 'text/plain' : 'text/markdown',
      sizeBytes: Buffer.byteLength(outcome.finalOutput),
      content: outcome.finalOutput,
      createdAt: now,
    })
  }

  const failed = outcome.steps.find((s) => s.status === 'failed')
  // The run ended: every agent it drove lands on a terminal state, whatever the step
  // instrumentation managed to report before.
  const terminal = outcome.status === 'succeeded' ? 'completed' : outcome.status === 'canceled' ? 'canceled' : 'failed'
  await Promise.all(trackersFor(run).map((tracker) => tracker.finish(terminal)))
  await updateRun(run._id, {
    status: outcome.status as RunStatus,
    finishedAt: now,
    finalOutput: outcome.finalOutput,
    // Real consumption of the whole run (summed across steps and their attempts).
    usage: outcome.usage,
    error: failed ? { kind: failed.errorKind ?? 'error', message: failed.errorMessage ?? 'step failed' } : null,
  })
}

