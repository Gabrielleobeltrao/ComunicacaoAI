// INTEGRATION: a memória determinística contra um mongod REAL.
//
// As promessas que este arquivo protege são as três que um recebedor de eventos
// precisa cumprir e que só o banco pode garantir: o mesmo evento reenviado não vira
// dois registros, o que tem prazo some sozinho, e a memória de uma conta não aparece
// na consulta de outra.
//
// Nada aqui chama modelo. Se um dia chamar, o custo do recurso muda de zero para
// "por evento" sem ninguém perceber.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const {
  clearMemories,
  deleteMemory,
  ensureMemoryIndexes,
  MAX_PAYLOAD_BYTES,
  MemoryError,
  sanitizePayload,
  scopeKeyOf,
  searchMemory,
  summarizeMemories,
  writeMemory,
} = await import('../dist/memory/records.js')

const TENANT = 'conta-a'
const OUTRA = 'conta-b'
const AGENTE = new ObjectId()
const SETOR = new ObjectId()
const ANDAR = new ObjectId()

const noAgente = { scope: 'agent', agentId: AGENTE }
const noSetor = { scope: 'sector', sectorId: SETOR }
const CHAVE_AGENTE = scopeKeyOf(noAgente)
const CHAVE_SETOR = scopeKeyOf(noSetor)

before(async () => {
  await mongoClient.connect()
  await ensureMemoryIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  await db.collection('memories').deleteMany({})
})

const gravar = (over = {}) =>
  writeMemory({ tenantId: TENANT, target: noAgente, key: 'pedido', payload: { total: 10 }, sourceType: 'webhook', ...over })

// --- estratégias ------------------------------------------------------------------------

test('append guarda histórico: o pedido de ontem não some quando chega o de hoje', async () => {
  await gravar({ payload: { total: 10 } })
  await gravar({ payload: { total: 20 } })
  const { items, total } = await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE] })
  assert.equal(total, 2)
  assert.deepEqual(
    items.map((i) => i.payload.total).sort((a, b) => a - b),
    [10, 20],
  )
})

test('upsert mistura: o evento que traz só o telefone não apaga o e-mail', async () => {
  await gravar({ strategy: 'upsert', key: 'cliente', payload: { email: 'a@b.c' } })
  await gravar({ strategy: 'upsert', key: 'cliente', payload: { telefone: '9999' } })
  const { items, total } = await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE], key: 'cliente' })
  assert.equal(total, 1, 'upsert mantém UM registro por chave')
  assert.deepEqual(items[0].payload, { email: 'a@b.c', telefone: '9999' })
})

test('replace troca: um estado atual não é a soma dos estados passados', async () => {
  await gravar({ strategy: 'replace', key: 'status', payload: { estado: 'pago', nota: 'x' } })
  await gravar({ strategy: 'replace', key: 'status', payload: { estado: 'enviado' } })
  const { items, total } = await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE], key: 'status' })
  assert.equal(total, 1)
  assert.deepEqual(items[0].payload, { estado: 'enviado' }, 'a nota antiga não sobrevive a um replace')
})

test('o desfecho da gravação é dito, não deduzido', async () => {
  assert.equal((await gravar({ strategy: 'upsert', key: 'k' })).outcome, 'created')
  assert.equal((await gravar({ strategy: 'upsert', key: 'k' })).outcome, 'updated')
})

// --- deduplicação e retry ------------------------------------------------------------------

test('o mesmo evento reenviado não vira dois registros', async () => {
  // O caso real: o remetente não recebeu o 200 a tempo e mandou de novo. O evento é
  // o mesmo, e guardar duas vezes é um pedido duplicado no relatório de amanhã.
  const um = await gravar({ dedupeKey: 'evt-1' })
  const dois = await gravar({ dedupeKey: 'evt-1' })
  assert.equal(um.outcome, 'created')
  assert.equal(dois.outcome, 'duplicate', 'reenvio é sucesso: o evento JÁ está guardado')
  assert.equal(dois.recordId, um.recordId, 'e aponta para o registro que já existia')
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE] })).total, 1)
})

