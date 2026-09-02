// EXTENSÕES — rascunho editável, versão instalada imutável e pinada.
//
// "Instalei a extensão X" só significa algo se X não puder mudar por baixo. Estes casos
// protegem o que sustenta isso: o ciclo de estados como grafo, a imutabilidade da versão,
// o pin da instalação, o diff de permissões antes de atualizar e a peneira que impede uma
// credencial de sair dentro de um pacote que estranhos vão baixar.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const pkg = await import('../dist/extensions/packages.js')
const inst = await import('../dist/extensions/installs.js')

const AUTOR = 'conta-autora'
const OUTRO = 'conta-vizinha'
const REVISOR = { actorId: 'revisor', isReviewer: true }

before(async () => {
  await mongoClient.connect()
  await pkg.ensureExtensionIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['extension_packages', 'extension_versions', 'extension_installations']) await db.collection(c).deleteMany({})
})

const MANIFESTO = {
  key: 'crm_simples',
  name: 'CRM Simples',
  actions: [{ key: 'criar_contato', risk: 'write', execution: { kind: 'http', method: 'POST', url: 'https://api.exemplo.test/contatos' } }],
  // A DEFINIÇÃO do campo de credencial viaja; o valor é que não pode.
  auth: { kind: 'api_key', fields: [{ key: 'apiKey', label: 'Chave da API' }] },
}

const PERMISSOES = [{ kind: 'network', key: 'api.exemplo.test', capabilities: ['read'], reason: 'consultar contatos' }]

const criar = (over = {}) => pkg.createPackage(AUTOR, { kind: 'app', slug: 'crm-simples', name: 'CRM Simples', ...over })

const publicar = (p, over = {}) =>
  pkg.publishPackageVersion(AUTOR, p._id, {
    version: '1.0.0',
    manifest: MANIFESTO,
    permissionManifest: PERMISSOES,
    changelog: 'primeira versão',
    ...over,
  })

/** Leva um pacote do rascunho até publicado, pelo ciclo inteiro. */
const ateOPublicado = async (over = {}) => {
  const p = await criar(over)
  await publicar(p)
  await pkg.transition(p._id, 'submitted', { actorId: AUTOR })
  await pkg.transition(p._id, 'in_review', REVISOR)
  await pkg.transition(p._id, 'approved', { ...REVISOR, review: { decision: 'approved', reviewerId: 'revisor', notes: 'ok' } })
  return pkg.transition(p._id, 'published', REVISOR)
}

// --- o pacote e a versão --------------------------------------------------------------

test('todo pacote nasce RASCUNHO, mesmo com tudo preenchido', async () => {
  const p = await criar()
  assert.equal(p.status, 'draft')
  assert.equal(p.latestVersion, null)
})

test('uma versão publicada é imutável: republicar o mesmo número é recusado', async () => {
  const p = await criar()
  const v = await publicar(p)
  assert.equal(v.immutable, true)
  assert.ok(v.sha256)

  await assert.rejects(() => publicar(p, { manifest: { ...MANIFESTO, name: 'Outro' } }), /já foi publicada/)
  assert.equal((await pkg.listVersions(p._id)).length, 1)
})

test('o hash ignora a ORDEM das chaves — reescrita cosmética não é versão diferente', () => {
  const a = pkg.hashManifest({ x: 1, y: { b: 2, a: 3 } })
  const b = pkg.hashManifest({ y: { a: 3, b: 2 }, x: 1 })
  assert.equal(a, b)
  assert.notEqual(a, pkg.hashManifest({ x: 2, y: { a: 3, b: 2 } }))
})

test('credencial dentro do manifesto impede a publicação — e a recusa não repete o segredo', async () => {
  const p = await criar()
  const comSegredo = { ...MANIFESTO, auth: { kind: 'api_key', apiKey: 'chave-que-nao-pode-viajar' } }
  await assert.rejects(
    () => publicar(p, { manifest: comSegredo }),
    (e) => {
      assert.equal(e.code, 'secret_in_manifest')
      assert.match(e.message, /auth\.apiKey/)
      assert.ok(!e.message.includes('chave-que-nao-pode-viajar'), 'o caminho, nunca o valor')
      return true
    },
  )
  assert.equal((await pkg.listVersions(p._id)).length, 0)
})

test('a DEFINIÇÃO de um campo de credencial continua viajando — é ela que diz o que fornecer', async () => {
  const p = await criar()
  const v = await publicar(p)
  assert.equal(v.manifest.auth.fields[0].key, 'apiKey')
})

// --- o ciclo de estados ------------------------------------------------------------------

