import { mongoClient } from '../db.js'
import { auditArchitectMemoryMigration } from '../knowledgeMigration.js'

// A CONFERÊNCIA da mudança de casa — só leitura.
//
// `node dist/scripts/auditArchitectKnowledge.js <tenantId>`. Mostra, para cada memória
// do Arquiteto, onde ela foi parar e se a cópia está lá para ser lida. Não apaga nada e
// não escreve nada: a limpeza é um comando à parte, e ele vai precisar desta lista.
const tenantId = process.argv[2]
if (!tenantId) {
  console.error('uso: auditArchitectKnowledge <tenantId>')
  process.exit(2)
}

await mongoClient.connect()
const r = await auditArchitectMemoryMigration(tenantId)
console.log(`[auditoria] ${r.total} memórias · ${r.confirmed} com cópia conferida · ${r.unmatched} sem correspondência`)
for (const item of r.items) {
  const estado = item.copyConfirmed ? 'copiado' : `PENDENTE (${item.problem})`
  console.log(`  ${item.memoryId} · ${item.scope} · ${item.title} → ${item.documentId ?? '—'} · ${estado}`)
}
console.log(`\n${r.safeToClean} item(ns) teriam a cópia confirmada por leitura. A limpeza continua sendo um comando explícito.`)
await mongoClient.close()
