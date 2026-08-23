// O App revogado precisa PARAR de atender — não só sumir do menu.
//
// Desativar o Chat Web tirava a navegação e mais nada: as rotas públicas seguiam de pé, o
// widget instalado no site do cliente continuava montando, e cada mensagem continuava
// chamando o modelo e gastando. "Revogado" era um rótulo na tela do dono enquanto o mundo
// lá fora seguia igual.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { webChatAccessFor, WEB_CHAT_INACTIVE } = await import('../dist/apps/publicChannelAccess.js')
const { mongoClient, db } = await import('../dist/db.js')

const DONO = 'dono-chat-web'

// As instalações moram em `connections` — o nome vem de antes de os Apps existirem.
const instalacao = (status, appKey = 'web_chat') => ({
  ownerId: DONO,
  appKey,
  status,
  name: 'Chat Web',
  createdAt: new Date(),
  updatedAt: new Date(),
})

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

before(async () => {
  await mongoClient.connect()
})

beforeEach(async () => {
  await db.collection('connections').deleteMany({})
})

test('sem instalação nenhuma, a porta pública fica fechada', async () => {
  const r = await webChatAccessFor(DONO)
  assert.equal(r.ok, false)
  assert.equal(r.status, 410)
  assert.equal(r.code, WEB_CHAT_INACTIVE)
})

test('410 e não 404: o widget EXISTIU e pode voltar a existir', async () => {
  // 404 diria que a chave está errada, e mandaria o cliente procurar um erro de
  // digitação que não existe.
  const r = await webChatAccessFor(DONO)
  assert.equal(r.status, 410)
})

test('conectado atende', async () => {
  await db.collection('connections').insertOne(instalacao('connected'))
  assert.equal((await webChatAccessFor(DONO)).ok, true)
})

test('revogado NÃO atende — e reativar devolve o atendimento', async () => {
  const { insertedId } = await db.collection('connections').insertOne(instalacao('revoked'))
  assert.equal((await webChatAccessFor(DONO)).ok, false, 'desligar de propósito precisa desligar de verdade')

  // Os widgets não foram tocados: reativar é só voltar o status.
  await db.collection('connections').updateOne({ _id: insertedId }, { $set: { status: 'connected' } })
  assert.equal((await webChatAccessFor(DONO)).ok, true)
})

test('instalação com ERRO também não atende', async () => {
  await db.collection('connections').insertOne(instalacao('error'))
  assert.equal((await webChatAccessFor(DONO)).ok, false, 'integração quebrada não é integração ativa')
})

test('uma conectada entre várias basta', async () => {
  await db.collection('connections').insertMany([instalacao('revoked'), instalacao('connected')])
  assert.equal((await webChatAccessFor(DONO)).ok, true)
})

test('o App de OUTRO canal não abre esta porta', async () => {
  await db.collection('connections').insertOne(instalacao('connected', 'whatsapp'))
  assert.equal((await webChatAccessFor(DONO)).ok, false)
})

test('a instalação de outro DONO não vale', async () => {
  await db.collection('connections').insertOne({ ...instalacao('connected'), ownerId: 'outra-conta' })
  assert.equal((await webChatAccessFor(DONO)).ok, false)
})

test('a mensagem devolvida não conta nada sobre a conta', async () => {
  const r = await webChatAccessFor(DONO)
  assert.equal(r.error, 'Este chat está indisponível no momento.')
  const texto = JSON.stringify(r)
  for (const vazamento of [DONO, 'revoked', 'installation', 'owner']) {
    assert.ok(!texto.includes(vazamento), `a resposta pública não pode conter "${vazamento}"`)
  }
})

test('conta ANTIGA migrada: a instalação criada pela migração conecta', async () => {
  // A migração cria a instalação para quem já tinha widget. Sem ela, uma conta antiga
  // perderia o chat ao subir esta versão — que é exatamente o que não pode acontecer.
  await db.collection('connections').insertOne({ ...instalacao('connected'), publicMetadata: { migrated: 'true' } })
  assert.equal((await webChatAccessFor(DONO)).ok, true)
})
