// A manifest is the only thing standing between "an owner described an integration"
// and "this product made an HTTP request with a credential attached". These tests are
// the rule book. Pure — no database, no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/app-manifest-test'

const { validateAppManifest, describeManifestIssues, sanitizeImportedManifest, exportableManifest } = await import('../dist/apps/manifest.js')
const { actionToolName } = await import('../dist/apps/types.js')

const httpAction = (over = {}) => ({
  key: 'buscar_pedido',
  name: 'Buscar pedido',
  description: 'Busca um pedido pelo número no sistema da loja.',
  risk: 'read',
  inputSchema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
  execution: { kind: 'http', method: 'GET', url: 'https://api.exemplo.com/pedidos/{{numero}}' },
  ...over,
})

const manifest = (over = {}) => ({
  key: 'loja_exemplo',
  version: '1.0.0',
  source: 'private',
  name: 'Loja Exemplo',
  description: 'Integração com a loja.',
  categories: ['vendas'],
  status: 'draft',
  auth: { kind: 'api_key', fields: [{ key: 'apiKey', label: 'Chave de API', required: true, secret: true }] },
  allowedDomains: ['api.exemplo.com'],
  supportsMultipleConnections: false,
  actions: [httpAction()],
  ...over,
})

const accept = (input) => {
  const r = validateAppManifest(input)
  assert.equal(r.valid, true, describeManifestIssues(r.errors))
  return r
}

const reject = (input, pathFragment) => {
  const r = validateAppManifest(input)
  assert.equal(r.valid, false, `deveria ter sido rejeitado: ${JSON.stringify(input).slice(0, 200)}`)
  if (pathFragment) {
    assert.ok(
      r.errors.some((e) => e.path.includes(pathFragment)),
      `esperava erro em ${pathFragment}, recebi: ${describeManifestIssues(r.errors)}`,
    )
  }
  return r
}

// --- shape and versioning -----------------------------------------------------

test('um manifesto declarativo bem formado é aceito', () => {
  accept(manifest())
})

test('key e version precisam ser estáveis e comparáveis', () => {
  reject(manifest({ key: 'Loja Exemplo' }), 'key')
  reject(manifest({ key: '1loja' }), 'key')
  reject(manifest({ version: 'v1' }), 'version')
  reject(manifest({ version: '1.0' }), 'version')
  accept(manifest({ version: '2.11.3' }))
})

test('source e status precisam ser valores conhecidos', () => {
  reject(manifest({ source: 'marketplace' }), 'source')
  reject(manifest({ status: 'ativo' }), 'status')
})

test('um manifesto que não é objeto é rejeitado sem explodir', () => {
  for (const value of [null, undefined, 'texto', 42, []]) {
    assert.equal(validateAppManifest(value).valid, false)
  }
})

// --- ações --------------------------------------------------------------------

test('nomes de ação são estáveis e não colidem entre Apps', () => {
  assert.equal(actionToolName('loja_exemplo', 'buscar_pedido'), 'loja_exemplo__buscar_pedido')
  // Dois Apps podem ter a mesma ação sem colidir.
  assert.notEqual(actionToolName('a', 'send'), actionToolName('b', 'send'))
  // O nome exposto ao modelo nunca carrega caractere inválido.
  assert.match(actionToolName('loja exemplo!', 'enviar/agora'), /^[a-zA-Z0-9_-]+$/)
})

test('key de ação inválida ou duplicada é rejeitada', () => {
  reject(manifest({ actions: [httpAction({ key: 'Buscar Pedido' })] }), 'actions[0].key')
  reject(manifest({ actions: [httpAction(), httpAction()] }), 'actions[1].key')
})

test('descrição rasa é rejeitada: é o que ensina o modelo a usar a ação', () => {
  reject(manifest({ actions: [httpAction({ description: 'busca' })] }), 'actions[0].description')
})

test('risk precisa ser declarado corretamente', () => {
  reject(manifest({ actions: [httpAction({ risk: 'perigoso' })] }), 'actions[0].risk')
  accept(manifest({ actions: [httpAction({ risk: 'high_risk' })] }))
})

test('inputSchema precisa ser um JSON Schema de objeto', () => {
  reject(manifest({ actions: [httpAction({ inputSchema: { type: 'string' } })] }), 'inputSchema')
  reject(manifest({ actions: [httpAction({ inputSchema: 'numero' })] }), 'inputSchema')
  reject(manifest({ actions: [httpAction({ inputSchema: { type: 'object', required: 'numero' } })] }), 'inputSchema')
})

