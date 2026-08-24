// Rodar duas vezes tem que dar no mesmo.
//
// Índice e migração rodam no arranque de TODA instância. Num deploy com mais de uma, elas
// rodam concorrentes; num rollback, rodam de novo sobre dados que já passaram por elas. Se
// a segunda execução não for igual à primeira, o defeito aparece exatamente no pior
// momento — durante um deploy, com o serviço subindo — e sempre em produção, porque em
// desenvolvimento ninguém sobe o processo duas vezes contra o mesmo banco.
//
// Estas provas rodam tudo duas vezes contra um mongod de verdade e conferem que a segunda
// não muda nada e não levanta erro.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()

const { ensureAgentEventIndexes, recordAgentEvent } = await import('../dist/agentEvents.js')
const { ensureDelegationIndexes } = await import('../dist/delegationLog.js')
const { ensureExecutionRootIndexes } = await import('../dist/executionRoots.js')
const { ensureSectorExecutionIndexes } = await import('../dist/sectorExecutions.js')
const { ensureToolIndexes } = await import('../dist/tools.js')
const { ensureAuditIndexes } = await import('../dist/audit.js')
const { runMigrations } = await import('../dist/migrate.js')
const { db, mongoClient } = await import('../dist/db.js')
const { ObjectId } = await import('mongodb')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const CRIADORES = [
  ['agent_execution_events', ensureAgentEventIndexes],
  ['agent_delegations', ensureDelegationIndexes],
  ['execution_roots', ensureExecutionRootIndexes],
  ['sector_executions', ensureSectorExecutionIndexes],
  ['tools', ensureToolIndexes],
  ['audit_events', ensureAuditIndexes],
]

const assinatura = async (colecao) =>
  (await db.collection(colecao).indexes())
    .map((i) => `${i.name}:${JSON.stringify(i.key)}:${i.unique ? 'u' : ''}`)
    .sort()
    .join('|')

test('criar os índices duas vezes produz exatamente os mesmos índices', async () => {
  for (const [colecao, criar] of CRIADORES) {
    await criar()
    const primeira = await assinatura(colecao)
    // A segunda chamada é o deploy seguinte, ou a segunda instância subindo junto.
    await criar()
    const segunda = await assinatura(colecao)
    assert.equal(segunda, primeira, `${colecao} mudou na segunda chamada`)
    assert.ok(primeira.length > 0, `${colecao} não criou índice nenhum`)
  }
})

test('as migrações rodam duas vezes sem erro e sem mudar nada na segunda', async () => {
  const dono = 'owner-migracao'
  // Um documento no formato ANTIGO: é sobre ele que a migração age.
  await db.collection('agents').insertOne({ _id: new ObjectId(), ownerId: dono, name: 'Legado', provider: 'anthropic' })
  await db.collection('widgets').insertOne({ _id: new ObjectId(), ownerId: dono, teamId: new ObjectId(), name: 'W' })

  await runMigrations()
  const depoisDaPrimeira = JSON.stringify(await db.collection('agents').find({ ownerId: dono }).sort({ _id: 1 }).toArray())
  const widgetsDepois = JSON.stringify(await db.collection('widgets').find({ ownerId: dono }).sort({ _id: 1 }).toArray())

  await runMigrations()
  assert.equal(JSON.stringify(await db.collection('agents').find({ ownerId: dono }).sort({ _id: 1 }).toArray()), depoisDaPrimeira)
  assert.equal(JSON.stringify(await db.collection('widgets').find({ ownerId: dono }).sort({ _id: 1 }).toArray()), widgetsDepois)
  // E a migração fez o que prometia: o campo antigo virou o novo.
  const widget = await db.collection('widgets').findOne({ ownerId: dono })
  assert.equal(widget.teamId, undefined)
  assert.ok(widget.sectorId)
})

test('o registro de execução continua contando UMA vez a mesma etapa', async () => {
  // O índice único em `eventKey` é o que impede uma rotina reexecutada de contar duas.
  // Ele é criado por `ensureAgentEventIndexes`, e é a razão de ela precisar ser idempotente.
  await ensureAgentEventIndexes()
  const chave = `run:${new ObjectId().toString()}:t1:a1`
  const base = {
    eventKey: chave,
    ownerId: 'owner-idem',
    agentId: new ObjectId(),
    source: 'sector',
    status: 'succeeded',
    startedAt: new Date(0),
    finishedAt: new Date(1000),
    metadata: { executorKind: 'function', stepId: 't1' },
  }
  assert.equal(await recordAgentEvent(base), true, 'a primeira gravação cria')
  assert.equal(await recordAgentEvent(base), false, 'a segunda não pode criar outra linha')
  assert.equal(await db.collection('agent_execution_events').countDocuments({ eventKey: chave }), 1)
})

test('a ficha da etapa cabe no registro de execução — só escalares', async () => {
  // `metadata` guarda escalares seguros de propósito. Um objeto aninhado aqui viraria um
  // documento que cresce sem limite e um índice que ninguém consegue prever.
  await ensureAgentEventIndexes()
  const chave = `run:${new ObjectId().toString()}:t2:a2`
  await recordAgentEvent({
    eventKey: chave,
    ownerId: 'owner-idem',
    agentId: new ObjectId(),
    source: 'sector',
    status: 'succeeded',
    startedAt: new Date(0),
    finishedAt: new Date(500),
    metadata: {
      executionId: 'exec-1',
      planId: 'abc123',
      stepId: 't2',
      executorKind: 'function',
      functionName: 'math.summary',
      functionVersion: '1.0.0',
      inputValid: true,
      outputValid: true,
      attempt: 1,
      durationMs: 500,
    },
  })
  const doc = await db.collection('agent_execution_events').findOne({ eventKey: chave })
  for (const [k, v] of Object.entries(doc.metadata)) {
    assert.ok(['string', 'number', 'boolean'].includes(typeof v), `${k} não é escalar`)
  }
  assert.equal(doc.metadata.functionVersion, '1.0.0')
})
