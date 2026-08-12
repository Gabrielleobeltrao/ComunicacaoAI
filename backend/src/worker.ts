import 'dotenv/config'
import { Worker } from 'bullmq'
import { ObjectId } from 'mongodb'
import { db, mongoClient } from './db.js'
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
import { safeFetch } from './net/safeHttp.js'
import { getProviderApiKey } from './userSettings.js'
import type { Provider } from './llm.js'

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
      const agent = await db.collection('agents').findOne({ _id: new ObjectId(call.agentId), ownerId: run.ownerId })
      if (!agent) throw new Error(`agente não encontrado: ${call.agentId}`)
      const provider = (agent.provider as Provider) ?? 'anthropic'
      const apiKey = await getProviderApiKey(run.ownerId, provider)
      const result = await executeAgentTask({
        objective: String(agent.objective ?? call.objective ?? ''),
        instructions: call.instructions,
        input: call.input,
        context: call.context,
        provider,
        model: (agent.model as string | null) ?? null,
        apiKey,
        output: { format: call.format },
      })
      return { output: result.output }
    },
    // Real email/Telegram delivery arrives in the connections/deliveries phase.
    // Until then a delivery step records intent without sending.
    deliver: async () => ({ providerMessageId: null }),
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