test('método HTTP inválido é rejeitado', () => {
  reject(manifest({ actions: [httpAction({ execution: { kind: 'http', method: 'TRACE', url: 'https://api.exemplo.com/x' } })] }), 'method')
})

// --- domínios -----------------------------------------------------------------

test('a ação só pode alcançar um host declarado em allowedDomains', () => {
  reject(manifest({ actions: [httpAction({ execution: { kind: 'http', method: 'GET', url: 'https://outro.com/x' } })] }), 'execution.url')
  // Subdomínio do domínio declarado é permitido.
  accept(manifest({ actions: [httpAction({ execution: { kind: 'http', method: 'GET', url: 'https://v2.api.exemplo.com/x' } })] }))
  // Sufixo colado NÃO é subdomínio.
  reject(manifest({ actions: [httpAction({ execution: { kind: 'http', method: 'GET', url: 'https://evilapi.exemplo.com.br/x' } })] }), 'execution.url')
})

test('allowedDomains aceita hostname e recusa protocolo, caminho, porta e curinga', () => {
  for (const bad of ['https://api.exemplo.com', 'api.exemplo.com/v1', 'api.exemplo.com:443', '*.exemplo.com', 'localhost', '10.0.0.1']) {
    reject(manifest({ allowedDomains: [bad], actions: [] }), 'allowedDomains')
  }
})

test('url malformada é rejeitada', () => {
  reject(manifest({ actions: [httpAction({ execution: { kind: 'http', method: 'GET', url: 'nao-e-url' } })] }), 'execution.url')
})

// --- templates ----------------------------------------------------------------

test('template com conteúdo executável é rejeitado', () => {
  const executable = [
    'javascript:alert(1)',
    '<script>fetch("https://x")</script>',
    'function (x) { return x }',
    '(x) => x',
    'require("fs")',
    'import("fs")',
  ]
  for (const payload of executable) {
    reject(
      manifest({ actions: [httpAction({ execution: { kind: 'http', method: 'POST', url: 'https://api.exemplo.com/x', bodyTemplate: payload } })] }),
      'bodyTemplate',
    )
  }
})

test('credencial não pode ser interpolada na url', () => {
  for (const token of ['{{secret}}', '{{apiKey}}', '{{api_key}}', '{{token}}', '{{password}}']) {
    reject(
      manifest({ actions: [httpAction({ execution: { kind: 'http', method: 'GET', url: `https://api.exemplo.com/x?k=${token}` } })] }),
      'execution.url',
    )
  }
  // Um parâmetro comum continua permitido.
  accept(manifest({ actions: [httpAction({ execution: { kind: 'http', method: 'GET', url: 'https://api.exemplo.com/x?n={{numero}}' } })] }))
})

// --- privilégio de sistema ----------------------------------------------------

test('somente App do sistema pode apontar para adapter compilado', () => {
  const native = { kind: 'native', adapter: 'google.calendar.createEvent' }
  reject(manifest({ actions: [httpAction({ execution: native })] }), 'actions[0].execution')
  reject(manifest({ source: 'community', actions: [httpAction({ execution: native })] }), 'actions[0].execution')
  accept(manifest({ source: 'system', actions: [httpAction({ execution: native })] }))
})

test('somente App do sistema pode usar oauth2', () => {
  reject(manifest({ auth: { kind: 'oauth2', fields: [] } }), 'auth.kind')
  accept(manifest({ source: 'system', auth: { kind: 'oauth2', fields: [], scopes: ['calendar'] } }))
})

test('auth.kind desconhecido é rejeitado', () => {
  reject(manifest({ auth: { kind: 'jwt', fields: [] } }), 'auth.kind')
})

// --- superfícies --------------------------------------------------------------

const surface = (over = {}) => ({
  key: 'inbox',
  label: 'Caixa de entrada',
  description: 'Conversas recebidas',
  kind: 'native',
  scope: 'account',
  routeSegment: 'inbox',
  ...over,
})

test('página nativa é privilégio de App do sistema', () => {
  reject(manifest({ surfaces: [surface()] }), 'surfaces[0].kind')
  accept(manifest({ source: 'system', surfaces: [surface()] }))
})

test('página declarativa de App privado/comunitário ainda não é suportada', () => {
  reject(manifest({ surfaces: [surface({ kind: 'declarative' })] }), 'surfaces[0].kind')
  reject(manifest({ source: 'community', surfaces: [surface({ kind: 'declarative' })] }), 'surfaces[0].kind')
})

test('routeSegment é identificador, nunca caminho, url ou traversal', () => {
  for (const bad of ['../admin', '/inbox', 'https://x.com', 'in box', 'Inbox', 'a/b']) {
    reject(manifest({ source: 'system', surfaces: [surface({ routeSegment: bad })] }), 'routeSegment')
  }
})

