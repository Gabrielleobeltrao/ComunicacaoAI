// O CATÁLOGO VIVO: o que o Arquiteto pode propor é o que o sistema tem.
//
// O teste que importa aqui é o de DERIVA. Uma lista de capacidades escrita à mão no
// prompt envelhece sozinha: continua oferecendo o App que foi removido e não sabe da
// função que entrou ontem. O modelo propõe, a pessoa aprova, e a aplicação quebra em
// cima de um recurso que não existe.
//
// Por isso cada afirmação abaixo compara o manifesto com a FONTE REAL — os presets, o
// resolvedor de papéis que o runtime consulta, o registro de funções e o catálogo de
// Apps. Se alguém acrescentar um perfil e esquecer o manifesto, é aqui que aparece.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'chave-de-teste-do-manifesto-1a2b3c4d'

const { mongoClient, db } = await import('../dist/db.js')
const { buildCapabilityManifest, manifestForPrompt } = await import('../dist/architect/capabilities.js')
const { AGENT_PRESET_SPECS } = await import('../dist/agentPresets.js')
const { roleUIConfigOf } = await import('../dist/agentCapabilities.js')
const { listPublicFunctions } = await import('../dist/executors/functionRegistry.js')
const { OFFICIAL_APPS } = await import('../dist/apps/official/index.js')
const { SECTOR_MODES } = await import('../dist/sectors.js')
const { ACTIVATION_MODES } = await import('../dist/agents.js')

const DONO = 'dono-manifesto'

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  for (const c of ['connections', 'app_installations', 'tools']) await db.collection(c).deleteMany({})
})

test('todo perfil do sistema está no manifesto — e nenhum inventado', async () => {
  const m = await buildCapabilityManifest(DONO)
  assert.deepEqual(
    m.presets.map((p) => p.preset).sort(),
    AGENT_PRESET_SPECS.map((p) => p.preset).sort(),
  )
})

test('as capacidades de cada perfil vêm do MESMO resolvedor que o runtime usa', async () => {
  const m = await buildCapabilityManifest(DONO)
  for (const p of m.presets) {
    const doRuntime = roleUIConfigOf({ preset: p.preset }).capabilities
    // `=== true`: o registro de capacidades carrega junto o nome do papel, os conflitos
    // herdados e o resumo. Todos são "verdadeiros" em JavaScript e nenhum é capacidade —
    // sem este filtro o manifesto anunciava "summary" como se fosse algo que o agente faz.
    const esperadas = Object.entries(doRuntime)
      .filter(([, ligada]) => ligada === true)
      .map(([nome]) => nome)
      .sort()
    // Uma segunda tabela aqui divergiria na primeira mudança de papel — e a divergência
    // aparece como "o Arquiteto propôs algo que o agente não consegue fazer".
    assert.deepEqual([...p.capabilities].sort(), esperadas, p.preset)
    // E o que sai é capacidade DE VERDADE, não campo do registro.
    for (const proibido of ['role', 'summary', 'legacyConflicts']) {
      assert.equal(p.capabilities.includes(proibido), false, `${p.preset} anunciou "${proibido}" como capacidade`)
    }
  }
})

test('funções, modos de setor e acionamentos são os do sistema', async () => {
  const m = await buildCapabilityManifest(DONO)
  assert.deepEqual(
    m.functions.map((f) => f.functionName).sort(),
    listPublicFunctions().map((f) => f.functionName).sort(),
  )
  assert.ok(m.functions.length > 0, 'o registro de funções está vazio: o teste não provaria nada')
  assert.deepEqual(m.sectorModes.map((s) => s.mode).sort(), [...SECTOR_MODES].sort())
  assert.deepEqual(m.activationModes, [...ACTIVATION_MODES])
})

test('os Apps e as AÇÕES são os do catálogo, com o risco declarado por eles', async () => {
  const m = await buildCapabilityManifest(DONO)
  assert.deepEqual(m.apps.map((a) => a.key).sort(), OFFICIAL_APPS.map((a) => a.key).sort())

  for (const app of OFFICIAL_APPS) {
    const noManifesto = m.apps.find((a) => a.key === app.key)
    assert.deepEqual(
      noManifesto.actions.map((a) => a.key).sort(),
      (app.actions ?? []).map((a) => a.key).sort(),
      `ações de ${app.key}`,
    )
    // O risco vem do manifesto do App. Classificar por heurística aqui seria uma
    // segunda fonte de verdade sobre o que é perigoso — e a cópia é sempre a que erra.
    for (const acao of noManifesto.actions) {
      const real = (app.actions ?? []).find((x) => x.key === acao.key)
      assert.equal(acao.risk, real.risk, `${app.key}.${acao.key}`)
    }
  }
})

test('o manifesto é da CONTA: o que está conectado muda entre donos', async () => {
  const semNada = await buildCapabilityManifest(DONO)
  assert.equal(semNada.apps.every((a) => !a.connected), true)
  assert.equal(semNada.channels.every((c) => !c.connected), true)

  await db.collection('connections').insertOne({ ownerId: DONO, appKey: 'web_chat', status: 'connected', name: 'Chat Web', createdAt: new Date(), updatedAt: new Date() })
  const comChat = await buildCapabilityManifest(DONO)
  assert.equal(comChat.apps.find((a) => a.key === 'web_chat').connected, true)
  assert.equal(comChat.channels.find((c) => c.key === 'web_chat').connected, true)

  // E não vaza para o vizinho: propor "já está conectado" para quem não conectou é
  // prometer uma operação que não sobe.
  const vizinho = await buildCapabilityManifest('outro-dono')
  assert.equal(vizinho.apps.find((a) => a.key === 'web_chat').connected, false)
})

test('o texto do prompt diz o que existe, e marca a ação sensível', async () => {
  const m = await buildCapabilityManifest(DONO)
  const texto = manifestForPrompt(m)

  assert.match(texto, /nada fora disto pode ser proposto/)
  for (const p of m.presets) assert.match(texto, new RegExp(`"${p.preset}"`), p.preset)
  for (const e of ['"llm"', '"function"', '"tool"']) assert.ok(texto.includes(e), e)

  // A ação de alto risco precisa chegar marcada: é ela que exige aprovação humana.
  const comRisco = m.apps.find((a) => a.actions.some((x) => x.risk === 'high_risk'))
  if (comRisco) {
    assert.match(texto, /ação sensível/)
  }
  // E o texto não carrega credencial: o manifesto fala de nomes e ações, nunca de
  // configuração conectada. (O padrão evita "secretary", que é um perfil legítimo.)
  assert.doesNotMatch(texto, /\bsk-[A-Za-z0-9]|Bearer |\bpassword\b|api[_-]?key\s*[:=]/i)
})
