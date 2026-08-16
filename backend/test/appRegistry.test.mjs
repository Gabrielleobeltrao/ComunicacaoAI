// The system catalog has to obey the same manifest rules a private App does — the
// only extra privilege is pointing at a compiled adapter. If a system manifest could
// not pass validation, the contract would be decorative.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/app-registry-test'
process.env.ENCRYPTION_KEY ||= 'test-encryption-key'

const { SYSTEM_APPS, getApp, getAppAction, resolveAppKey, LEGACY_ACTION_KEYS, splitLegacyConfig, appCatalogPublic } = await import(
  '../dist/apps/registry.js'
)
const { validateAppManifest, describeManifestIssues } = await import('../dist/apps/manifest.js')
const { toInstallation, installationPublic, normalizeConfig, maskAccount, LEGACY_APP_VERSION } = await import('../dist/apps/installations.js')

test('todo manifesto do catálogo do sistema é válido', () => {
  for (const app of SYSTEM_APPS) {
    const r = validateAppManifest(app)
    assert.equal(r.valid, true, `${app.key}: ${describeManifestIssues(r.errors)}`)
  }
})

test('o catálogo cobre todos os Apps que já existiam', () => {
  const keys = SYSTEM_APPS.map((a) => a.key)
  for (const expected of ['google', 'slack', 'mercadopago', 'rdstation', 'hubspot', 'stripe', 'nuvemshop', 'email', 'telegram']) {
    assert.ok(keys.includes(expected), `faltou ${expected}`)
  }
})

test('as chaves antigas do catálogo continuam resolvendo', () => {
  assert.equal(resolveAppKey('google_calendar'), 'google')
  assert.equal(resolveAppKey('google_sheets'), 'google')
  assert.equal(resolveAppKey('slack'), 'slack')
  assert.equal(getApp('google_calendar')?.key, 'google')
})

test('os nomes de ação continuam sendo os que o modelo já conhece', () => {
  // Renomear qualquer um destes quebraria prompts, rotinas e testes existentes.
  const existentes = [
    'google_agenda_verificar_disponibilidade',
    'google_agenda_listar_eventos',
    'google_agenda_criar_evento',
    'google_sheets_registrar',
    'slack_notificar',
    'mercadopago_criar_link_pagamento',
    'rdstation_registrar_contato',
    'hubspot_registrar_contato',
    'stripe_criar_link_pagamento',
    'nuvemshop_status_pedido',
  ]
  const declaradas = SYSTEM_APPS.flatMap((a) => a.actions.map((x) => x.key))
  for (const name of existentes) assert.ok(declaradas.includes(name), `faltou a ação ${name}`)
})

test('cada entrada legada de builtinTools mapeia exatamente para as ações que ela liberava', () => {
  for (const [legacyKey, actionKeys] of Object.entries(LEGACY_ACTION_KEYS)) {
    for (const actionKey of actionKeys) {
      assert.ok(getAppAction(legacyKey, actionKey), `${legacyKey} → ${actionKey} não existe no catálogo`)
    }
  }
})

test('escrita e leitura são distinguidas por ação', () => {
  assert.equal(getAppAction('google', 'google_agenda_listar_eventos')?.risk, 'read')
  assert.equal(getAppAction('google', 'google_agenda_criar_evento')?.risk, 'write')
  assert.equal(getAppAction('nuvemshop', 'nuvemshop_status_pedido')?.risk, 'read')
})

