import 'dotenv/config'
import { mongoClient } from './db.js'
import { startAutomationEngine } from './automations/engine.js'

// Standalone automation worker. NOT required in a normal deployment: the same
// engine runs inside the API process by default (see automations/engine.ts). This
// entrypoint exists for installs that prefer a dedicated process — set
// EMBEDDED_WORKER=false on the API and run `npm run start:worker` here.
//
// MongoDB is the only dependency. There is no broker: the runs collection is the
// queue, and `nextRunAt` on each automation is the schedule.

// A worker that "starts" but cannot reach the database is worse than one that
// dies, because the routines it should run just silently never happen.
const STARTUP_PROBE_MS = Number(process.env.WORKER_STARTUP_PROBE_MS ?? 10_000)

async function withinTimeout<T>(what: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  await withinTimeout('MongoDB', STARTUP_PROBE_MS, mongoClient.connect().then(() => mongoClient.db().command({ ping: 1 })))
  console.log('Worker: MongoDB reachable')

  const engine = await startAutomationEngine()

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`Received ${signal}, draining worker...`)
    // Emergency brake only: it fires solely if the orderly close below hangs, so
    // in-flight runs are never abandoned just because a signal arrived.
    const forced = setTimeout(() => {
      console.error('Worker shutdown timed out — forcing exit')
      process.exit(1)
    }, 20_000)
    forced.unref()
    try {
      await engine.stop()
      await mongoClient.close()
      clearTimeout(forced)
      console.log('Worker shutdown complete')
    } catch (err) {
      console.error('Worker shutdown error:', err)
      process.exitCode = 1
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('Worker fatal startup error:', err)
  process.exit(1)
})