test('scope de página precisa ser conhecido', () => {
  reject(manifest({ source: 'system', surfaces: [surface({ scope: 'global' })] }), 'surfaces[0].scope')
})

test('key de página duplicada é rejeitada', () => {
  reject(manifest({ source: 'system', surfaces: [surface(), surface()] }), 'surfaces[1].key')
})

test('defaultSurfaceKey precisa existir em surfaces', () => {
  reject(manifest({ source: 'system', surfaces: [surface()], sidebar: { pinnable: true, defaultSurfaceKey: 'nao_existe' } }), 'sidebar.defaultSurfaceKey')
  accept(manifest({ source: 'system', surfaces: [surface()], sidebar: { pinnable: true, defaultSurfaceKey: 'inbox' } }))
})

test('App sem páginas não pode ser fixado na barra lateral', () => {
  reject(manifest({ sidebar: { pinnable: true, defaultSurfaceKey: 'inbox' } }), 'sidebar')
})

// --- import/export ------------------------------------------------------------

test('import nunca cria App do sistema nem publica sozinho', () => {
  const { manifest: imported, errors } = sanitizeImportedManifest({ ...manifest(), source: 'system', status: 'published' })
  assert.ok(imported, describeManifestIssues(errors))
  assert.equal(imported.source, 'private')
  assert.equal(imported.status, 'draft')
})

test('import descarta páginas e campos desconhecidos', () => {
  const { manifest: imported, errors } = sanitizeImportedManifest({
    ...manifest(),
    surfaces: [surface()],
    sidebar: { pinnable: true, defaultSurfaceKey: 'inbox' },
    ownerId: 'outro-usuario',
    encryptedConfig: 'segredo',
  })
  assert.ok(imported, describeManifestIssues(errors))
  assert.equal(imported.surfaces, undefined)
  assert.equal(imported.sidebar, undefined)
  assert.equal(imported.ownerId, undefined)
  assert.equal(imported.encryptedConfig, undefined)
})

test('import não consegue trazer adapter nativo por nenhum caminho', () => {
  const { manifest: imported, errors } = sanitizeImportedManifest({
    ...manifest(),
    actions: [httpAction({ execution: { kind: 'native', adapter: 'google.calendar.createEvent' } })],
  })
  // O adapter é descartado na normalização (vira http sem url) e o manifesto é rejeitado.
  assert.equal(imported, null)
  assert.ok(errors.some((e) => e.path.includes('execution.url')), describeManifestIssues(errors))
})

test('import não traz valor de credencial, só a definição do campo', () => {
  const { manifest: imported } = sanitizeImportedManifest({
    ...manifest(),
    auth: { kind: 'api_key', fields: [{ key: 'apiKey', label: 'Chave', required: true, secret: true, value: 'sk-vazado-123' }] },
  })
  assert.ok(imported)
  assert.equal(imported.auth.fields[0].value, undefined)
  assert.ok(!JSON.stringify(imported).includes('sk-vazado-123'))
})

test('import de manifesto inválido devolve erros e nenhum manifesto', () => {
  const { manifest: imported, errors } = sanitizeImportedManifest({ ...manifest(), allowedDomains: ['*'], key: 'X' })
  assert.equal(imported, null)
  assert.ok(errors.length > 0)
})

test('export devolve manifesto reimportável e sem nada da conta', () => {
  const exported = exportableManifest({ ...manifest(), status: 'published', surfaces: [surface()], sidebar: { pinnable: true, defaultSurfaceKey: 'inbox' } })
  assert.equal(exported.status, 'draft')
  assert.equal(exported.surfaces, undefined)
  assert.equal(exported.sidebar, undefined)
  const { manifest: reimported, errors } = sanitizeImportedManifest(exported)
  assert.ok(reimported, describeManifestIssues(errors))
  assert.equal(reimported.key, 'loja_exemplo')
  assert.equal(reimported.actions.length, 1)
})

// --- limites ------------------------------------------------------------------

test('manifesto com ações ou páginas demais é rejeitado', () => {
  const many = Array.from({ length: 61 }, (_, i) => httpAction({ key: `acao_${i}` }))
  reject(manifest({ actions: many }), 'actions')
  const surfaces = Array.from({ length: 13 }, (_, i) => surface({ key: `p_${i}`, routeSegment: `p-${i}` }))
  reject(manifest({ source: 'system', surfaces }), 'surfaces')
})

test('describeManifestIssues produz uma linha legível', () => {
  const r = validateAppManifest(manifest({ key: 'X' }))
  assert.match(describeManifestIssues(r.errors), /key: /)
})
