// Os Apps oficiais, depois de virarem módulos.
//
// A divisão em `official/<app>/` só vale a pena se ela também FECHAR a porta que
// existia antes: manifesto num arquivo, adapter escrito à mão em outro, e nada
// conferindo que os dois combinam. Dava para adicionar um App e esquecer o adapter — o
// sintoma aparecia como "configuração incompleta" quando alguém tentava usar a ação,
// horas depois, no histórico.
//
// Este arquivo é a conferência. E também o contrato de compatibilidade: nenhuma key,
// versão ou action key pode ter mudado na mudança de arquivo, senão todo grant,
// instalação e migração já gravados apontariam para o nada.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { OFFICIAL_APPS, OFFICIAL_ADAPTERS, assertOfficialAppsConsistent, OfficialAppsError } = await import(
  '../dist/apps/official/index.js'
)
const { SYSTEM_APPS, getApp, getAppAction, LEGACY_APP_KEYS, LEGACY_ACTION_KEYS } = await import('../dist/apps/registry.js')

// --- compatibilidade: nada mudou de nome ------------------------------------------------

test('as keys dos Apps oficiais são exatamente as que já estavam gravadas', () => {
  // Um grant guarda `appKey`. Uma instalação guarda `appKey`. Renomear qualquer uma
  // delas transformaria configuração existente em referência morta.
  const esperadas = [
    'google',
    'slack',
    'mercadopago',
    'rdstation',
    'hubspot',
    'stripe',
    'nuvemshop',
    'candle_analyzer',
    'email',
    'telegram',
    'web_chat',
    'whatsapp',
  ]
  assert.deepEqual(
    OFFICIAL_APPS.map((a) => a.key),
    esperadas,
  )
})

test('a fachada continua devolvendo o mesmo catálogo', () => {
  // Metade do sistema importa de `registry.js`. A divisão não podia mexer nisso.
  assert.equal(SYSTEM_APPS.length, OFFICIAL_APPS.length)
  assert.deepEqual(SYSTEM_APPS.map((a) => a.key), OFFICIAL_APPS.map((a) => a.key))
})

test('as chaves legadas continuam resolvendo', () => {
  // Um agente configurado antes da unificação do Google ainda carrega `google_calendar`.
  assert.equal(getApp('google_calendar')?.key, 'google')
  assert.equal(getApp('google_sheets')?.key, 'google')
  assert.deepEqual(Object.keys(LEGACY_APP_KEYS).sort(), ['google_calendar', 'google_sheets'])
})

test('toda ação citada no mapa de migração ainda existe', () => {
  // `LEGACY_ACTION_KEYS` diz o que um `builtinTools` antigo virava. Uma action key que
  // sumisse aqui faria a migração conceder permissão para nada.
  for (const [legado, acoes] of Object.entries(LEGACY_ACTION_KEYS)) {
    for (const acao of acoes) {
      assert.ok(getAppAction(legado, acao), `${legado} → ${acao} não existe mais`)
    }
  }
})

test('as versões dos Apps que já existiam não mudaram', () => {
  // A versão é comparada contra a da instalação: subir uma sem motivo marcaria toda
  // conexão existente como "precisa ser revisada".
  for (const key of ['google', 'slack', 'mercadopago', 'rdstation', 'hubspot', 'stripe', 'nuvemshop', 'email', 'telegram', 'whatsapp']) {
    assert.equal(getApp(key)?.version, '1.0.0', `a versão de ${key} mudou`)
  }
})

// --- coerência entre manifesto e adapter --------------------------------------------------

test('todo App que declara ação nativa exporta o adapter dela', () => {
  for (const app of OFFICIAL_APPS) {
    const nativas = app.actions.filter((a) => a.execution.kind === 'native')
    if (nativas.length === 0) continue
    assert.ok(OFFICIAL_ADAPTERS[app.key]?.length, `${app.key} tem ação nativa e nenhum adapter`)
  }
})

test('todo adapter declarado por uma ação existe de fato', () => {
  // O defeito que a divisão existe para pegar: `execution.adapter` apontando para um
  // nome que nenhuma fábrica produz. Antes isso só aparecia em execução, como uma
  // recusa genérica de "configuração incompleta".
  //
  // A configuração é montada a partir dos `resourceFields` do próprio manifesto: alguns
  // adapters (o Sheets é um) só constroem a ferramenta quando a seleção de recurso está
  // preenchida — sem planilha escolhida, não há o que registrar. Passar `{}` testaria
  // uma situação que a execução real nunca tem.
  for (const app of OFFICIAL_APPS) {
    const fabricas = OFFICIAL_ADAPTERS[app.key] ?? []
    if (fabricas.length === 0) continue

    const config = {}
    for (const f of app.auth.fields ?? []) config[f.key] = 'valor-de-teste'
    for (const acao of app.actions) {
      for (const rf of acao.resourceFields ?? []) config[rf.key] = 'valor-de-teste'
    }

    const disponiveis = new Set(fabricas.flatMap((f) => f('owner-teste', config).map((t) => t.name)))
    for (const acao of app.actions) {
      if (acao.execution.kind !== 'native') continue
      assert.ok(disponiveis.has(acao.execution.adapter), `${app.key}/${acao.key} aponta para o adapter inexistente "${acao.execution.adapter}"`)
    }
  }
})

test('a conferência recusa um módulo sem adapter para ação nativa', () => {
  assert.throws(
    () =>
      assertOfficialAppsConsistent([
        { manifest: { key: 'x', source: 'system', actions: [{ key: 'a', execution: { kind: 'native', adapter: 'a' } }] } },
      ]),
    OfficialAppsError,
  )
})

test('a conferência recusa dois módulos com a mesma key', () => {
  const mod = { manifest: { key: 'x', source: 'system', actions: [] } }
  assert.throws(() => assertOfficialAppsConsistent([mod, mod]), /dois módulos/)
})

test('a conferência recusa um App que não é oficial dentro de official/', () => {
  // `source` decide o que o App pode declarar: só um oficial pode apontar para código
  // compilado. Um privado aqui dentro seria um caminho para executar código nativo.
  assert.throws(
    () => assertOfficialAppsConsistent([{ manifest: { key: 'x', source: 'private', actions: [] } }]),
    /source=system/,
  )
})

// --- as regras que separam oficial de privado ---------------------------------------------

test('todo App oficial é source=system', () => {
  for (const app of OFFICIAL_APPS) assert.equal(app.source, 'system', `${app.key} não é oficial`)
})

test('nenhum App oficial tem ação sem schema de entrada', () => {
  for (const app of OFFICIAL_APPS) {
    for (const acao of app.actions) {
      assert.equal(typeof acao.inputSchema, 'object', `${app.key}/${acao.key} sem schema`)
      assert.ok(acao.description.length > 20, `${app.key}/${acao.key}: a descrição é o que ensina o modelo QUANDO usar`)
    }
  }
})

test('toda ação de escrita declara risco, para exigir autorização', () => {
  // O risco é o que decide se a ação roda sozinha numa automação. Uma escrita marcada
  // como leitura rodaria sem ninguém autorizar.
  for (const app of OFFICIAL_APPS) {
    for (const acao of app.actions) {
      assert.ok(['read', 'write'].includes(acao.risk), `${app.key}/${acao.key}: risco inválido`)
    }
  }
})
