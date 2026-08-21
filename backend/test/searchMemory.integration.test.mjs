// A memória das buscas — e a armadilha que ela cria.
//
// Guardar o que a busca leu evita pesquisar duas vezes a mesma coisa. Mas cria um risco
// que o prazo de validade sozinho NÃO resolve:
//
//   Uma página lida ontem diz "hoje o produto custa R$ 10". Amanhã alguém pergunta
//   "quanto custa hoje?". A página casa perfeitamente com a pergunta — inclusive na
//   palavra "hoje" — e o agente responde o valor de ontem com a convicção de quem tem
//   fonte.
//
// Três defesas, e este arquivo prova as três: a pergunta sobre AGORA não aceita memória
// de busca; a idade acompanha cada trecho que chega ao modelo; e o que venceu não
// responde nem por semelhança nem por texto exato.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
delete process.env.VOYAGE_API_KEY

const { wantsCurrentInfo, shouldSearch, normalizeWebSearch, WEB_SEARCH_LIMITS } = await import('../dist/webSearch/policy.js')
const { rememberSearchPages, searchDocRef } = await import('../dist/webSearch/memory.js')
const { listDocumentsFor, retrieveContext } = await import('../dist/knowledge.js')
const { formatContextWithSources } = await import('../dist/retrievalQuery.js')
const { agentSearchStats, recordSearchEvent, resetSearchBudget } = await import('../dist/webSearch/budget.js')
const { mongoClient, db } = await import('../dist/db.js')

const OWNER = 'dono-memoria'

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await db.collection('knowledge_documents').deleteMany({})
  await resetSearchBudget('brave')
})

/** Uma página lida, no formato que o leitor devolve. */
const pagina = (url, texto, over = {}) => ({
  ok: true,
  url,
  readMethod: 'http',
  reason: 'ok',
  kind: 'article',
  strategies: [],
  contentType: 'text/html',
  capturedAt: new Date().toISOString(),
  links: [],
  text: texto,
  html: '',
  contentHash: `h-${texto.length}-${url}`,
  metadata: {
    title: `Página ${url}`,
    canonicalUrl: url,
    domain: 'exemplo.test',
    author: null,
    publishedAt: null,
    modifiedAt: null,
    usefulChars: texto.length,
    status: 200,
  },
  ...over,
})

// --- a pergunta sobre AGORA -------------------------------------------------------------------

test('reconhece a pergunta que pede o estado de agora', () => {
  for (const p of [
    'qual o valor do produto hoje?',
    'qual o preço atual',
    'me diga a cotação de hoje',
    'qual a última atualização',
    'como está agora',
    'o que saiu nesta semana',
  ]) {
    assert.equal(wantsCurrentInfo(p), true, p)
  }
  // E não confunde com pergunta atemporal.
  for (const p of ['qual a política de trocas', 'como funciona o processo de compra', 'quem fundou a empresa']) {
    assert.equal(wantsCurrentInfo(p), false, p)
  }
})

test('nenhum assunto entra na regra — só palavras de TEMPO', () => {
  // A detecção não pode conhecer ramo de negócio nenhum: ela é sobre quando, não sobre o quê.
  assert.equal(wantsCurrentInfo('qual o valor do açúcar'), false)
  assert.equal(wantsCurrentInfo('qual o valor do açúcar hoje'), true)
  assert.equal(wantsCurrentInfo('cotação do dólar'), false)
  assert.equal(wantsCurrentInfo('cotação do dólar agora'), true)
})

test('pergunta sobre AGORA não se contenta com uma página que um buscador trouxe', () => {
  const cfg = normalizeWebSearch({ enabled: true, policy: 'fallback_only' })
  // A base respondeu — mas só com memória de busca. Este é o caso do "valor de ontem".
  const arriscado = shouldSearch(cfg, { grounding: 'ok', passages: 3, canSearch: true, wantsCurrent: true, onlySearchMemory: true })
  assert.equal(arriscado.search, true)
  assert.match(arriscado.reason, /a pergunta é sobre agora/)

  // A mesma base, pergunta atemporal: aí a memória serve e nada é gasto.
  const tranquilo = shouldSearch(cfg, { grounding: 'ok', passages: 3, canSearch: true, wantsCurrent: false, onlySearchMemory: true })
  assert.equal(tranquilo.search, false)
})

