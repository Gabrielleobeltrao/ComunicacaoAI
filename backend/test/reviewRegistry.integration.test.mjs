// A REVISÃO — gravada pelo servidor, presa ao hash, e nunca vinda do autor.
//
// O erro que estes casos existem para impedir: o autor mandar "isto já foi revisado"
// dentro do próprio manifesto. Um campo assim é o autor assinando o próprio atestado, e a
// revisão inteira vira decoração.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const review = await import('../dist/extensionRuntime/review.js')
const gate = await import('../dist/extensionRuntime/gate.js')
const provider = await import('../dist/extensionRuntime/provider.js')
const { scanSource } = await import('../dist/extensionRuntime/scanner.js')
const { publishVersion, ensureToolVersionIndexes } = await import('../dist/toolVersions.js')

const REVISOR = 'conta-revisora'
const AUTOR = 'conta-autora'
const FONTE = 'function run(entrada){ return { ok: true } }'

const SAUDAVEL = {
  ok: true,
  profile: { nonRoot: true, readOnlyRootFs: true, networkDenied: true, noNewPrivileges: true, seccomp: true, ephemeral: true, verifiedCleanup: true },
  runtimes: ['javascript'],
}
const providerFalso = { testVersion: async () => ({ ok: true }), execute: async () => ({ ok: true }), health: async () => SAUDAVEL }

before(async () => {
  await mongoClient.connect()
  await review.ensureReviewIndexes()
  await ensureToolVersionIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['extension_reviews', 'tool_versions']) await db.collection(c).deleteMany({})
  provider.resetSandboxProvider()
  provider.registerSandboxProvider(providerFalso)
  process.env.CODE_TOOLS_ENABLED = '1'
  process.env.PLATFORM_REVIEWERS = REVISOR
})

const hashDe = (fonte) => scanSource(fonte, 'javascript').sha256

// --- o papel vem da configuração --------------------------------------------------------

test('o papel de revisor vem da CONFIGURAÇÃO do servidor, não do pedido', () => {
  assert.equal(review.isPlatformReviewer(REVISOR), true)
  assert.equal(review.isPlatformReviewer(AUTOR), false)
  assert.equal(review.isPlatformReviewer(null), false)

  // Sem a lista, ninguém revisa — e como publicar código exige revisão, código continua
  // impublicável. É o fail-closed de sempre.
  delete process.env.PLATFORM_REVIEWERS
  assert.equal(review.isPlatformReviewer(REVISOR), false)
  process.env.PLATFORM_REVIEWERS = REVISOR
})

test('quem não é revisor não consegue gravar decisão', async () => {
  await assert.rejects(
    () =>
      review.recordReview({
        subjectType: 'tool',
        subjectId: new ObjectId(),
        version: '1.0.0',
        sha256: hashDe(FONTE),
        decision: 'approved',
        reviewerId: AUTOR,
      }),
    /papel de revisão/,
  )
})

test('a decisão é imutável: a segunda do mesmo revisor sobre o mesmo hash é recusada', async () => {
  const subjectId = new ObjectId()
  const entrada = { subjectType: 'tool', subjectId, version: '1.0.0', sha256: hashDe(FONTE), decision: 'approved', reviewerId: REVISOR }
  await review.recordReview(entrada)
  await assert.rejects(() => review.recordReview(entrada), /já decidiu/)
  assert.equal(await db.collection('extension_reviews').countDocuments({}), 1)
})

// --- a amarração ao hash -------------------------------------------------------------------

test('a aprovação vale para o HASH, não para o número da versão', async () => {
  const subjectId = new ObjectId()
  await review.recordReview({ subjectType: 'tool', subjectId, version: '1.0.0', sha256: hashDe(FONTE), decision: 'approved', reviewerId: REVISOR })

  assert.ok(await review.findApproval('tool', subjectId, hashDe(FONTE)))
  // Uma linha diferente é outro código — e a aprovação não viaja para ele.
  assert.equal(await review.findApproval('tool', subjectId, hashDe(FONTE + '\n// mudou')), null)
})

test('aprovação de quem PERDEU o papel de revisor não vale mais', async () => {
  const subjectId = new ObjectId()
  await review.recordReview({ subjectType: 'tool', subjectId, version: '1.0.0', sha256: hashDe(FONTE), decision: 'approved', reviewerId: REVISOR })
  assert.ok(await review.findApproval('tool', subjectId, hashDe(FONTE)))

  process.env.PLATFORM_REVIEWERS = 'outra-pessoa'
  assert.equal(await review.findApproval('tool', subjectId, hashDe(FONTE)), null, 'senão bastaria revisar uma vez e perder o papel')
  process.env.PLATFORM_REVIEWERS = REVISOR
})

test('"mudanças pedidas" não é aprovação', async () => {
  const subjectId = new ObjectId()
  await review.recordReview({ subjectType: 'tool', subjectId, version: '1.0.0', sha256: hashDe(FONTE), decision: 'changes_requested', reviewerId: REVISOR })
  assert.equal(await review.findApproval('tool', subjectId, hashDe(FONTE)), null)
})

// --- o portão de publicação ----------------------------------------------------------------------

test('o AUTOR não consegue se auto-aprovar pelo manifesto', async () => {
  const toolId = new ObjectId()
  const versao = (over = {}) => ({
    version: '1.0.0',
    runtimeKind: 'code',
    // O campo que o autor tentaria usar. Ele é simplesmente ignorado: o portão procura no
    // registro do servidor.
    manifest: { runtime: 'javascript', source: FONTE, humanReview: { reviewerId: REVISOR, at: new Date() }, ...over },
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  })

  await assert.rejects(
    () => publishVersion(AUTOR, toolId, versao()),
    (e) => {
      assert.equal(e.code, 'review_required')
      assert.match(e.message, /revisor da plataforma/)
      return true
    },
  )

  // Com a aprovação DE VERDADE gravada pelo servidor, a mesma publicação passa.
  await review.recordReview({ subjectType: 'tool', subjectId: toolId, version: '1.0.0', sha256: hashDe(FONTE), decision: 'approved', reviewerId: REVISOR })
  const v = await publishVersion(AUTOR, toolId, versao())
  assert.equal(v.runtimeKind, 'code')
})

test('aprovar um código e publicar OUTRO não funciona', async () => {
  const toolId = new ObjectId()
  await review.recordReview({ subjectType: 'tool', subjectId: toolId, version: '1.0.0', sha256: hashDe(FONTE), decision: 'approved', reviewerId: REVISOR })

  await assert.rejects(
    () =>
      publishVersion(AUTOR, toolId, {
        version: '1.0.0',
        runtimeKind: 'code',
        manifest: { runtime: 'javascript', source: 'function run(){ return { ok: false } }' },
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      }),
    /não foi aprovado/,
  )
})

test('a aprovação de UMA ferramenta não vale para outra', async () => {
  const a = new ObjectId()
  const b = new ObjectId()
  await review.recordReview({ subjectType: 'tool', subjectId: a, version: '1.0.0', sha256: hashDe(FONTE), decision: 'approved', reviewerId: REVISOR })
  assert.equal(await review.findApproval('tool', b, hashDe(FONTE)), null)
})

test('sem dizer o que está sendo publicado, o portão recusa', async () => {
  const r = await gate.canPublishCode({ runtime: 'javascript', source: FONTE })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'review_required')
})
