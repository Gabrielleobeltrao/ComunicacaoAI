// TEMPLATE — um blueprint congelado, aplicado pelo Arquiteto que já existe.
//
// Instalar um template não pode criar nada no escritório por conta própria: o efeito
// passa pela prévia, pelo diff e pela aprovação de sempre. E o que ele traz é FORMA —
// memória, conversa, execução, documento, dado de database e credencial do autor não
// viajam, e a recusa acontece na publicação, antes de alguém baixar.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const pkg = await import('../dist/extensions/packages.js')
const tpl = await import('../dist/extensions/templates.js')

const AUTOR = 'autor-template'
const QUEM_INSTALA = 'conta-que-instala'
const REVISOR = { actorId: 'revisor', isReviewer: true }

const BLUEPRINT = {
  version: 1,
  title: 'Atendimento enxuto',
  objective: 'responder clientes sem fila',
  // `action: 'create'` é o que um template traz: ele não conhece os recursos da conta que
  // vai instalá-lo, então nada aqui pode ser "reutilizar o andar tal".
  floors: [{ key: 'atendimento', action: 'create', name: 'Atendimento', description: 'quem fala com cliente', workMode: 'organization' }],
  agents: [
    {
      key: 'marina',
      action: 'create',
      name: 'Marina',
      role: 'operator',
      floorKey: 'atendimento',
      objective: 'responder dúvidas de clientes',
      responsibilities: ['responder dúvidas'],
    },
  ],
  sectors: [],
  routines: [],
  appRequirements: [],
  knowledgeRequirements: [],
  assumptions: [],
  warnings: [],
  checklist: [],
}

before(async () => {
  await mongoClient.connect()
  await pkg.ensureExtensionIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['extension_packages', 'extension_versions', 'extension_installations', 'architect_projects', 'offices', 'agents', 'buildings'])
    await db.collection(c).deleteMany({})
})

const publicado = async (manifest = BLUEPRINT, slug = 'atendimento-enxuto') => {
  const p = await pkg.createPackage(AUTOR, { kind: 'template', slug, name: 'Atendimento enxuto', visibility: 'community' })
  await pkg.publishPackageVersion(AUTOR, p._id, { version: '1.0.0', manifest, changelog: 'primeira' })
  await pkg.transition(p._id, 'submitted', { actorId: AUTOR })
  await pkg.transition(p._id, 'in_review', REVISOR)
  await pkg.transition(p._id, 'approved', { ...REVISOR, review: { decision: 'approved', reviewerId: 'revisor', notes: '' } })
  return pkg.transition(p._id, 'published', REVISOR)
}

// --- o que não viaja ----------------------------------------------------------------------

test('template com memória, conversa ou dado do autor NÃO é publicável', async () => {
  const p = await pkg.createPackage(AUTOR, { kind: 'template', slug: 'com-lixo', name: 'Com lixo' })
  const sujo = { ...BLUEPRINT, agents: [{ ...BLUEPRINT.agents[0], memories: [{ text: 'o cliente X reclamou' }] }] }

  await assert.rejects(
    () => pkg.publishPackageVersion(AUTOR, p._id, { version: '1.0.0', manifest: sujo }),
    (e) => {
      assert.equal(e.code, 'invalid_template')
      assert.match(e.message, /não pode viajar/)
      assert.ok(!e.message.includes('reclamou'), 'o caminho, nunca o conteúdo')
      return true
    },
  )
  assert.equal((await pkg.listVersions(p._id)).length, 0)
})

test('cada campo proibido é pego onde ele estiver', () => {
  const achados = tpl.findForbiddenPaths({
    agents: [{ conversations: [{ m: 1 }] }],
    stores: [{ rows: [{ a: 1 }] }],
    connections: [{ id: 'x' }],
  })
  assert.ok(achados.some((c) => c.includes('conversations')))
  assert.ok(achados.some((c) => c.includes('rows')))
  assert.ok(achados.some((c) => c.includes('connections')))
})

test('lista vazia não é conteúdo — ruído de serialização não bloqueia publicação', () => {
  assert.deepEqual(tpl.findForbiddenPaths({ agents: [{ memories: [], conversations: [] }] }), [])
})

test('template que não é blueprint válido não publica', async () => {
  const p = await pkg.createPackage(AUTOR, { kind: 'template', slug: 'nao-e-blueprint', name: 'Torto' })
  await assert.rejects(
    () => pkg.publishPackageVersion(AUTOR, p._id, { version: '1.0.0', manifest: { qualquer: 'coisa' } }),
    (e) => {
      assert.equal(e.code, 'invalid_template')
      return true
    },
  )
})

// --- a instalação -------------------------------------------------------------------------