test('config legada é separada entre credencial e seleção não secreta', () => {
  const sheets = splitLegacyConfig('google_sheets', { spreadsheetId: '1AbC', sheetName: 'Leads', columns: 'Nome, Telefone' })
  // Google não tem campo de credencial no manifesto: tudo é seleção de recurso.
  assert.deepEqual(sheets.credential, {})
  assert.equal(sheets.resource.spreadsheetId, '1AbC')

  const st = splitLegacyConfig('stripe', { secretKey: 'sk_test_123', successUrl: 'https://loja.com/ok' })
  assert.equal(st.credential.secretKey, 'sk_test_123')
  assert.equal(st.resource.successUrl, 'https://loja.com/ok')
  assert.equal(st.resource.secretKey, undefined)

  const ns = splitLegacyConfig('nuvemshop', { storeId: '123', accessToken: 'tok' })
  // storeId também é campo de conexão declarado: vai junto da credencial.
  assert.equal(ns.credential.accessToken, 'tok')
  assert.equal(ns.credential.storeId, '123')
})

test('o DTO do catálogo não expõe adapter, componente nem valor de credencial', () => {
  for (const app of SYSTEM_APPS) {
    const dto = appCatalogPublic(app)
    const json = JSON.stringify(dto)
    assert.ok(!json.includes('adapter'), `${app.key} expôs adapter`)
    assert.ok(!json.includes('execution'), `${app.key} expôs execution`)
    for (const field of dto.auth.fields) assert.equal(field.value, undefined)
  }
})

test('o DTO do catálogo mostra o que o dono precisa saber antes de conectar', () => {
  const dto = appCatalogPublic(getApp('google'))
  assert.deepEqual(dto.allowedDomains, ['googleapis.com', 'accounts.google.com'])
  assert.ok(dto.auth.scopes.length > 0)
  assert.ok(dto.dataAccess.length > 0)
  assert.ok(dto.disconnectNote)
  assert.equal(dto.requiresAuth, true)
  assert.ok(dto.actions.every((a) => a.risk))
})

// --- instalação ----------------------------------------------------------------

test('um documento antigo de connections continua legível como instalação', () => {
  const legacy = {
    _id: 'abc',
    ownerId: 'u1',
    buildingId: 'b1',
    provider: 'email',
    name: 'SMTP principal',
    status: 'connected',
    encryptedConfig: 'cifrado',
    publicMetadata: { from: 'nao-responda@loja.com' },
    scopes: [],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-02'),
  }
  const inst = toInstallation(legacy)
  assert.equal(inst.appKey, 'email')
  assert.equal(inst.appVersion, LEGACY_APP_VERSION)
  assert.equal(inst.status, 'connected')
  // O campo antigo continua legível: o fluxo de entregas ainda resolve por provider.
  assert.equal(inst.provider, 'email')
})

test('status desconhecido em documento antigo não vira status inválido', () => {
  const inst = toInstallation({ _id: 'x', ownerId: 'u1', provider: 'telegram', status: 'whatever' })
  assert.equal(inst.status, 'connected')
})

test('o DTO público da instalação não tem onde carregar um segredo', () => {
  const inst = toInstallation({
    _id: { toString: () => 'i1' },
    ownerId: 'u1',
    appKey: 'stripe',
    name: 'Stripe da loja',
    encryptedConfig: 'CIFRADO-SUPER-SECRETO',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  })
  const dto = installationPublic(inst)
  const json = JSON.stringify(dto)
  assert.ok(!json.includes('CIFRADO'))
  assert.equal(dto.encryptedConfig, undefined)
  assert.equal(dto.appKey, 'stripe')
})

test('normalizeConfig exige o que o manifesto declara e descarta o resto', () => {
  const app = getApp('nuvemshop')
  const config = normalizeConfig(app, { storeId: '123', accessToken: 'tok', extra: 'nao-declarado' })
  assert.deepEqual(config, { storeId: '123', accessToken: 'tok' })
  assert.throws(() => normalizeConfig(app, { storeId: '123' }), /Access Token/)
})

test('App sem credencial aceita config vazia', () => {
  assert.deepEqual(normalizeConfig(getApp('google'), undefined), {})
})

test('a conta é mostrada mascarada', () => {
  assert.equal(maskAccount('gabriel@loja.com'), 'ga***@loja.com')
  assert.equal(maskAccount('5511999998888'), '55***88')
  assert.equal(maskAccount('abc'), '***')
})