test('o que o DONO curou não entra na regra: é responsabilidade dele', () => {
  const cfg = normalizeWebSearch({ enabled: true, policy: 'fallback_only' })
  // `onlySearchMemory: false` = há documento manual ou site cadastrado entre as fontes.
  const r = shouldSearch(cfg, { grounding: 'ok', passages: 2, canSearch: true, wantsCurrent: true, onlySearchMemory: false })
  assert.equal(r.search, false, 'quem escreveu o documento decide quando ele vale')
})

// --- a idade acompanha o trecho ------------------------------------------------------------------

test('cada trecho chega ao modelo com a data em que foi lido', () => {
  const [texto] = formatContextWithSources(
    ['hoje o produto custa R$ 10'],
    [{ documentId: 'd1', title: 'Tabela', capturedAt: '2026-08-19T10:00:00.000Z', origin: 'search' }],
  )
  assert.match(texto, /lido em 2026-08-19/)
  assert.match(texto, /encontrado por busca/)
  // Sem a data, "hoje" no texto seria lido como o hoje de quem pergunta.
  assert.match(texto, /hoje o produto custa/)
})

test('documento sem data de captura continua sendo citável, sem inventar idade', () => {
  const [texto] = formatContextWithSources(['um trecho'], [{ documentId: 'd1', title: 'Nota' }])
  assert.match(texto, /\[1\] Nota/)
  assert.ok(!/lido em/.test(texto))
})

// --- guardar sem duplicar e sem repagar ------------------------------------------------------------

test('a página lida vira documento da base, com procedência e prazo', async () => {
  const agentId = new ObjectId()
  const r = await rememberSearchPages(agentId, OWNER, 'relatório do trimestre', [pagina('https://exemplo.test/a', 'O relatório do trimestre apontou crescimento.')], 7)

  assert.equal(r.saved, 1)
  const [doc] = await listDocumentsFor({ ownerType: 'agent', ownerId: agentId })
  assert.equal(doc.web.discoveredBy, 'search', 'distinguir do que o dono cadastrou é o que governa a confiança')
  assert.equal(doc.web.query, 'relatório do trimestre')
  assert.ok(doc.web.expiresAt instanceof Date)
  assert.equal(doc.sourceRef, searchDocRef('https://exemplo.test/a'))

  const salvo = await db.collection('knowledge_documents').findOne({ _id: doc._id })
  assert.match(salvo.content, /Encontrado por busca/)
  assert.match(salvo.content, /Fonte: https:\/\/exemplo.test\/a/)
})

test('a mesma página achada de novo não vira segunda cópia nem custa embedding', async () => {
  const agentId = new ObjectId()
  const p = pagina('https://exemplo.test/a', 'Texto que não mudou entre as duas buscas.')
  await rememberSearchPages(agentId, OWNER, 'primeira pergunta', [p], 7)
  const segunda = await rememberSearchPages(agentId, OWNER, 'outra pergunta', [p], 7)

  assert.equal(segunda.saved, 0)
  assert.equal(segunda.unchanged, 1, 'o hash do texto decide: página igual não é reescrita')
  assert.equal((await listDocumentsFor({ ownerType: 'agent', ownerId: agentId })).length, 1)
})

test('reencontrar a página ESTICA o prazo — ela continua valendo', async () => {
  const agentId = new ObjectId()
  const p = pagina('https://exemplo.test/a', 'Conteúdo estável.')
  await rememberSearchPages(agentId, OWNER, 'pergunta', [p], 1)
  const antes = (await listDocumentsFor({ ownerType: 'agent', ownerId: agentId }))[0].web.expiresAt

  await new Promise((r) => setTimeout(r, 20))
  await rememberSearchPages(agentId, OWNER, 'pergunta', [p], 7)
  const depois = (await listDocumentsFor({ ownerType: 'agent', ownerId: agentId }))[0].web.expiresAt
  assert.ok(depois > antes, 'reencontrar é a prova de que a página ainda existe')
})

test('página que mudou é atualizada, não duplicada', async () => {
  const agentId = new ObjectId()
  await rememberSearchPages(agentId, OWNER, 'p', [pagina('https://exemplo.test/a', 'Valor antigo do produto.')], 7)
  const r = await rememberSearchPages(agentId, OWNER, 'p', [pagina('https://exemplo.test/a', 'Valor NOVO do produto, corrigido.')], 7)
  assert.equal(r.updated, 1)
  assert.equal((await listDocumentsFor({ ownerType: 'agent', ownerId: agentId })).length, 1)
})

