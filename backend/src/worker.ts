import 'dotenv/config'
import { Worker } from 'bullmq'
import { ObjectId } from 'mongodb'
import { mongoClient } from './db.js'
import { createConnection, RUN_QUEUE } from './automations/queue.js'
import { SCHEDULE_QUEUE, reconcileSchedules } from './automations/scheduler.js'
import { createRun } from './automations/runService.js'
import {
  findRunUnscoped,
  insertArtifact,
  insertStepRun,
  updateRun,
} from './automations/runRepository.js'
import { runDefinition } from './automations/runner.js'
import type { RunnerDeps } from './automations/runner.js'
import { preview } from './automations/runTypes.js'
import type { AutomationRun, RunStatus, StepRun } from './automations/runTypes.js'
import { executeAgentTask } from './agentRuntime.js'
import { getAgentById } from './agents.js'
import { resolveOwnedSectorId } from './sectors.js'
import { rootContext } from './delegation.js'
import { productionDelegationDeps, resolveToolsWithDelegation } from './delegationWiring.js'
import { safeFetch } from './net/safeHttp.js'
import { getProviderApiKey } from './userSettings.js'
import { attemptChargeKey, recordReplyUsageOnce } from './tokenUsage.js'
import { finalizeAgentEvent, runEventKey } from './agentEvents.js'
import { executeRoutineStep } from './automations/routineExecution.js'
import type { Provider } from './llm.js'
import { retrieveContext } from './knowledge.js'
import { decryptConfig, getConnection } from './connections/service.js'
import { insertDeliveryIdempotent, updateDelivery } from './connections/repository.js'
import { maskDestination, sendEmail, sendTelegram } from './connections/adapters.js'
import type { Delivery, EmailConfig, TelegramConfig } from './connections/types.js'

// Automation worker process (plan §10.1). Same image/codebase as the API, run
// with `npm run start:worker`. Consumes the run queue, executes each run through
// the linear runner with real adapters, and persists step-runs + artifacts +
// final status. MongoDB is the source of truth; BullMQ only coordinates jobs.

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4)

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

async function processRun(runId: string): Promise<void> {
  const run = await findRunUnscoped(new ObjectId(runId))
  if (!run) return
  if (run.status === 'cancel_requested') {
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
  await updateRun(run._id, {
    status: outcome.status as RunStatus,
    finishedAt: now,
    finalOutput: outcome.finalOutput,
    // Real consumption of the whole run (summed across steps and their attempts).
    usage: outcome.usage,
    error: failed ? { kind: failed.errorKind ?? 'error', message: failed.errorMessage ?? 'step failed' } : null,
  })
}

async function main(): Promise<void> {
  await mongoClient.connect()
  const connection = createConnection()

  // Run worker: executes each enqueued automation run.
  const worker = new Worker(RUN_QUEUE, async (job) => processRun(String(job.data.runId)), {
    connection,
    concurrency: CONCURRENCY,
  })
  worker.on('failed', (job, err) => console.error(`run job ${job?.id} failed:`, err.message))

  // Scheduler: mirror Mongo schedules onto BullMQ, then keep them reconciled. A
  // fired scheduler creates one run per scheduled instant (idempotency key =
  // automationId + fire timestamp), so a re-fire never duplicates work.
  await reconcileSchedules().catch((err) => console.error('schedule reconcile failed:', err))
  const reconcileTimer = setInterval(() => {
    void reconcileSchedules().catch((err) => console.error('schedule reconcile failed:', err))
  }, 60_000)
  reconcileTimer.unref()

  const scheduleWorker = new Worker(
    SCHEDULE_QUEUE,
    async (job) => {
      const { automationId, ownerId } = job.data as { automationId: string; ownerId: string }
      await createRun(ownerId, new ObjectId(automationId), {
        triggerType: 'schedule',
        idempotencyKey: `${automationId}:${job.timestamp}`,
      })
    },
    { connection: createConnection(), concurrency: CONCURRENCY },
  )
  scheduleWorker.on('failed', (job, err) => console.error(`schedule job ${job?.id} failed:`, err.message))

  console.log(`Automation worker up (concurrency ${CONCURRENCY}) — runs + scheduler`)

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`Received ${signal}, draining worker...`)
    clearInterval(reconcileTimer)
    try {
      await Promise.all([worker.close(), scheduleWorker.close()])
      await connection.quit()
      await mongoClient.close()
      process.exit(0)
    } catch (err) {
      console.error('Worker shutdown error:', err)
      process.exit(1)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('Worker fatal startup error:', err)
  process.exit(1)
})