test('o ciclo é um GRAFO: um salto que ele não prevê não acontece', async () => {
  const p = await criar()
  await publicar(p)
  await assert.rejects(() => pkg.transition(p._id, 'published', REVISOR), /não dá para ir de "draft"/)
  await assert.rejects(() => pkg.transition(p._id, 'approved', REVISOR), /não dá para ir de "draft"/)
})

test('aprovar e publicar são da revisão, não do autor', async () => {
  const p = await criar()
  await publicar(p)
  await pkg.transition(p._id, 'submitted', { actorId: AUTOR })
  await assert.rejects(() => pkg.transition(p._id, 'in_review', { actorId: AUTOR }), /da revisão/)
})

test('o pacote de outra pessoa não se submete', async () => {
  const p = await criar()
  await assert.rejects(() => pkg.transition(p._id, 'submitted', { actorId: OUTRO }), /não é seu/)
})

test('a revisão fica registrada NA VERSÃO — e é por ela que se sabe o que foi revisado', async () => {
  const p = await ateOPublicado()
  const [v] = await pkg.listVersions(p._id)
  assert.equal(v.review.decision, 'approved')
  assert.equal(v.review.reviewerId, 'revisor')
  assert.ok(v.review.at instanceof Date)
})

test('suspender exige motivo, e o motivo fica visível para quem instalou', async () => {
  const p = await ateOPublicado()
  await assert.rejects(() => pkg.transition(p._id, 'suspended', REVISOR), /por que/)
  const suspenso = await pkg.transition(p._id, 'suspended', { ...REVISOR, reason: 'domínio trocado sem aviso' })
  assert.equal(suspenso.suspendedReason, 'domínio trocado sem aviso')
})

// --- o catálogo -------------------------------------------------------------------------

test('o catálogo só mostra o que foi publicado — rascunho e suspenso ficam fora', async () => {
  const publicado = await ateOPublicado({ visibility: 'community', slug: 'crm-publico' })
  await criar({ slug: 'crm-rascunho', visibility: 'community' })

  const antes = await pkg.searchCatalog({})
  assert.deepEqual(antes.map((p) => p.slug), ['crm-publico'])

  await pkg.transition(publicado._id, 'suspended', { ...REVISOR, reason: 'incidente' })
  assert.equal((await pkg.searchCatalog({})).length, 0, 'suspenso some do catálogo na mesma consulta')
})

test('a contagem de instalações vem do BANCO, e não de um contador', async () => {
  const p = await ateOPublicado({ visibility: 'community', slug: 'crm-contado' })
  await inst.install('conta-1', p._id)
  await inst.install('conta-2', p._id)
  await inst.uninstall('conta-2', p._id)

  const [achado] = await pkg.searchCatalog({})
  assert.equal(achado.installs, 2, 'pausada continua sendo uma instalação; apagada é que não existiria')
})

// --- a instalação -----------------------------------------------------------------------

test('a instalação FIXA a versão, e o autor publicar não muda o que já roda', async () => {
  const p = await ateOPublicado({ visibility: 'community', slug: 'crm-pin' })
  const i = await inst.install(OUTRO, p._id)
  assert.equal(i.version, '1.0.0')

  await pkg.publishPackageVersion(AUTOR, p._id, { version: '1.1.0', manifest: { ...MANIFESTO, name: 'CRM 1.1' }, permissionManifest: PERMISSOES })
  const depois = await inst.getInstallation(OUTRO, p._id)
  assert.equal(depois.version, '1.0.0', 'atualizar é um ato, nunca um efeito de o autor publicar')
})

test('a instalação NÃO traz credencial, grant nem dado do autor', async () => {
  const p = await ateOPublicado({ visibility: 'community', slug: 'crm-limpo' })
  const i = await inst.install(OUTRO, p._id)
  assert.deepEqual(i.config, {}, 'a configuração é de quem instala')
  assert.deepEqual(i.grants, [], 'o pacote PEDE; quem instala é que concede')
  assert.deepEqual(i.createdRefs, [])
})

test('pacote suspenso bloqueia instalação nova na hora, dizendo por quê', async () => {
  const p = await ateOPublicado({ visibility: 'community', slug: 'crm-suspenso' })
  const antiga = await inst.install('quem-chegou-antes', p._id)
  await pkg.transition(p._id, 'suspended', { ...REVISOR, reason: 'chave vazada' })

  await assert.rejects(() => inst.install(OUTRO, p._id), /chave vazada/)
  // E o que já estava instalado não é apagado.
  assert.ok(await inst.getInstallation('quem-chegou-antes', p._id))
  assert.ok(antiga)
})

test('pacote privado de outra conta não existe para instalar', async () => {
  const p = await criar({ slug: 'crm-privado' })
  await publicar(p)
  await assert.rejects(() => inst.install(OUTRO, p._id), /não encontrado/)
})