test('prazo zero = não guardar nada. É uma escolha legítima.', async () => {
  const agentId = new ObjectId()
  const r = await rememberSearchPages(agentId, OWNER, 'p', [pagina('https://exemplo.test/a', 'texto')], 0)
  assert.deepEqual(r, { saved: 0, updated: 0, unchanged: 0 })
  assert.equal((await listDocumentsFor({ ownerType: 'agent', ownerId: agentId })).length, 0)
  assert.equal(normalizeWebSearch({ enabled: true, rememberDays: 0 }).rememberDays, 0)
  assert.equal(normalizeWebSearch({ enabled: true }).rememberDays, WEB_SEARCH_LIMITS.rememberDays.padrao)
})

// --- o que VENCEU não responde -----------------------------------------------------------------

test('página vencida sai da busca — nem por texto exato ela volta', async () => {
  const agentId = new ObjectId()
  await rememberSearchPages(agentId, OWNER, 'preço do produto', [pagina('https://exemplo.test/a', 'Hoje o produto custa dez reais na tabela oficial.')], 7)

  // Ela responde enquanto vale.
  const valendo = await retrieveContext([agentId], 'Página https exemplo tabela oficial produto')
  assert.equal(valendo.status, 'ok')

  // Vencida, some — e o agente volta a não ter resposta, que é o certo.
  await db.collection('knowledge_documents').updateMany({}, { $set: { 'web.expiresAt': new Date(Date.now() - 1000) } })
  const vencida = await retrieveContext([agentId], 'Página https exemplo tabela oficial produto')
  assert.notEqual(vencida.status, 'ok', 'responder com página vencida é pior que não responder')
  assert.equal(vencida.context.length, 0)
})

test('documento sem prazo (o que o dono curou) nunca expira', async () => {
  const agentId = new ObjectId()
  const { createDocumentFor } = await import('../dist/knowledge.js')
  await createDocumentFor({ ownerType: 'agent', ownerId: agentId }, { title: 'Política de trocas', content: 'A troca pode ser feita em 30 dias.' })
  const r = await retrieveContext([agentId], 'política de trocas')
  assert.equal(r.status, 'ok', 'a ausência de prazo é o comportamento de sempre')
})

// --- a contagem que o bloco mostra ----------------------------------------------------------------

test('o painel do pesquisador conta o que gastou E o que evitou gastar', async () => {
  const agentId = new ObjectId().toString()
  await recordSearchEvent({
    agentId, ownerId: OWNER, provider: 'brave', query: 'primeira', performed: true,
    found: 8, pagesRead: 3, evidence: 4, saved: 3, ok: true, durationMs: 900,
  })
  await recordSearchEvent({
    agentId, ownerId: OWNER, provider: 'brave', query: 'segunda', performed: true,
    found: 5, pagesRead: 2, evidence: 2, saved: 1, ok: false, code: 'search_failed', durationMs: 400,
  })
  await recordSearchEvent({
    agentId, ownerId: OWNER, provider: 'brave', query: 'terceira', performed: false,
    skipReason: 'a base já respondeu', found: 0, pagesRead: 0, evidence: 0, saved: 0, ok: true, durationMs: 0,
  })

  const s = await agentSearchStats(agentId)
  assert.equal(s.searchesThisMonth, 2)
  assert.equal(s.avoidedThisMonth, 1, 'a busca evitada é a economia de ter memória')
  assert.equal(s.pagesRead, 5)
  assert.equal(s.documentsSaved, 4)
  assert.equal(s.failures, 1)
  assert.equal(s.lastQuery, 'segunda')
  assert.ok(s.lastSearchAt)
})

test('a contagem é por AGENTE: um pesquisador não vê o gasto do outro', async () => {
  const a = new ObjectId().toString()
  const b = new ObjectId().toString()
  await recordSearchEvent({ agentId: a, ownerId: OWNER, provider: 'brave', query: 'x', performed: true, found: 1, pagesRead: 1, evidence: 1, saved: 1, ok: true, durationMs: 1 })
  assert.equal((await agentSearchStats(b)).searchesThisMonth, 0)
  assert.equal((await agentSearchStats(a)).searchesThisMonth, 1)
})
