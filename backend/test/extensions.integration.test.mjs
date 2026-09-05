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
  for (const c of ['extension_packages', 'extension_versions', 'extension_installations', 'app_definitions', 'tools', 'connections'])
    await db.collection(c).deleteMany({})
})

// Um manifesto de App COMPLETO — e ele precisa ser completo desde que instalar passou a
// criar o App de verdade: um manifesto que não vira App não deveria instalar.
const MANIFESTO = {
  key: 'crm_simples',
  version: '1.0.0',
  source: 'private',
  name: 'CRM Simples',
  description: 'cadastro de contatos',
  categories: [],
  // A DEFINIÇÃO do campo de credencial viaja; o valor é que não pode.
  auth: { kind: 'api_key', fields: [{ key: 'apiKey', label: 'Chave da API' }] },
  allowedDomains: ['api.exemplo.test'],
  supportsMultipleConnections: false,
  actions: [
    {
      key: 'criar_contato',
      name: 'Criar contato',
      description: 'cria um contato novo no CRM a partir de nome e e-mail',
      risk: 'write',
      inputSchema: { type: 'object', properties: { nome: { type: 'string' } } },
      execution: { kind: 'http', method: 'POST', url: 'https://api.exemplo.test/contatos' },
    },
  ],
  status: 'available',
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

test('o catálogo separa por TIPO — e é disso que a prateleira depende', async () => {
  /**
   * Apps e Ferramentas passaram a mostrar o que é da comunidade dentro delas: a página de
   * Apps pede `kind=app` e `kind=template`, a de Ferramentas pede `kind=tool`. Se o filtro
   * fosse ignorado, uma ferramenta apareceria entre os Apps com um botão de instalar que
   * não faz o que o cartão promete.
   */
  await ateOPublicado({ kind: 'app', visibility: 'community', slug: 'crm-app' })
  await ateOPublicado({ kind: 'tool', visibility: 'community', slug: 'cep-tool' })

  assert.deepEqual((await pkg.searchCatalog({ kind: 'app' })).map((p) => p.slug), ['crm-app'])
  assert.deepEqual((await pkg.searchCatalog({ kind: 'tool' })).map((p) => p.slug), ['cep-tool'])
  assert.equal((await pkg.searchCatalog({})).length, 2, 'sem tipo, o catálogo continua sendo o catálogo inteiro')
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
  // O App foi criado — e o que falta é dito: a credencial nunca viajou dentro do pacote.
  assert.equal(i.createdRefs.length, 1)
  assert.match(i.createdRefs[0].pending, /credenciais/)
  assert.equal(await db.collection('connections').countDocuments({ ownerId: OUTRO }), 0)
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

// --- a instalação MATERIALIZA ------------------------------------------------------------

test('instalar um App cria o App privado de verdade — e sem credencial do autor', async () => {
  const p = await pkg.createPackage(AUTOR, { kind: 'app', slug: 'app-materializa', name: 'CRM', visibility: 'community' })
  await pkg.publishPackageVersion(AUTOR, p._id, {
    version: '1.0.0',
    manifest: {
      key: 'crm_instalado',
      version: '1.0.0',
      source: 'private',
      name: 'CRM Instalado',
      description: 'contatos',
      categories: [],
      auth: { kind: 'api_key', fields: [{ key: 'apiKey', label: 'Chave' }] },
      allowedDomains: ['api.crm.test'],
      supportsMultipleConnections: false,
      actions: [
        {
          key: 'criar',
          name: 'Criar',
          description: 'cria um contato novo no CRM a partir dos dados informados',
          risk: 'write',
          inputSchema: { type: 'object', properties: {} },
          execution: { kind: 'http', method: 'POST', url: 'https://api.crm.test/c' },
        },
      ],
      status: 'available',
    },
  })
  await pkg.transition(p._id, 'submitted', { actorId: AUTOR })
  await pkg.transition(p._id, 'in_review', REVISOR)
  await pkg.transition(p._id, 'approved', { ...REVISOR, review: { decision: 'approved', reviewerId: 'revisor', notes: '' } })
  await pkg.transition(p._id, 'published', REVISOR)

  const i = await inst.install(OUTRO, p._id)
  assert.equal(i.createdRefs.length, 1, 'instalar sem materializar seria uma promessa')
  assert.equal(i.createdRefs[0].kind, 'app_definition')
  assert.match(i.createdRefs[0].pending, /credenciais/)

  // O App existe na conta de QUEM INSTALOU, e é dela.
  const app = await db.collection('app_definitions').findOne({ ownerId: OUTRO, key: 'crm_instalado' })
  assert.ok(app, 'o App foi criado no subsistema canônico')
  assert.equal(await db.collection('app_definitions').countDocuments({ ownerId: AUTOR }), 0)
  // Nenhuma conexão do autor viajou junto.
  assert.equal(await db.collection('connections').countDocuments({ ownerId: OUTRO }), 0)
})

test('instalar uma Tool cria a ferramenta DESLIGADA, com os cabeçalhos vazios', async () => {
  const p = await pkg.createPackage(AUTOR, { kind: 'tool', slug: 'tool-materializa', name: 'Consulta CEP', visibility: 'community' })
  await pkg.publishPackageVersion(AUTOR, p._id, {
    version: '1.0.0',
    manifest: {
      kind: 'http_tool',
      name: 'consulta_cep',
      description: 'consulta um endereço a partir do CEP informado',
      method: 'GET',
      url: 'https://api.cep.test/v1',
      headerNames: ['Authorization'],
      inputSchema: { type: 'object', properties: { cep: { type: 'string' } } },
    },
  })
  await pkg.transition(p._id, 'submitted', { actorId: AUTOR })
  await pkg.transition(p._id, 'in_review', REVISOR)
  await pkg.transition(p._id, 'approved', { ...REVISOR, review: { decision: 'approved', reviewerId: 'revisor', notes: '' } })
  await pkg.transition(p._id, 'published', REVISOR)

  const i = await inst.install(OUTRO, p._id)
  const ferramenta = await db.collection('tools').findOne({ ownerId: OUTRO, name: 'consulta_cep' })
  assert.ok(ferramenta)
  assert.equal(ferramenta.enabled, false, 'ligada sem credencial só produz erro na cara de quem usar')
  // `Authorization` NÃO vira cabeçalho: credencial mora na seção de autenticação, cifrada.
  // Materializar contornando essa regra criaria pela porta da comunidade o documento que o
  // produto recusa criar pela porta da frente.
  assert.deepEqual(ferramenta.headers, [])
  assert.match(i.createdRefs[0].pending, /configure a autenticação \(Authorization\)/)
})

test('materializar em cima de um nome que já existe é recusado, e a instalação não fica pela metade', async () => {
  await db.collection('tools').insertOne({ ownerId: OUTRO, name: 'consulta_cep', description: 'minha', enabled: true, method: 'GET', url: 'https://x.test', headers: [], inputSchema: {}, createdAt: new Date(), updatedAt: new Date() })

  const p = await pkg.createPackage(AUTOR, { kind: 'tool', slug: 'tool-conflito', name: 'Consulta CEP', visibility: 'community' })
  await pkg.publishPackageVersion(AUTOR, p._id, {
    version: '1.0.0',
    manifest: { kind: 'http_tool', name: 'consulta_cep', description: 'consulta um endereço a partir do CEP informado', method: 'GET', url: 'https://api.cep.test/v1', inputSchema: { type: 'object', properties: {} } },
  })
  await pkg.transition(p._id, 'submitted', { actorId: AUTOR })
  await pkg.transition(p._id, 'in_review', REVISOR)
  await pkg.transition(p._id, 'approved', { ...REVISOR, review: { decision: 'approved', reviewerId: 'revisor', notes: '' } })
  await pkg.transition(p._id, 'published', REVISOR)

  await assert.rejects(() => inst.install(OUTRO, p._id), /já existe uma ferramenta/)
  // A linha da instalação saiu junto: apontar para nada é pior do que não existir.
  assert.equal(await inst.getInstallation(OUTRO, p._id), null)
})

// --- desinstalar e atualizar preservam o que a pessoa mudou ----------------------------------

const pacoteDeFerramenta = async (slug, manifestOver = {}) => {
  const p = await pkg.createPackage(AUTOR, { kind: 'tool', slug, name: 'Ferramenta', visibility: 'community' })
  await pkg.publishPackageVersion(AUTOR, p._id, {
    version: '1.0.0',
    manifest: {
      kind: 'http_tool',
      name: `ferramenta_${slug}`,
      description: 'consulta a API de teste quando alguém pede um dado dela',
      method: 'GET',
      url: 'https://api.test/v1',
      inputSchema: { type: 'object', properties: {} },
      ...manifestOver,
    },
  })
  await pkg.transition(p._id, 'submitted', { actorId: AUTOR })
  await pkg.transition(p._id, 'in_review', REVISOR)
  await pkg.transition(p._id, 'approved', { ...REVISOR, review: { decision: 'approved', reviewerId: 'revisor', notes: '' } })
  return pkg.transition(p._id, 'published', REVISOR)
}

test('desinstalar DESLIGA o que veio do pacote e não foi tocado — e nunca apaga', async () => {
  const p = await pacoteDeFerramenta('tool-desliga')
  const i = await inst.install(OUTRO, p._id)
  const toolId = new ObjectId(i.createdRefs[0].id)
  await db.collection('tools').updateOne({ _id: toolId }, { $set: { enabled: true } })

  const r = await inst.uninstall(OUTRO, p._id)
  assert.equal(r.status, 'paused')
  assert.equal(r.impact.disabled.length, 1)
  const depois = await db.collection('tools').findOne({ _id: toolId })
  assert.ok(depois, 'nada é apagado: o histórico de execução aponta para cá')
  assert.equal(depois.enabled, false)
})

test('desinstalar PRESERVA o que quem instalou editou', async () => {
  const p = await pacoteDeFerramenta('tool-editada')
  const i = await inst.install(OUTRO, p._id)
  const toolId = new ObjectId(i.createdRefs[0].id)
  // A pessoa mexeu depois de instalar: isso deixou de ser o que veio do pacote.
  await db.collection('tools').updateOne({ _id: toolId }, { $set: { enabled: true, url: 'https://meu-proxy.test/v1', updatedAt: new Date(Date.now() + 5_000) } })

  const r = await inst.uninstall(OUTRO, p._id)
  assert.equal(r.impact.disabled.length, 0)
  assert.equal(r.impact.kept.length, 1)
  const depois = await db.collection('tools').findOne({ _id: toolId })
  assert.equal(depois.enabled, true, 'desinstalar não desfaz o ajuste de quem instalou')
  assert.equal(depois.url, 'https://meu-proxy.test/v1')
})

test('a prévia de impacto responde antes de desinstalar', async () => {
  const p = await pacoteDeFerramenta('tool-impacto')
  await inst.install(OUTRO, p._id)
  const impacto = await inst.impactOf(OUTRO, p._id)
  assert.equal(impacto.length, 1)
  assert.equal(impacto[0].exists, true)
  assert.equal(impacto[0].edited, false)
  assert.equal(impacto[0].name, 'ferramenta_tool-impacto')
})

test('atualizar reescreve o que veio do pacote e PRESERVA o que foi editado', async () => {
  const p = await pacoteDeFerramenta('tool-atualiza')
  const i = await inst.install(OUTRO, p._id)
  const toolId = new ObjectId(i.createdRefs[0].id)

  await pkg.publishPackageVersion(AUTOR, p._id, {
    version: '1.1.0',
    manifest: { kind: 'http_tool', name: 'ferramenta_tool-atualiza', description: 'consulta a API de teste quando alguém pede um dado dela', method: 'POST', url: 'https://api.test/v2', inputSchema: { type: 'object', properties: {} } },
  })
  await inst.applyUpdate(OUTRO, p._id, { approvePermissions: true })

  const depois = await db.collection('tools').findOne({ _id: toolId })
  assert.equal(depois.url, 'https://api.test/v2', 'o que não foi tocado recebe a versão nova')
  assert.equal(depois.method, 'POST')
})

test('atualizar NÃO desfaz o ajuste de quem instalou', async () => {
  const p = await pacoteDeFerramenta('tool-preserva')
  const i = await inst.install(OUTRO, p._id)
  const toolId = new ObjectId(i.createdRefs[0].id)
  await db.collection('tools').updateOne({ _id: toolId }, { $set: { url: 'https://meu-proxy.test/v1', updatedAt: new Date(Date.now() + 5_000) } })

  await pkg.publishPackageVersion(AUTOR, p._id, {
    version: '1.1.0',
    manifest: { kind: 'http_tool', name: 'ferramenta_tool-preserva', description: 'consulta a API de teste quando alguém pede um dado dela', method: 'GET', url: 'https://api.test/v2', inputSchema: { type: 'object', properties: {} } },
  })
  const r = await inst.applyUpdate(OUTRO, p._id, { approvePermissions: true })

  const depois = await db.collection('tools').findOne({ _id: toolId })
  assert.equal(depois.url, 'https://meu-proxy.test/v1', 'a atualização não desfaz, em silêncio, o ajuste de ontem')
  assert.equal(r.preserved.length, 1)
})
