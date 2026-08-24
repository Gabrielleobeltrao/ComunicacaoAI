// A busca na web acontece em TODO caminho — ou em nenhum.
//
// O defeito relatado em produção: o interruptor marcado, o provedor configurado, e o
// agente respondendo só com o que já estava guardado. Nada falhava. A busca vivia dentro
// de `runAgentTask`, e `runAgentTask` é alcançado por dois caminhos — setor e delegação.
// Os outros três (teste do agente, canal, rotina) montam o próprio contexto e nunca
// passavam por lá.
//
// É o pior formato de defeito: sem erro, sem log, e indistinguível de "procurei e não
// achei". Estas provas fixam o passo compartilhado — e a de baixo varre o fonte, porque a
// próxima superfície que aparecer vai ter a mesma tentação de montar o contexto sozinha.
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
// Um provedor de mentira, mas CONFIGURADO: é o estado da produção do usuário.
process.env.WEB_SEARCH_PROVIDER = 'http'
process.env.WEB_SEARCH_URL = 'http://127.0.0.1:59999/buscar'

const { gatherWebEvidence } = await import('../dist/webSearch/step.js')
const { resolveProviderName, activeSearchProvider } = await import('../dist/webSearch/provider.js')
const { searchBudgetConfig } = await import('../dist/webSearch/budget.js')
const { db, mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await db.collection('web_search_events').deleteMany({}).catch(() => undefined)
})

const pesquisador = (over = {}) => ({
  _id: new ObjectId(),
  name: 'Vitória',
  webSearch: { enabled: true, policy: 'automatic', rememberDays: 7, maxPagesToRead: 2 },
  ...over,
})

// --- a configuração que o usuário tem em produção -----------------------------------------

test('as variáveis do Brave que existem são as que o código lê', () => {
  const antes = { ...process.env }
  process.env.WEB_SEARCH_PROVIDER = 'brave'
  process.env.BRAVE_SEARCH_API_KEY = 'chave-de-teste'
  process.env.BRAVE_MONTHLY_REQUEST_LIMIT = '900'
  process.env.BRAVE_PAID_USAGE_ENABLED = 'false'
  assert.equal(resolveProviderName(), 'brave')
  assert.ok(activeSearchProvider(), 'com a chave presente, o provedor precisa existir')
  const cfg = searchBudgetConfig()
  assert.equal(cfg.monthlyRequestLimit, 900)
  assert.equal(cfg.paidUsageEnabled, false)
  Object.assign(process.env, antes)
})

test('sem chave nenhuma o provedor é "none" — dito com todas as letras', () => {
  const antes = { ...process.env }
  delete process.env.WEB_SEARCH_PROVIDER
  delete process.env.BRAVE_SEARCH_API_KEY
  delete process.env.WEB_SEARCH_URL
  assert.equal(resolveProviderName(), 'none')
  assert.equal(activeSearchProvider(), null)
  Object.assign(process.env, antes)
})

// --- o passo compartilhado ------------------------------------------------------------------

test('com o interruptor DESLIGADO nada é procurado e nada é registrado', async () => {
  const r = await gatherWebEvidence(pesquisador({ webSearch: { enabled: false } }), 'dono', 'preço do açúcar hoje', {
    grounding: 'empty',
    passages: 0,
  })
  assert.deepEqual(r.evidence, [])
  assert.equal(await db.collection('web_search_events').countDocuments({}), 0, 'busca desligada não vira evento')
})

test('com o interruptor ligado e a base vazia, a busca é TENTADA — e o evento registra', async () => {
  // O provedor aponta para uma porta fechada: a busca falha, e é isso que o teste quer.
  // O que importa é que ela SAIU — antes ela nem era chamada.
  const r = await gatherWebEvidence(pesquisador(), 'dono', 'preço do açúcar hoje', { grounding: 'empty', passages: 0 })
  assert.deepEqual(r.evidence, [], 'a porta está fechada, então nada volta')
  const evento = await db.collection('web_search_events').findOne({ ownerId: 'dono' })
  assert.ok(evento, 'a tentativa precisa ficar registrada')
  assert.equal(evento.outcome, 'sent')
})

test('a busca EVITADA é registrada com o motivo — é ela que mostra a economia', async () => {
  const r = await gatherWebEvidence(pesquisador(), 'dono', 'qual é a política de troca', {
    grounding: 'ok',
    passages: 4,
    sourceOrigins: ['manual', 'manual'],
  })
  assert.equal(r.evidence.length, 0)
  assert.ok(r.skipped, 'o motivo de não ter procurado precisa existir')
  const evento = await db.collection('web_search_events').findOne({ ownerId: 'dono' })
  assert.equal(evento.outcome, 'avoided')
  assert.ok(evento.skipReason)
})

test('base respondida SÓ com memória de busca não impede uma pergunta sobre AGORA', async () => {
  // O que está guardado veio de uma busca anterior. Para "hoje", isso é justamente o que
  // não serve: o valor de ontem responde com a mesma cara de certo.
  const r = await gatherWebEvidence(pesquisador(), 'dono', 'quanto está a ação da VALE hoje', {
    grounding: 'ok',
    passages: 3,
    sourceOrigins: ['search', 'search'],
  })
  const evento = await db.collection('web_search_events').findOne({ ownerId: 'dono' })
  assert.equal(evento.outcome, 'sent', 'precisa procurar de novo')
  void r
})

// --- nenhum caminho monta o contexto sozinho ---------------------------------------------------

test('os CINCO caminhos chamam o mesmo passo — nenhum monta a busca por conta própria', () => {
  const caminhos = [
    ['delegation.ts (setor e delegação)', 'src/delegation.ts'],
    ['index.ts (teste do agente e canal)', 'src/index.ts'],
    ['routineExecution.ts (rotina e gatilho)', 'src/automations/routineExecution.ts'],
  ]
  for (const [nome, arquivo] of caminhos) {
    const codigo = readFileSync(arquivo, 'utf8')
    assert.ok(codigo.includes('gatherWebEvidence'), `${nome} não chama o passo compartilhado`)
    // `runWebSearch` direto seria uma segunda implementação: outra decisão de quando
    // buscar, outra contabilidade, outra trilha — e a divergência aparece em produção.
    assert.ok(!/\brunWebSearch\s*\(/.test(codigo), `${nome} chama a busca por fora do passo`)
  }
})

test('o teste do agente e o canal buscam para UM agente, e não quando é setor', () => {
  const codigo = readFileSync('src/index.ts', 'utf8')
  // Com setor, cada membro do time busca dentro do executor. Repetir aqui seria pagar
  // duas vezes pela mesma pergunta.
  assert.match(codigo, /!setorDoCanal && capabilitiesOf\(agent\)\.webSearch/)
})

test('procurar exige as DUAS coisas: o papel certo e o interruptor ligado', async () => {
  const { capabilitiesOf } = await import('../dist/agentCapabilities.js')
  const ligado = { enabled: true }
  // Só quem coleta pode; e mesmo ele só procura com o dono tendo ligado. Assim nenhum
  // agente existente passa a buscar por causa de uma versão nova.
  assert.equal(capabilitiesOf({ preset: 'researcher', webSearch: ligado }).webSearch, true)
  assert.equal(capabilitiesOf({ preset: 'researcher' }).webSearch, false, 'sem o interruptor, não')
  assert.equal(capabilitiesOf({ preset: 'analyst', webSearch: ligado }).webSearch, false, 'analista não coleta')
  assert.equal(capabilitiesOf({ preset: 'manager', webSearch: ligado }).webSearch, false, 'coordenador não coleta')
})
