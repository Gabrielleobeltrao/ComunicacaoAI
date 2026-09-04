import { mongoClient } from '../db.js'
import { cleanupMigratedMemories } from '../knowledgeMigration.js'

// A LIMPEZA das memórias já copiadas — explícita, e só com confirmação.
//
// `node dist/scripts/cleanupArchitectMemories.js <tenantId> [--confirm]`.
// Sem `--confirm` ela mostra o que faria e não apaga nada. Com `--confirm`, cada item é
// reconferido por leitura antes de sair: entre a auditoria e a exclusão alguém pode ter
// apagado o documento, e aí a memória original é a única cópia que resta.
const tenantId = process.argv[2]
const confirm = process.argv.includes('--confirm')
if (!tenantId) {
  console.error('uso: cleanupArchitectMemories <tenantId> [--confirm]')
  process.exit(2)
}

await mongoClient.connect()
const r = await cleanupMigratedMemories(tenantId, { confirm })
console.log(
  r.dryRun
    ? `[limpeza] SIMULAÇÃO: ${r.eligible} memória(s) com cópia conferida seriam removidas. Nada foi apagado.`
    : `[limpeza] ${r.deleted} de ${r.eligible} removidas.`,
)
for (const s of r.skipped) console.log(`  mantida ${s.memoryId}: ${s.reason}`)
await mongoClient.close()
