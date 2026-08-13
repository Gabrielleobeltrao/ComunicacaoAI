// Dry-run integrity audit for sector ↔ floor ↔ agent relationships (plan §15.2).
// It only READS and reports — it never writes or repairs. Run with:
//   npx tsx src/scripts/auditSectorFloorIntegrity.ts
import { mongoClient, db } from '../db.js'
import type { Sector } from '../sectors.js'

interface AgentDoc {
  _id: import('mongodb').ObjectId
  ownerId: string
  officeId?: import('mongodb').ObjectId
}

async function main() {
  await mongoClient.connect()
  const sectors = await db.collection<Sector>('sectors').find({}).toArray()
  const agents = await db.collection<AgentDoc>('agents').find({}).toArray()
  const agentById = new Map(agents.map((a) => [a._id.toString(), a]))

  const findings: string[] = []
  const add = (s: string) => findings.push(s)

  // Which sectors each agent belongs to (to detect multi-sector membership).
  const sectorsByAgent = new Map<string, string[]>()

  for (const sec of sectors) {
    const sid = sec._id.toString()
    if (!sec.officeId) add(`sector ${sid} (${sec.name}) has no officeId (floor)`)

    const memberIds = new Set<string>()
    let defaults = 0
    for (const m of sec.members ?? []) {
      const aid = m.agentId?.toString()
      if (!aid) {
        add(`sector ${sid} has a member with no agentId`)
        continue
      }
      if (memberIds.has(aid)) add(`sector ${sid} lists agent ${aid} more than once`)
      memberIds.add(aid)
      sectorsByAgent.set(aid, [...(sectorsByAgent.get(aid) ?? []), sid])
      if (m.isDefault) defaults++

      const agent = agentById.get(aid)
      if (!agent) {
        add(`sector ${sid} member agent ${aid} does not exist`)
        continue
      }
      if (agent.ownerId !== sec.ownerId) add(`sector ${sid} member agent ${aid} has a different owner`)
      if (!agent.officeId || (sec.officeId && !agent.officeId.equals(sec.officeId))) {
        add(`sector ${sid} (floor ${sec.officeId?.toString() ?? '—'}) member agent ${aid} is on floor ${agent.officeId?.toString() ?? '—'} (cross-floor)`)
      }
    }

    if ((sec.members?.length ?? 0) > 0 && defaults !== 1) add(`sector ${sid} has ${defaults} default members (expected exactly 1)`)

    // Transitions must target a current member of the same sector.
    for (const m of sec.members ?? []) {
      for (const t of m.transitions ?? []) {
        const target = t.targetAgentId?.toString()
        if (!target || !memberIds.has(target)) add(`sector ${sid} has a transition to non-member ${target ?? '—'}`)
      }
    }
  }

  for (const [aid, secs] of sectorsByAgent) {
    if (secs.length > 1) add(`agent ${aid} belongs to ${secs.length} sectors: ${secs.join(', ')}`)
  }

  console.log(`\nSector/floor integrity audit (DRY-RUN — no changes)`)
  console.log(`  sectors: ${sectors.length} · agents: ${agents.length}`)
  if (findings.length === 0) {
    console.log('  ✓ no integrity issues found')
  } else {
    console.log(`  ⚠ ${findings.length} issue(s):`)
    for (const f of findings) console.log(`   - ${f}`)
  }
  await mongoClient.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