test('dois reenvios simultâneos também não duplicam', async () => {
  // Sem o índice único, uma consulta "já existe?" antes de inserir deixaria os dois
  // passarem: entre a pergunta e a resposta cabe a outra tentativa.
  const [a, b] = await Promise.all([gravar({ dedupeKey: 'evt-2' }), gravar({ dedupeKey: 'evt-2' })])
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE] })).total, 1)
  assert.equal([a.outcome, b.outcome].filter((o) => o === 'created').length, 1)
})

test('sem marca de deduplicação, nada é barrado', async () => {
  // Quem não soube dizer o que torna o evento único não pode ter o segundo evento
  // legítimo recusado como se fosse repetido.
  await gravar({ dedupeKey: null })
  await gravar({ dedupeKey: null })
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE] })).total, 2)
})

test('a mesma marca em alvos diferentes são coisas diferentes', async () => {
  await gravar({ dedupeKey: 'evt-3' })
  await gravar({ target: noSetor, dedupeKey: 'evt-3' })
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE, CHAVE_SETOR] })).total, 2)
})

// --- isolamento -------------------------------------------------------------------------

test('memória de uma conta não aparece na consulta de outra', async () => {
  await gravar()
  const deOutra = await searchMemory({ tenantId: OUTRA, scopeKeys: [CHAVE_AGENTE] })
  assert.equal(deOutra.total, 0, 'mesmo sabendo o alvo exato')
})

test('a mesma marca em contas diferentes não colide', async () => {
  await gravar({ dedupeKey: 'evt-4' })
  const outra = await writeMemory({ tenantId: OUTRA, target: noAgente, key: 'pedido', payload: {}, dedupeKey: 'evt-4' })
  assert.equal(outra.outcome, 'created', 'a trava é por conta, não global')
})

test('apagar exige que o alvo esteja entre os permitidos', async () => {
  const { recordId } = await gravar()
  const id = new ObjectId(recordId)
  assert.equal(await deleteMemory(TENANT, id, [CHAVE_SETOR]), false, 'alvo fora da lista não apaga')
  assert.equal(await deleteMemory(OUTRA, id, [CHAVE_AGENTE]), false, 'outra conta não apaga')
  assert.equal(await deleteMemory(TENANT, id, [CHAVE_AGENTE]), true)
})

// --- busca ------------------------------------------------------------------------------

test('a busca textual acha pela chave e pelo conteúdo, sem IA', async () => {
  await gravar({ key: 'pedido-1', payload: { cliente: 'Fulano da Silva', total: 10 } })
  await gravar({ key: 'pedido-2', payload: { cliente: 'Beltrana', total: 20 } })

  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE], query: 'Fulano' })).total, 1)
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE], query: 'pedido-2' })).total, 1)
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE], query: 'ninguém' })).total, 0)
})

test('o que o usuário digita não vira expressão regular solta', async () => {
  // Sem escapar, um `(` derruba a consulta e um `.*` vira varredura completa.
  await gravar({ payload: { texto: 'a(b)c' } })
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE], query: 'a(b)c' })).total, 1)
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE], query: '.*' })).total, 0)
})

test('sem alvo permitido, a busca não devolve nada — e não consulta tudo', async () => {
  await gravar()
  assert.deepEqual(await searchMemory({ tenantId: TENANT, scopeKeys: [] }), { items: [], total: 0 })
})

test('a paginação tem teto e devolve o total de verdade', async () => {
  for (let i = 0; i < 5; i++) await gravar({ key: `k${i}` })
  const pagina = await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE], limit: 2, skip: 0 })
  assert.equal(pagina.items.length, 2)
  assert.equal(pagina.total, 5, 'o total é o do filtro, não o da página')
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE], limit: 9999 })).items.length, 5)
})

test('dá para filtrar por origem e por data', async () => {
  await gravar({ sourceType: 'webhook' })
  await gravar({ sourceType: 'rss' })
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE], sourceType: 'rss' })).total, 1)
  const futuro = new Date(Date.now() + 60_000)
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE], since: futuro })).total, 0)
})