test('desinstalar PAUSA e guarda — histórico não se reescreve', async () => {
  const p = await ateOPublicado({ visibility: 'community', slug: 'crm-pausa' })
  await inst.install(OUTRO, p._id)
  const pausada = await inst.uninstall(OUTRO, p._id)
  assert.equal(pausada.status, 'paused')
  assert.ok(await inst.getInstallation(OUTRO, p._id), 'a linha continua existindo')
})

// --- o diff de permissões ------------------------------------------------------------------

test('o diff diz o que a versão nova passa a poder fazer', () => {
  const d = inst.permissionDiff(
    [{ kind: 'network', key: 'api.exemplo.test', capabilities: ['read'], reason: '' }],
    [
      { kind: 'network', key: 'api.exemplo.test', capabilities: ['read', 'write'], reason: '' },
      { kind: 'app', key: 'google_calendar', capabilities: ['read'], reason: '' },
    ],
  )
  assert.equal(d.added.length, 1)
  assert.equal(d.changed.length, 1)
  assert.deepEqual(d.changed[0].after, ['read', 'write'])
  assert.equal(d.needsApproval, true)
})

test('perder permissão não exige aprovação — ampliar é que exige', () => {
  const menor = inst.permissionDiff(
    [{ kind: 'network', key: 'a', capabilities: ['read', 'write'], reason: '' }],
    [{ kind: 'network', key: 'a', capabilities: ['read'], reason: '' }],
  )
  assert.equal(menor.needsApproval, false)
  assert.equal(menor.changed.length, 1)
})

test('atualizar que pede MAIS é recusado sem aprovação explícita', async () => {
  const p = await ateOPublicado({ visibility: 'community', slug: 'crm-diff' })
  await inst.install(OUTRO, p._id)
  await pkg.publishPackageVersion(AUTOR, p._id, {
    version: '1.1.0',
    manifest: { ...MANIFESTO, name: 'CRM 1.1' },
    permissionManifest: [{ kind: 'network', key: 'api.exemplo.test', capabilities: ['read', 'write'], reason: 'passou a escrever' }],
  })

  const previa = await inst.previewUpdate(OUTRO, p._id)
  assert.equal(previa.from, '1.0.0')
  assert.equal(previa.to, '1.1.0')
  assert.equal(previa.permissions.needsApproval, true)
  assert.equal(previa.compatible, true)

  await assert.rejects(() => inst.applyUpdate(OUTRO, p._id), /permissões novas/)
  assert.equal((await inst.getInstallation(OUTRO, p._id)).version, '1.0.0', 'nada mudou')

  const depois = await inst.applyUpdate(OUTRO, p._id, { approvePermissions: true })
  assert.equal(depois.version, '1.1.0')
})

test('MAIOR diferente é marcado como incompatível, e não atualiza sozinho', async () => {
  const p = await ateOPublicado({ visibility: 'community', slug: 'crm-major' })
  await inst.install(OUTRO, p._id)
  await pkg.publishPackageVersion(AUTOR, p._id, { version: '2.0.0', manifest: MANIFESTO, permissionManifest: PERMISSOES })

  const previa = await inst.previewUpdate(OUTRO, p._id)
  assert.equal(previa.compatible, false, 'MAIOR mudou: o significado das ações pode ter mudado junto')
})

test('prévia de atualização não muda nada', async () => {
  const p = await ateOPublicado({ visibility: 'community', slug: 'crm-previa' })
  await inst.install(OUTRO, p._id)
  await pkg.publishPackageVersion(AUTOR, p._id, { version: '1.2.0', manifest: MANIFESTO, permissionManifest: PERMISSOES })
  await inst.previewUpdate(OUTRO, p._id)
  assert.equal((await inst.getInstallation(OUTRO, p._id)).version, '1.0.0')
})

// --- a execução pergunta antes ---------------------------------------------------------------

test('a execução resolve fail-closed: suspenso, pausado ou sem versão respondem NÃO', async () => {
  const p = await ateOPublicado({ visibility: 'community', slug: 'crm-runtime' })
  await inst.install(OUTRO, p._id)
  assert.equal((await inst.resolveInstalled(OUTRO, p._id)).ok, true)

  await inst.uninstall(OUTRO, p._id)
  const pausada = await inst.resolveInstalled(OUTRO, p._id)
  assert.equal(pausada.ok, false)
  assert.equal(pausada.reason, 'instalacao_pausada')

  assert.equal((await inst.resolveInstalled('conta-sem-nada', p._id)).reason, 'nao_instalado')
  assert.equal((await inst.resolveInstalled(OUTRO, new ObjectId())).reason, 'nao_instalado')
})

