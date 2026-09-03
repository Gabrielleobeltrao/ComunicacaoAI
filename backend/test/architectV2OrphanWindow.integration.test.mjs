// A JANELA ENTRE CRIAR E REGISTRAR — e o recurso que fica órfão nela.
//
// A saga cria o recurso pelo serviço canônico e SÓ DEPOIS grava o passo com o id. Entre as
// duas escritas há um instante em que o recurso existe e a operação não sabe. Uma queda ali
// deixa o Database de pé e o `resourceMap` sem ele: a retomada cria o segundo.
//
// No V1 isso é fechado pela MARCA DE ORIGEM — a retomada procura por `architect.operationId`
// + `blueprintKey` antes de criar, e encontra. Os recursos do V2 não tinham marca.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { applyV2Resources } = await import('../dist/architect/applyV2.js')
const t2 = await import('../dist/architect/typesV2.js')

const DONO = 'dono-janela'
let predio
let andar
let agente

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['buildings', 'offices', 'agents', 'data_stores', 'dataset_definitions', 'monitoring_sources', 'monitors', 'automations'])
    await db.collection(c).deleteMany({})
  predio = new ObjectId()
  andar = new ObjectId()
  agente = new ObjectId()
  await db.collection('buildings').insertOne({ _id: predio, ownerId: DONO, name: 'P', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: andar, ownerId: DONO, buildingId: predio, name: 'Operação', status: 'active', workMode: 'organization', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('agents').insertOne({ _id: agente, ownerId: DONO, officeId: andar, name: 'Marina', role: 'Avisa', provider: 'anthropic', createdAt: new Date() })
})

const item = (over) => ({ action: 'create', layer: 'essential', rationale: 'x', dependsOn: [], ...over })

const planoComRecursos = () => {
  const bp = t2.emptyBlueprintV2('T', 'O', 'create')
  bp.resources.databases = [item({ key: 'base', name: 'Cotações', owner: { ownerType: 'account' }, adapterKind: 'data_history' })]
  bp.operations.sources = [
    item({
      key: 'fonte',
      name: 'Cotações CXSE3',
      kind: 'api_polling',
      config: { url: 'https://api.exemplo.test/c', method: 'GET' },
      mapping: { version: 1, fields: [{ to: 'rsi', from: 'rsi', required: true }] },
      cadence: { mode: 'interval', intervalMs: 60_000 },
    }),
  ]
  return bp
}

const aplicar = (bp, operationId, aoCriar) =>
  applyV2Resources({
    ownerId: DONO,
    blueprint: bp,
    resourceMap: new Map([['floor:operacao', andar.toString()], ['agent:marina', agente.toString()]]),
    approvedKeys: new Set(t2.V2_ITEM_PATHS.flatMap((p) => t2.itemsAt(bp, p).map((i) => i.key))),
    operationId,
    ...(aoCriar ? { afterCreate: aoCriar } : {}),
  })

// --- a marca ---------------------------------------------------------------------------------

test('ACEITAÇÃO: o recurso criado leva a MARCA da operação que o criou', async () => {
  const operationId = new ObjectId().toString()
  await aplicar(planoComRecursos(), operationId)

  const base = await db.collection('data_stores').findOne({ ownerId: DONO })
  assert.equal(base.architect?.operationId, operationId, 'sem a marca, a retomada não acha o que ficou de pé')
  assert.equal(base.architect?.blueprintKey, 'base')

  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.equal(fonte.architect?.operationId, operationId)
  assert.equal(fonte.architect?.blueprintKey, 'fonte')
})

test('ACEITAÇÃO: uma queda NA JANELA não duplica — a retomada encontra pela marca', async () => {
  const operationId = new ObjectId().toString()
  const bp = planoComRecursos()

  // A queda acontece DEPOIS de criar e ANTES de o passo ser registrado: é exatamente a
  // janela. A saga não lança — ela registra o passo como falho e para a cadeia — então o
  // `resourceMap` não recebe o id, e o Database fica de pé sem ninguém saber.
  const primeiros = await aplicar(bp, operationId, (kind) => {
    if (kind === 'database') throw new Error('queda simulada na janela')
  })
  const falho = primeiros.find((p) => p.kind === 'database')
  assert.equal(falho.status, 'failed', JSON.stringify(primeiros))
  assert.equal(falho.resourceId ?? null, null, 'o id não chegou ao mapa: é essa a janela')
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: DONO }), 1, 'o recurso ficou de pé')

  // A retomada: mesmo plano, MESMA operação, mapa vazio.
  const passos = await aplicar(bp, operationId)
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: DONO }), 1, 'a retomada criou um segundo Database')
  const passo = passos.find((p) => p.kind === 'database')
  assert.match(passo.message ?? '', /recuperado/, 'a retomada precisa dizer que encontrou, e não que criou')
})

test('AMEAÇA: a marca de OUTRA operação não é reaproveitada', async () => {
  const bp = planoComRecursos()
  await aplicar(bp, new ObjectId().toString())
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: DONO }), 1)

  // Outra aplicação, do mesmo plano: ela NÃO pode adotar o recurso da anterior como seu.
  await aplicar(bp, new ObjectId().toString())
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: DONO }), 2, 'adotar o recurso de outra operação faria o desfazer apagar o que não é dele')
})

test('sem operationId, nada muda: a marca é opcional', async () => {
  const passos = await applyV2Resources({
    ownerId: DONO,
    blueprint: planoComRecursos(),
    resourceMap: new Map([['floor:operacao', andar.toString()]]),
    approvedKeys: new Set(['base', 'fonte']),
  })
  assert.ok(passos.every((p) => p.status === 'created'), JSON.stringify(passos))
  const base = await db.collection('data_stores').findOne({ ownerId: DONO })
  assert.equal(base.architect, undefined, 'quem não passa operationId não ganha marca')
})
