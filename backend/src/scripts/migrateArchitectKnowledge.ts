import { mongoClient } from '../db.js'
import { ensureKnowledgeIndexes } from '../knowledge.js'
import { ensureKnowledgeMigrationIndexes, migrateArchitectKnowledge } from '../knowledgeMigration.js'

// A migração, rodada À MÃO — nunca no boot.
//
// `node dist/scripts/migrateArchitectKnowledge.js [tenantId]`. Sem argumento, roda para
// a instalação inteira. É idempotente: rodar de novo depois de uma falha continua de
// onde parou, e rodar depois de tudo pronto não faz nada.
const tenantId = process.argv[2]

await mongoClient.connect()
await ensureKnowledgeIndexes()
await ensureKnowledgeMigrationIndexes()
const r = await migrateArchitectKnowledge(tenantId ? { tenantId } : {})
console.log(`[migração] ${r.scanned} registros · ${r.migrated} copiados · ${r.skipped} já feitos · ${r.failed} falharam`)
for (const e of r.errors) console.error(`  ${e.memoryId}: ${e.error}`)
// A memória original CONTINUA lá: a remoção é uma decisão separada, com a cópia já conferida.
await mongoClient.close()
process.exit(r.failed > 0 ? 1 : 0)
