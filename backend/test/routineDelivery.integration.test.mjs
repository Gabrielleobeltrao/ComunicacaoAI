// INTEGRATION: editing a routine must never lose its destination.
//
// The failure this closes is silent and expensive: the editor could not load the
// connections (still loading, or the request failed), the form defaulted the picker
// to "none", and a perfectly configured e-mail delivery disappeared on an edit that
// was about the wording. So ABSENT and null are different things on the wire:
// absent = keep it, null = the user chose "Nenhum".
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { createRoutine, updateRoutine, readSourceFromDefinition, readSourceInstanceId, publishedSourceFingerprint } = await import(
  '../dist/automations/routine.js'
)

const OWNER = 'routine-owner'
const OTHER = 'other-owner'
const FLOOR = new ObjectId()
const BUILDING = new ObjectId()
const AGENT = new ObjectId()
const CONNECTION = new ObjectId()

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await Promise.all([
    db.collection('automations').deleteMany({}),
    db.collection('automation_versions').deleteMany({}),
    db.collection('agents').deleteMany({}),
    db.collection('offices').deleteMany({}),
    db.collection('buildings').deleteMany({}),
  ])
  await db.collection('buildings').insertOne({ _id: BUILDING, ownerId: OWNER, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: FLOOR, ownerId: OWNER, buildingId: BUILDING, name: 'Térreo', status: 'active', createdAt: new Date() })
  await db.collection('agents').insertOne({ _id: AGENT, ownerId: OWNER, name: 'Ana', objective: 'Atender', officeId: FLOOR, activationModes: [] })
})

const spec = (over = {}) => ({
  name: 'Resumo diário',
  objective: 'Consolidar o dia',
  recurrence: { kind: 'daily', time: '09:00' },
  timezone: 'America/Sao_Paulo',
  delivery: { provider: 'email', connectionId: CONNECTION.toString() },
  ...over,
})

const deliveriesOf = (routine) => routine.draftDefinition.deliveries
const hasDeliveryStep = (routine) => routine.draftDefinition.steps.some((s) => s.type === 'delivery.send')

test('an edit that omits delivery keeps the destination', async () => {
  const created = await createRoutine(OWNER, AGENT, spec())
  assert.equal(deliveriesOf(created).length, 1)

  // Exactly what the form sends when the connections could not be loaded.
  const { delivery, ...withoutDelivery } = spec({ objective: 'Outro objetivo' })
  assert.equal(delivery.connectionId, CONNECTION.toString())
  const updated = await updateRoutine(OWNER, AGENT, created._id, withoutDelivery)

  assert.equal(updated.description, 'Outro objetivo', 'the edit landed')
  assert.equal(deliveriesOf(updated).length, 1, 'and the destination survived it')
  assert.equal(deliveriesOf(updated)[0].connectionId, CONNECTION.toString())
  assert.ok(hasDeliveryStep(updated), 'the delivery step is still in the definition')
})

test('an explicit null is the only thing that removes it', async () => {
  const created = await createRoutine(OWNER, AGENT, spec())
  const updated = await updateRoutine(OWNER, AGENT, created._id, spec({ delivery: null }))
  assert.equal(deliveriesOf(updated).length, 0)
  assert.equal(hasDeliveryStep(updated), false)
})

test('a different destination replaces the old one', async () => {
  const created = await createRoutine(OWNER, AGENT, spec())
  const other = new ObjectId().toString()
  const updated = await updateRoutine(OWNER, AGENT, created._id, spec({ delivery: { provider: 'telegram', connectionId: other } }))
  assert.equal(deliveriesOf(updated).length, 1)
  assert.equal(deliveriesOf(updated)[0].provider, 'telegram')
  assert.equal(deliveriesOf(updated)[0].connectionId, other)
})

test('a routine without a destination does not grow one by omission', async () => {
  const created = await createRoutine(OWNER, AGENT, spec({ delivery: null }))
  const { delivery, ...withoutDelivery } = spec()
  assert.ok(delivery)
  const updated = await updateRoutine(OWNER, AGENT, created._id, withoutDelivery)
  assert.equal(deliveriesOf(updated).length, 0)
})

test('the destination survives repeated edits, and the routine stays published', async () => {
  const created = await createRoutine(OWNER, AGENT, spec())
  const { delivery, ...withoutDelivery } = spec()
  let current = await updateRoutine(OWNER, AGENT, created._id, { ...withoutDelivery, objective: 'A' })
  current = await updateRoutine(OWNER, AGENT, created._id, { ...withoutDelivery, objective: 'B' })
  assert.equal(deliveriesOf(current).length, 1)
  assert.equal(current.publishedTrigger.type, 'schedule', 'what runs is still the published trigger')
  assert.ok(current.lastPublishedVersion >= 2)
})

