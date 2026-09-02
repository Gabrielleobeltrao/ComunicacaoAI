// A MUDANÇA DE CASA do conhecimento de andar e prédio.
//
// Uma migração é escrita em massa sobre dados que já existem: ela erra em silêncio e o
// prejuízo aparece semanas depois. Os três testes que importam são os que exercitam o
// que dá errado — rodar duas vezes, cair no meio, e a fonte original continuar de pé.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.VOYAGE_API_KEY = ''

const { mongoClient, db } = await import('../dist/db.js')
const { ensureKnowledgeIndexes } = await import('../dist/knowledge.js')
const { migrateArchitectKnowledge, ensureKnowledgeMigrationIndexes, sourceRefFor, listMigrationRecords, auditArchitectMemoryMigration } = await import('../dist/knowledgeMigration.js')
const { createFloor } = await import('../dist/floors.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')
const { writeMemory } = await import('../dist/memory/records.js')

const DONO = 'dono-migracao'
const VIZINHO = 'vizinho-migracao'

before(async () => {
  await mongoClient.connect()
  await ensureKnowledgeIndexes()
  await ensureKnowledgeMigrationIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  for (const c of ['knowledge_documents', 'knowledge_chunks', 'knowledge_migrations', 'memories', 'offices', 'buildings']) {
    await db.collection(c).deleteMany({})
  }
})

/** O que o Arquiteto gravava antes: um registro de memória com título e conteúdo. */
const memoriaDoArquiteto = (tenantId, target, titulo, conteudo) =>
  writeMemory({
    tenantId,
    target,
    key: `arquiteto:${titulo.toLowerCase()}`,
    payload: { titulo, conteudo },
    strategy: 'upsert',
    sourceType: 'architect',
    metadata: { title: titulo },
  })

async function cenario(conta = DONO) {
  const andar = await createFloor(conta, { name: 'Atendimento' })
  const predio = await ensureDefaultBuilding(conta)
  await memoriaDoArquiteto(conta, { scope: 'floor', floorId: andar._id }, 'Horários', 'Aberto das 11h às 23h')
  await memoriaDoArquiteto(conta, { scope: 'building', buildingId: predio._id }, 'Quem somos', 'Uma pizzaria de bairro')
  return { andar, predio }
}

test('copia o conhecimento de andar e de prédio para a base canônica', async () => {
  const { andar, predio } = await cenario()
  const r = await migrateArchitectKnowledge({ tenantId: DONO })

  assert.equal(r.scanned, 2)
  assert.equal(r.migrated, 2)
  assert.equal(r.failed, 0)

  const docs = await db.collection('knowledge_documents').find({}).sort({ title: 1 }).toArray()
  assert.equal(docs.length, 2)
  assert.deepEqual(docs.map((d) => d.ownerType).sort(), ['building', 'floor'])
  const doAndar = docs.find((d) => d.ownerType === 'floor')
  assert.ok(doAndar.ownerId.equals(andar._id), 'no andar real')
  assert.equal(doAndar.title, 'Horários')
  assert.match(doAndar.content, /11h às 23h/)
  const doPredio = docs.find((d) => d.ownerType === 'building')
  assert.ok(doPredio.ownerId.equals(predio._id))
})

test('rodar de novo NÃO duplica — e não custa uma segunda rodada de embeddings', async () => {
  await cenario()
  await migrateArchitectKnowledge({ tenantId: DONO })
  const segunda = await migrateArchitectKnowledge({ tenantId: DONO })

  assert.equal(segunda.migrated, 0)
  assert.equal(segunda.skipped, 2, 'o que já foi resolvido sai sem tocar em nada')
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 2, 'duas cópias do cardápio é o defeito que isto existe para não ter')
})

test('a memória original CONTINUA lá — copiar e apagar na mesma passada é apostar na cópia', async () => {
  await cenario()
  await migrateArchitectKnowledge({ tenantId: DONO })
  const memorias = await db.collection('memories').find({ tenantId: DONO }).toArray()
  assert.equal(memorias.length, 2, 'a remoção do original é decisão de outro bloco, com a cópia já conferida')
  assert.match(JSON.stringify(memorias[0].payload), /11h às 23h|pizzaria/)
})

test('falha parcial é registrada e RETOMÁVEL: a rodada seguinte continua de onde parou', async () => {
  const { andar } = await cenario()
  // Um registro apontando para um andar que não existe mais: ele não pode virar um
  // documento pendurado em ninguém, e não pode derrubar a migração inteira.
  await memoriaDoArquiteto(DONO, { scope: 'floor', floorId: new ObjectId() }, 'Órfão', 'texto sem dono')

  const primeira = await migrateArchitectKnowledge({ tenantId: DONO })
  assert.equal(primeira.migrated, 2)
  assert.equal(primeira.failed, 1)
  assert.match(primeira.errors[0].error, /dono/)
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 2, 'o que falhou não gravou nada')

  // A falha fica registrada, com o motivo.
  const registros = await listMigrationRecords(DONO)
  const falhou = registros.find((x) => x.status === 'failed')
  assert.ok(falhou)
  assert.ok(falhou.error)

  // Corrigido o que faltava, a rodada seguinte resolve SÓ o que ficou pendente.
  const orfa = await db.collection('memories').findOne({ tenantId: DONO, key: 'arquiteto:órfão' })
  await db.collection('memories').updateOne({ _id: orfa._id }, { $set: { floorId: andar._id } })

  const segunda = await migrateArchitectKnowledge({ tenantId: DONO })
  assert.equal(segunda.skipped, 2, 'o que já estava pronto não é refeito')
  assert.equal(segunda.migrated, 1)
  assert.equal(segunda.failed, 0)
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 3)
})