test('o resumo por alvo conta sem baixar tudo', async () => {
  await gravar()
  await gravar()
  await gravar({ target: noSetor })
  const resumo = await summarizeMemories(TENANT, [CHAVE_AGENTE, CHAVE_SETOR])
  assert.equal(resumo[CHAVE_AGENTE].count, 2)
  assert.equal(resumo[CHAVE_SETOR].count, 1)
  assert.ok(resumo[CHAVE_AGENTE].lastAt instanceof Date)
})

// --- limites e sanitização -----------------------------------------------------------------

test('payload grande demais é recusado, não truncado em silêncio', async () => {
  // Um webhook público recebe o que mandarem. Truncar guardaria um registro que
  // parece completo e não é.
  const enorme = { texto: 'x'.repeat(MAX_PAYLOAD_BYTES + 100) }
  await assert.rejects(() => gravar({ payload: enorme }), MemoryError)
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE] })).total, 0)
})

test('chave vazia é recusada', async () => {
  await assert.rejects(() => gravar({ key: '   ' }), MemoryError)
})

test('chave de payload com sintaxe de operador é neutralizada, não guardada crua', async () => {
  // Guardar `$set` ou `a.b` cru é deixar o conteúdo do payload falar com o banco.
  const limpo = sanitizePayload({ $set: 1, 'a.b': 2, ok: { $inc: 3 } })
  assert.deepEqual(limpo, { _$set: 1, a_b: 2, ok: { _$inc: 3 } })
  // E o dado continua legível: os caracteres foram trocados, não removidos.
  await gravar({ payload: { $where: 'malicioso' } })
  const { items } = await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE] })
  assert.deepEqual(items[0].payload, { _$where: 'malicioso' })
})

test('conteúdo que não é JSON não entra', async () => {
  const ciclo = {}
  ciclo.eu = ciclo
  await assert.rejects(() => gravar({ payload: ciclo }), MemoryError)
})

// --- prazo de validade ----------------------------------------------------------------------

test('o TTL vira uma data de expiração no registro', async () => {
  // O apagar de verdade é do Mongo, num índice TTL — testar o relógio dele seria
  // testar o Mongo. O que é nosso é gravar a data certa.
  const { recordId } = await gravar({ ttlSeconds: 3600 })
  const doc = await db.collection('memories').findOne({ _id: new ObjectId(recordId) })
  assert.ok(doc.expiresAt instanceof Date)
  const daquiUmaHora = Date.now() + 3600_000
  assert.ok(Math.abs(doc.expiresAt.getTime() - daquiUmaHora) < 5000)
})

test('sem TTL, o registro não expira', async () => {
  const { recordId } = await gravar()
  const doc = await db.collection('memories').findOne({ _id: new ObjectId(recordId) })
  assert.equal(doc.expiresAt, null)
})

// --- limpeza ---------------------------------------------------------------------------------

test('limpar um alvo devolve quantos saíram, e não toca nos outros', async () => {
  await gravar({ key: 'a' })
  await gravar({ key: 'b' })
  await gravar({ target: noSetor, key: 'a' })

  assert.equal(await clearMemories(TENANT, CHAVE_AGENTE, 'a'), 1, 'dá para limpar só uma chave')
  assert.equal(await clearMemories(TENANT, CHAVE_AGENTE), 1, 'ou o alvo inteiro')
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_SETOR] })).total, 1, 'o setor ficou intacto')
})

test('limpar não atravessa contas', async () => {
  await gravar()
  assert.equal(await clearMemories(OUTRA, CHAVE_AGENTE), 0)
  assert.equal((await searchMemory({ tenantId: TENANT, scopeKeys: [CHAVE_AGENTE] })).total, 1)
})

// --- escopo malformado -------------------------------------------------------------------------

test('escopo sem o id correspondente é erro de programação, e falha alto', async () => {
  assert.throws(() => scopeKeyOf({ scope: 'sector' }), MemoryError)
  assert.equal(scopeKeyOf({ scope: 'floor', floorId: ANDAR }), `floor:${ANDAR.toString()}`)
})