test('pacote suspenso barra a EXECUÇÃO do que já estava instalado, com o motivo', async () => {
  const p = await ateOPublicado({ visibility: 'community', slug: 'crm-barra' })
  await inst.install(OUTRO, p._id)
  await pkg.transition(p._id, 'suspended', { ...REVISOR, reason: 'endpoint sequestrado' })

  const r = await inst.resolveInstalled(OUTRO, p._id)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'pacote_suspenso')
  assert.match(r.detail, /endpoint sequestrado/)
})

// --- o backfill ---------------------------------------------------------------------------

test('o backfill cria um pacote PRIVADO por App privado, e não toca no App', async () => {
  const { backfillPrivateApps, prepareToolForSharing, permissionsOfApp } = await import('../dist/extensions/backfill.js')
  const manifesto = {
    key: 'meu_crm',
    version: '2.3.0',
    source: 'private',
    name: 'Meu CRM',
    description: 'contatos',
    categories: ['vendas'],
    auth: { kind: 'api_key', fields: [{ key: 'apiKey', label: 'Chave' }] },
    allowedDomains: ['api.meucrm.test'],
    supportsMultipleConnections: false,
    actions: [
      {
        key: 'criar',
        name: 'Criar contato',
        description: 'cria',
        risk: 'write',
        inputSchema: { type: 'object', properties: {} },
        execution: { kind: 'http', method: 'POST', url: 'https://api.meucrm.test/c' },
      },
    ],
    status: 'available',
  }
  await db.collection('app_definitions').insertOne({ ownerId: AUTOR, key: 'meu_crm', version: '2.3.0', manifest: manifesto, createdAt: new Date(), updatedAt: new Date() })

  // Sem aplicar: só o plano.
  const plano = await backfillPrivateApps(AUTOR, { dryRun: true })
  assert.equal(plano.scanned, 1)
  assert.equal(plano.created, 0)
  assert.deepEqual(plano.planned, [{ appKey: 'meu_crm', slug: 'app-meu-crm' }])
  assert.equal((await db.collection('extension_packages').countDocuments({})), 0, 'dry-run não escreve')

  const feito = await backfillPrivateApps(AUTOR)
  assert.equal(feito.created, 1)
  const pacote = await db.collection('extension_packages').findOne({ slug: 'app-meu-crm' })
  assert.equal(pacote.visibility, 'private', 'backfill não publica nada')
  assert.equal(pacote.status, 'draft')

  // O App continua exatamente como estava: ele segue sendo a fonte.
  const app = await db.collection('app_definitions').findOne({ key: 'meu_crm' })
  assert.equal(app.manifest.name, 'Meu CRM')
  assert.equal(app.manifest.status, 'available')

  // As permissões são DERIVADAS do manifesto, não digitadas.
  assert.deepEqual(permissionsOfApp(manifesto)[0].capabilities, ['read', 'write'])
  assert.equal(permissionsOfApp(manifesto)[0].key, 'api.meucrm.test')

  // Rodar de novo não duplica.
  const denovo = await backfillPrivateApps(AUTOR)
  assert.equal(denovo.created, 0)
  assert.equal(denovo.skipped, 1)
  assert.ok(prepareToolForSharing)
})

test('preparar uma ferramenta para compartilhar leva a FORMA, nunca o valor do cabeçalho', async () => {
  const { prepareToolForSharing } = await import('../dist/extensions/backfill.js')
  const r = await db.collection('tools').insertOne({
    ownerId: AUTOR,
    name: 'consulta_cep',
    description: 'consulta um CEP',
    enabled: true,
    method: 'GET',
    url: 'https://api.cep.test/v1',
    headers: [{ key: 'Authorization', value: 'Bearer segredo-que-nao-pode-viajar' }],
    inputSchema: { type: 'object', properties: { cep: { type: 'string' } } },
    timeoutMs: 8000,
    maxResponseChars: 4000,
    allowedDomains: [],
  })

  const pacote = await prepareToolForSharing(AUTOR, r.insertedId)
  assert.equal(pacote.kind, 'tool')
  assert.equal(pacote.visibility, 'private', 'preparar não publica')

  const [versao] = await pkg.listVersions(pacote._id)
  assert.deepEqual(versao.manifest.headerNames, ['Authorization'], 'o NOME viaja, para quem instala saber o que fornecer')
  const texto = JSON.stringify(versao)
  assert.ok(!texto.includes('segredo-que-nao-pode-viajar'), 'o valor fica cifrado na conta de origem')
  assert.equal(versao.permissionManifest[0].key, 'api.cep.test')
})
