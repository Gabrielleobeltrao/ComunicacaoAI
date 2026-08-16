// Paint the office map with activity bubbles, to LOOK at them.
//
// It writes only to `agent_live_states` — the ephemeral projection the map reads.
// That collection has a TTL index, so everything written here removes itself; no
// agent, run, connection or credential is touched, and there is nothing to undo
// beyond waiting (or running with `--clear`).
//
// This is a viewing aid, not a fixture: the states are written directly instead of
// being produced by a real execution, so nothing here proves the runtime works. The
// integration tests do that.
//
//   npm run seed:bubbles -- --floor "Bastidores"
//   npm run seed:bubbles -- --floor "Bastidores" --minutes 30
//   npm run seed:bubbles -- --clear
import 'dotenv/config'
import { ObjectId } from 'mongodb'
import { db, mongoClient } from '../db.js'
import { ensureAgentLiveStateIndexes, reportAgentState } from '../agentLiveState.js'
import type { AgentBubbleState } from '../agentLiveState.js'

// One state per agent, chosen to show the three reads at once: work in flight (with
// animated dots), stalled on a person (static), and an outcome (tinted, fades).
const SHOWCASE: { state: AgentBubbleState; detail?: Record<string, string> }[] = [
  { state: 'thinking' },
  { state: 'using_tool', detail: { appKey: 'google', actionLabel: 'Criar evento' } },
  { state: 'delegating_sector', detail: { targetType: 'sector' } },
  { state: 'reading_knowledge' },
  { state: 'delivering', detail: { targetType: 'channel' } },
  { state: 'waiting_input' },
  { state: 'researching' },
  { state: 'blocked' },
  { state: 'validating_output' },
  { state: 'retrying' },
  { state: 'responding' },
  { state: 'generating_output' },
]

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  await mongoClient.connect()
  await ensureAgentLiveStateIndexes()

  const floorName = arg('floor')
  const minutes = Number(arg('minutes') ?? 15)
  const clear = process.argv.includes('--clear')

  if (clear) {
    const { deletedCount } = await db.collection('agent_live_states').deleteMany({})
    console.log(`limpou ${deletedCount} estado(s). O mapa volta a ficar sem balão nenhum.`)
    return
  }

  const floors = await db.collection<{ _id: ObjectId; name: string; ownerId: string }>('offices').find({}).toArray()
  const floor = floorName ? floors.find((f) => f.name.toLowerCase() === floorName.toLowerCase()) : floors[0]
  if (!floor) {
    console.error(`andar não encontrado. Disponíveis: ${floors.map((f) => f.name).join(', ')}`)
    process.exitCode = 1
    return
  }

  const agents = await db
    .collection<{ _id: ObjectId; name: string; ownerId: string }>('agents')
    .find({ officeId: floor._id })
    .toArray()
  if (agents.length === 0) {
    console.error(`o andar "${floor.name}" não tem agentes.`)
    process.exitCode = 1
    return
  }

  // A long window on purpose: the real TTL for an active state is two minutes, which
  // is right for a live map and too short to sit and look at.
  const expiresAt = new Date(Date.now() + minutes * 60_000)
  for (const [i, agent] of agents.entries()) {
    const pick = SHOWCASE[i % SHOWCASE.length]
    await reportAgentState({
      ownerId: agent.ownerId,
      agentId: agent._id,
      floorId: floor._id,
      // A demo root, so these rows never collide with a real execution's.
      rootExecutionId: `demo:${floor._id.toString()}:${agent._id.toString()}`,
      state: pick.state,
      detail: pick.detail,
    })
    await db
      .collection('agent_live_states')
      .updateOne({ ownerId: agent.ownerId, agentId: agent._id, rootExecutionId: `demo:${floor._id.toString()}:${agent._id.toString()}` }, { $set: { expiresAt } })
    console.log(`  ${agent.name.padEnd(18)} → ${pick.state}`)
  }

  console.log(`\n${agents.length} balão(ões) no andar "${floor.name}", por ${minutes} min.`)
  console.log(`Abra /floors/${floor._id.toString()} com VITE_AI_OFFICE_LIVE_STATUS_ENABLED=true.`)
  console.log('Para apagar antes da hora: npm run seed:bubbles -- --clear')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoClient.close().catch(() => undefined)
  })