test('an edit never crosses to another owner or another agent', async () => {
  const created = await createRoutine(OWNER, AGENT, spec())
  const { delivery, ...withoutDelivery } = spec()
  assert.equal(await updateRoutine(OTHER, AGENT, created._id, withoutDelivery), null)
  assert.equal(await updateRoutine(OWNER, new ObjectId(), created._id, withoutDelivery), null)
  // And the routine is untouched by either attempt.
  const stored = await db.collection('automations').findOne({ _id: created._id })
  assert.equal(stored.draftDefinition.deliveries.length, 1)
})

// --- a fonte segue a mesma regra do destino ---------------------------------------------
//
// Mesmo bug, outro campo: um formulário salvo antes de a fonte carregar não pode
// desligar o monitoramento — e, pior, não pode ser RECUSADO por causa disso.

const RSS = { kind: 'rss', url: 'https://exemplo.test/feed.xml', initialWindow: '24h' }
const monitor = (over = {}) => spec({ recurrence: { kind: 'minutes', every: 15 }, source: RSS, ...over })

test('um PATCH sem `source` preserva o monitoramento E a frequência curta', async () => {
  // O caso concreto: rotina que verifica de 15 em 15 minutos, o cliente manda um
  // PATCH só com o objetivo. Julgar a frequência pelo corpo da requisição leria
  // "fonte ausente = rotina fixa" e devolveria 400 numa rotina perfeitamente válida.
  const criada = await createRoutine(OWNER, AGENT, monitor())
  assert.equal(readSourceFromDefinition(criada.draftDefinition).kind, 'rss')

  const { source, ...semFonte } = monitor({ objective: 'Outro objetivo' })
  assert.equal(source.kind, 'rss')
  const atualizada = await updateRoutine(OWNER, AGENT, criada._id, semFonte)

  assert.equal(atualizada.description, 'Outro objetivo', 'a edição foi aplicada')
  assert.deepEqual(readSourceFromDefinition(atualizada.draftDefinition), RSS, 'o monitoramento sobreviveu')
})

test('rotina de entrada fixa continua recusando frequência curta', async () => {
  await assert.rejects(
    () => createRoutine(OWNER, AGENT, spec({ recurrence: { kind: 'minutes', every: 5 } })),
    /monitoram uma fonte/,
  )
})

test('desligar o monitoramento por um PATCH explícito continua funcionando', async () => {
  const criada = await createRoutine(OWNER, AGENT, monitor())
  const desligada = await updateRoutine(OWNER, AGENT, criada._id, spec({ source: { kind: 'fixed' } }))
  assert.equal(readSourceFromDefinition(desligada.draftDefinition).kind, 'fixed')
  assert.equal(readSourceInstanceId(desligada.draftDefinition), null)
})

test('mudar só o foco preserva a vez do monitoramento — nada recomeça', async () => {
  const criada = await createRoutine(OWNER, AGENT, monitor())
  const geracao = readSourceInstanceId(criada.draftDefinition)
  assert.ok(geracao, 'uma rotina nova que monitora começa a primeira vez')

  const comFoco = await updateRoutine(OWNER, AGENT, criada._id, monitor({ source: { ...RSS, focus: 'só preços' } }))
  assert.equal(readSourceInstanceId(comFoco.draftDefinition), geracao)
  // E a identidade do checkpoint não muda, que é o que de fato importa.
  assert.equal(publishedSourceFingerprint(comFoco.draftDefinition), publishedSourceFingerprint(criada.draftDefinition))
})

test('desligar e religar na MESMA URL começa uma vez nova', async () => {
  // No meio do desligamento o feed andou. Quem religa quer saber o que há AGORA —
  // nem receber de uma vez tudo que passou, nem ficar em silêncio porque aquilo
  // "já foi visto" numa vez anterior.
  const criada = await createRoutine(OWNER, AGENT, monitor())
  const antes = publishedSourceFingerprint(criada.draftDefinition)

  await updateRoutine(OWNER, AGENT, criada._id, spec({ source: { kind: 'fixed' } }))
  const religada = await updateRoutine(OWNER, AGENT, criada._id, monitor())

  assert.deepEqual(readSourceFromDefinition(religada.draftDefinition), RSS, 'mesma URL, mesmo tipo')
  assert.notEqual(publishedSourceFingerprint(religada.draftDefinition), antes, 'e mesmo assim, outro checkpoint')
})

test('trocar a URL também começa uma vez nova', async () => {
  const criada = await createRoutine(OWNER, AGENT, monitor())
  const antes = publishedSourceFingerprint(criada.draftDefinition)
  const outra = await updateRoutine(OWNER, AGENT, criada._id, monitor({ source: { ...RSS, url: 'https://exemplo.test/outro.xml' } }))
  assert.notEqual(publishedSourceFingerprint(outra.draftDefinition), antes)
})