test('uma queda ENTRE gravar e marcar não produz a segunda cópia', async () => {
  // O caso mais difícil: o documento entrou, o processo morreu antes de registrar. A
  // rodada seguinte precisa reconhecer a cópia pela marca estável em vez de criar outra.
  const { andar } = await cenario()
  const memoria = await db.collection('memories').findOne({ tenantId: DONO, floorId: andar._id })

  await migrateArchitectKnowledge({ tenantId: DONO })
  // Apaga só o REGISTRO da migração, simulando a queda depois da escrita.
  await db.collection('knowledge_migrations').deleteOne({ _id: memoria._id })

  const depois = await migrateArchitectKnowledge({ tenantId: DONO })
  assert.equal(depois.failed, 0)
  assert.equal(await db.collection('knowledge_documents').countDocuments({ ownerType: 'floor' }), 1, 'a marca estável é o que impede a segunda cópia')
  const doc = await db.collection('knowledge_documents').findOne({ ownerType: 'floor' })
  assert.equal(doc.sourceRef, sourceRefFor(memoria._id))
})

test('não atravessa contas: o registro de outra conta não é migrado por aqui', async () => {
  await cenario(DONO)
  await cenario(VIZINHO)
  const r = await migrateArchitectKnowledge({ tenantId: DONO })
  assert.equal(r.scanned, 2)
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 2)
  // E o do vizinho continua esperando a vez dele.
  assert.equal((await listMigrationRecords(VIZINHO)).length, 0)
})

test('memória que NÃO é do Arquiteto não é tocada', async () => {
  const andar = await createFloor(DONO, { name: 'Atendimento' })
  await writeMemory({
    tenantId: DONO,
    target: { scope: 'floor', floorId: andar._id },
    key: 'cotacao',
    payload: { valor: 42 },
    sourceType: 'webhook',
  })
  const r = await migrateArchitectKnowledge({ tenantId: DONO })
  assert.equal(r.scanned, 0, 'fato de execução não é conhecimento curado')
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0)
})

test('registro sem conteúdo falha com motivo — e não vira documento vazio', async () => {
  const andar = await createFloor(DONO, { name: 'Atendimento' })
  await writeMemory({
    tenantId: DONO,
    target: { scope: 'floor', floorId: andar._id },
    key: 'arquiteto:vazio',
    payload: { titulo: 'Sem texto' },
    sourceType: 'architect',
  })
  const r = await migrateArchitectKnowledge({ tenantId: DONO })
  assert.equal(r.failed, 1)
  assert.match(r.errors[0].error, /conteúdo/)
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0)
})

// --- a auditoria (que não apaga nada) --------------------------------------------------

test('a auditoria confere a cópia por LEITURA, e não pelo registro da migração', async () => {
  await cenario()
  await migrateArchitectKnowledge({ tenantId: DONO })

  const antes = await auditArchitectMemoryMigration(DONO)
  assert.equal(antes.total, 2)
  assert.equal(antes.confirmed, 2)
  assert.equal(antes.safeToClean, 2)
  for (const item of antes.items) {
    assert.ok(item.documentId)
    assert.equal(item.problem, null)
  }

  // Alguém apagou o documento depois de migrado: o registro continua dizendo "feito", e
  // a memória original passa a ser a única cópia que resta. A auditoria precisa ver isso.
  await db.collection('knowledge_documents').deleteOne({ ownerType: 'floor' })
  const depois = await auditArchitectMemoryMigration(DONO)
  assert.equal(depois.confirmed, 1)
  assert.equal(depois.unmatched, 1)
  assert.equal(depois.safeToClean, 1, 'o que perdeu a cópia não pode ser marcado como seguro para limpar')
  assert.match(depois.items.find((i) => !i.copyConfirmed).problem, /não está mais na base/)
})

test('cópia com texto diferente do original NÃO conta como copiada', async () => {
  const { andar } = await cenario()
  await migrateArchitectKnowledge({ tenantId: DONO })
  await db.collection('knowledge_documents').updateOne({ ownerType: 'floor' }, { $set: { content: 'outra coisa' } })

  const r = await auditArchitectMemoryMigration(DONO)
  const item = r.items.find((i) => i.scope === 'floor')
  assert.equal(item.copyConfirmed, false)
  assert.equal(item.safeToClean, false)
  assert.match(item.problem, /não confere/)
  assert.ok(andar)
})

test('a auditoria NÃO apaga nada — nem memória, nem documento', async () => {
  await cenario()
  await migrateArchitectKnowledge({ tenantId: DONO })
  const memoriasAntes = await db.collection('memories').countDocuments({ tenantId: DONO })
  const docsAntes = await db.collection('knowledge_documents').countDocuments({})

  await auditArchitectMemoryMigration(DONO)
  await auditArchitectMemoryMigration(DONO)

  assert.equal(await db.collection('memories').countDocuments({ tenantId: DONO }), memoriasAntes)
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), docsAntes)
})

test('item ainda não migrado aparece como pendente, sem documento', async () => {
  await cenario()
  const r = await auditArchitectMemoryMigration(DONO)
  assert.equal(r.confirmed, 0)
  assert.equal(r.safeToClean, 0)
  assert.deepEqual(r.items.map((i) => i.problem).sort(), ['ainda não copiado', 'ainda não copiado'])
})