test('instalar um template NÃO cria nada no escritório — ele abre a prévia do Arquiteto', async () => {
  const p = await publicado()
  const r = await tpl.installTemplate(QUEM_INSTALA, p._id)

  assert.equal(r.installation.version, '1.0.0')
  assert.ok(r.project._id)
  assert.equal(r.project.status, 'draft', 'o efeito depende de alguém aprovar a prévia')
  assert.equal(r.project.blueprint.title, 'Atendimento enxuto')
  assert.ok(r.blueprintHash)

  // O escritório continua vazio: nada foi criado.
  assert.equal(await db.collection('agents').countDocuments({ ownerId: QUEM_INSTALA }), 0)
  assert.equal(await db.collection('offices').countDocuments({ ownerId: QUEM_INSTALA }), 0)
})

test('o projeto criado é de QUEM INSTALA, e não do autor', async () => {
  const p = await publicado()
  const r = await tpl.installTemplate(QUEM_INSTALA, p._id)
  const projeto = await db.collection('architect_projects').findOne({ _id: r.project._id })
  assert.equal(projeto.ownerId, QUEM_INSTALA)
  assert.equal(await db.collection('architect_projects').countDocuments({ ownerId: AUTOR }), 0)
})

test('um pacote que não é template não instala por este caminho', async () => {
  const p = await pkg.createPackage(AUTOR, { kind: 'app', slug: 'um-app', name: 'App', visibility: 'private' })
  await pkg.publishPackageVersion(AUTOR, p._id, { version: '1.0.0', manifest: { key: 'x', name: 'X' } })
  await assert.rejects(() => tpl.installTemplate(AUTOR, p._id), /não é um template/)
})

test('template suspenso não instala, e diz por quê', async () => {
  const p = await publicado(BLUEPRINT, 'suspenso')
  await pkg.transition(p._id, 'suspended', { ...REVISOR, reason: 'copiava dado de cliente' })
  await assert.rejects(() => tpl.installTemplate(QUEM_INSTALA, p._id), /copiava dado de cliente/)
})

test('instalar duas vezes não cria dois projetos: a instalação é única por conta', async () => {
  const p = await publicado(BLUEPRINT, 'duas-vezes')
  await tpl.installTemplate(QUEM_INSTALA, p._id)
  await assert.rejects(() => tpl.installTemplate(QUEM_INSTALA, p._id), /já está instalado/)
  assert.equal(await db.collection('architect_projects').countDocuments({ ownerId: QUEM_INSTALA }), 1)
})

// --- o template como proposta V2 -----------------------------------------------------------
//
// Com a flag ligada, um template da Comunidade chega convertido — nunca reescrito. A
// conversão preserva `key` e `resourceId`, e o que o V1 não diz ela não inventa.

test('DESLIGADA: o template continua chegando como proposta V1', async () => {
  process.env.ARCHITECT_BLUEPRINT_V2 = '0'
  const p = await publicado(BLUEPRINT, 'v1-puro')
  const r = await tpl.installTemplate(QUEM_INSTALA, p._id)
  const projeto = await db.collection('architect_projects').findOne({ _id: r.project._id })
  assert.equal(projeto.blueprintV2, undefined)
  assert.equal(projeto.blueprintVersion, 1)
  delete process.env.ARCHITECT_BLUEPRINT_V2
})

test('LIGADA: o template vira proposta V2 preservando as `key`s', async () => {
  process.env.ARCHITECT_BLUEPRINT_V2 = '1'
  try {
    const p = await publicado(BLUEPRINT, 'convertido')
    const r = await tpl.installTemplate(QUEM_INSTALA, p._id)
    const projeto = await db.collection('architect_projects').findOne({ _id: r.project._id })

    assert.equal(projeto.blueprintVersion, 2)
    assert.equal(projeto.blueprintV2.version, 2)
    // As MESMAS chaves: chave nova num projeto aplicado significa recurso novo ao lado do
    // que já existe — um escritório duplicado por causa de uma conversão.
    assert.deepEqual(
      projeto.blueprintV2.organization.floors.map((f) => f.key),
      projeto.blueprint.floors.map((f) => f.key),
    )
    assert.deepEqual(
      projeto.blueprintV2.organization.agents.map((a) => a.key),
      projeto.blueprint.agents.map((a) => a.key),
    )
    // E continua rascunho: instalar um template não pode criar agente na conta de ninguém.
    assert.equal(projeto.status, 'draft')
    assert.equal(await db.collection('agents').countDocuments({ ownerId: QUEM_INSTALA }), 0)
  } finally {
    delete process.env.ARCHITECT_BLUEPRINT_V2
  }
})

test('LIGADA: o hash cobre os dois planos', async () => {
  process.env.ARCHITECT_BLUEPRINT_V2 = '1'
  try {
    const p = await publicado(BLUEPRINT, 'hash-dos-dois')
    const r = await tpl.installTemplate(QUEM_INSTALA, p._id)
    const { computeBlueprintHash } = await import('../dist/architect/blueprint.js')
    const projeto = await db.collection('architect_projects').findOne({ _id: r.project._id })
    assert.equal(projeto.blueprintHash, computeBlueprintHash(projeto.blueprint, projeto.blueprintV2))
    assert.notEqual(projeto.blueprintHash, computeBlueprintHash(projeto.blueprint))
  } finally {
    delete process.env.ARCHITECT_BLUEPRINT_V2
  }
})
