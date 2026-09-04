// O ÍNDICE DE PRAZO quando o prazo MUDA.
//
// `createIndex` não altera índice existente: ele compara as opções e recusa com
// `IndexOptionsConflict`. Para um índice comum isso não importa — ninguém muda a chave. Para um
// TTL é o contrário: mudar o prazo é justamente o que se faz.
//
// O caso real: a retenção de `token_usage_charges` foi de 30 para 45 dias no código, e o banco
// continuou apagando aos 30 — enquanto o comentário na própria chamada explicava que a janela
// precisa ser maior que um mês, senão uma linha some antes de ser somada no relatório. O erro
// saía como um stack trace gigante a cada arranque, que é o formato que ninguém lê.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { ensureTtlIndex } = await import('../dist/ttlIndex.js')

const COLECAO = 'ttl_de_teste'

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await db.collection(COLECAO).drop().catch(() => undefined)
  await db.createCollection(COLECAO)
})

const prazoDe = async (nome) => {
  const idx = await db.collection(COLECAO).indexes()
  return idx.find((i) => i.name === nome)?.expireAfterSeconds
}

test('cria o índice quando ele ainda não existe', async () => {
  const r = await ensureTtlIndex(db.collection(COLECAO), { createdAt: 1 }, 30 * 24 * 3600)
  assert.equal(r, 'criado')
  assert.equal(await prazoDe('createdAt_1'), 30 * 24 * 3600)
})

test('ACEITAÇÃO: mudar o prazo AJUSTA o índice existente — e o banco passa a respeitá-lo', async () => {
  await ensureTtlIndex(db.collection(COLECAO), { createdAt: 1 }, 30 * 24 * 3600)
  const r = await ensureTtlIndex(db.collection(COLECAO), { createdAt: 1 }, 45 * 24 * 3600)

  assert.equal(r, 'ajustado', 'o segundo arranque precisa APLICAR o prazo novo, não estourar')
  assert.equal(await prazoDe('createdAt_1'), 45 * 24 * 3600, 'o banco continuou com o prazo antigo')
})

test('AMEAÇA: sem o ajuste, o `createIndex` cru recusa — é este o erro que aparecia no arranque', async () => {
  /**
   * O caso que prova que o problema é real, e não uma precaução: a chamada crua reprova.
   */
  await db.collection(COLECAO).createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 })
  await assert.rejects(
    () => db.collection(COLECAO).createIndex({ createdAt: 1 }, { expireAfterSeconds: 45 * 24 * 3600 }),
    (e) => e.code === 85 || /already exists with the same name but different options/.test(String(e.message)),
    'se isto parar de falhar, o helper deixou de ser necessário',
  )
})

test('o mesmo prazo duas vezes não muda nada e não estoura', async () => {
  await ensureTtlIndex(db.collection(COLECAO), { createdAt: 1 }, 90 * 24 * 3600)
  const r = await ensureTtlIndex(db.collection(COLECAO), { createdAt: 1 }, 90 * 24 * 3600)
  assert.equal(r, 'criado', 'opções idênticas: o Mongo aceita e não há o que ajustar')
  assert.equal(await prazoDe('createdAt_1'), 90 * 24 * 3600)
})

test('com NOME próprio, o ajuste encontra o índice pelo nome', async () => {
  await ensureTtlIndex(db.collection(COLECAO), { at: 1 }, 10 * 24 * 3600, 'retencao_do_teste')
  const r = await ensureTtlIndex(db.collection(COLECAO), { at: 1 }, 20 * 24 * 3600, 'retencao_do_teste')
  assert.equal(r, 'ajustado')
  assert.equal(await prazoDe('retencao_do_teste'), 20 * 24 * 3600)
})

test('AMEAÇA: um erro que NÃO é conflito de opções sobe — engoli-lo esconderia outra coisa', async () => {
  // Chave inválida: o Mongo recusa por outro motivo, e o helper não pode transformar isso
  // num "ajustado" silencioso.
  await assert.rejects(() => ensureTtlIndex(db.collection(COLECAO), { '': 1 }, 3600), (e) => e.code !== 85)
})
