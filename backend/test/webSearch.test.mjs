// Procurar páginas NOVAS na internet — quando, quantas, e a que custo.
//
// A distinção que este arquivo protege: "sites cadastrados" é ler endereços que o dono
// escolheu; "busca na web" é descobrir endereços que ninguém escolheu. A segunda custa
// mais e erra mais, então ela é opcional, é só do pesquisador, e vem desligada.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { normalizeWebSearch, shouldSearch, WEB_SEARCH_LIMITS } = await import('../dist/webSearch/policy.js')
const { rankResults, runWebSearch } = await import('../dist/webSearch/run.js')
const { capabilitiesOf, roleUIConfigOf } = await import('../dist/agentCapabilities.js')

// --- o padrão preserva o que já existe ---------------------------------------------------

test('ausente é DESLIGADO: nenhum agente muda de comportamento por causa da versão nova', () => {
  assert.equal(normalizeWebSearch(undefined).enabled, false)
  assert.equal(normalizeWebSearch({}).enabled, false)
  assert.equal(normalizeWebSearch({ enabled: 'sim' }).enabled, false, 'só `true` liga')
})

test('os tetos do sistema mandam sobre a configuração do dono', () => {
  const absurdo = normalizeWebSearch({ enabled: true, maxSearchResults: 9999, maxPagesToRead: 500, maxCharsPerPage: 10 ** 9 })
  assert.equal(absurdo.maxSearchResults, WEB_SEARCH_LIMITS.maxSearchResults.max)
  assert.equal(absurdo.maxPagesToRead, WEB_SEARCH_LIMITS.maxPagesToRead.max)
  assert.equal(absurdo.maxCharsPerPage, WEB_SEARCH_LIMITS.maxCharsPerPage.max)
  // E os padrões do goal, quando ninguém escolhe.
  const padrao = normalizeWebSearch({ enabled: true })
  assert.equal(padrao.maxSearchResults, 10)
  assert.equal(padrao.maxPagesToRead, 5)
  assert.equal(padrao.maxCharsPerPage, 15_000)
  assert.equal(padrao.maxEvidenceChunks, 8)
})

// --- 1, 2, 7) quem pode ter a capacidade ------------------------------------------------------

test('1 e 2) só o pesquisador tem busca na web — e só com o interruptor ligado', () => {
  assert.equal(capabilitiesOf({ preset: 'researcher' }).webSearch, false, 'desligado é o padrão')
  assert.equal(capabilitiesOf({ preset: 'researcher', webSearch: { enabled: true } }).webSearch, true)
  assert.equal(capabilitiesOf({ preset: 'monitor', webSearch: { enabled: true } }).webSearch, true)
})

test('7) analista, coordenador e executor não recebem — nem ligando o interruptor', () => {
  for (const preset of ['analyst', 'manager', 'secretary', 'operator', 'communicator', 'custom']) {
    assert.equal(capabilitiesOf({ preset, webSearch: { enabled: true } }).webSearch, false, preset)
    // E a seção nem aparece na tela deles.
    assert.ok(!roleUIConfigOf({ preset }).sections.includes('busca-web'), preset)
    assert.equal(roleUIConfigOf({ preset, webSearch: { enabled: true } }).allowedWebSearch, false, preset)
  }
  // No pesquisador a seção existe SEMPRE — é onde se liga o interruptor.
  assert.ok(roleUIConfigOf({ preset: 'researcher' }).sections.includes('busca-web'))
})

// --- 3) quando procurar ------------------------------------------------------------------------

const ligado = (over = {}) => normalizeWebSearch({ enabled: true, ...over })

test('3) fallback_only só procura quando a base NÃO respondeu', () => {
  const cfg = ligado({ policy: 'fallback_only' })
  const respondeu = shouldSearch(cfg, { grounding: 'ok', passages: 3, canSearch: true })
  assert.equal(respondeu.search, false)
  assert.match(respondeu.reason, /a base já respondeu/)

  for (const grounding of ['empty', 'unavailable', 'no_base']) {
    assert.equal(shouldSearch(cfg, { grounding, passages: 0, canSearch: true }).search, true, grounding)
  }
})

test('always procura mesmo com a base cheia', () => {
  assert.equal(shouldSearch(ligado({ policy: 'always' }), { grounding: 'ok', passages: 9, canSearch: true }).search, true)
})

test('automatic também procura quando a base trouxe POUCO', () => {
  // Uma resposta magra é quase sempre pior que nenhuma: tem cara de resposta.
  const cfg = ligado({ policy: 'automatic' })
  assert.equal(shouldSearch(cfg, { grounding: 'ok', passages: 1, canSearch: true }).search, true)
  assert.equal(shouldSearch(cfg, { grounding: 'ok', passages: 4, canSearch: true }).search, false)
})

test('desligado não procura, e sem serviço configurado também não — com motivos diferentes', () => {
  assert.match(shouldSearch(normalizeWebSearch({}), { grounding: 'empty', passages: 0, canSearch: true }).reason, /desligada/)
  assert.match(shouldSearch(ligado({ policy: 'always' }), { grounding: 'empty', passages: 0, canSearch: false }).reason, /nenhum serviço/)
})

// --- 4, 5, 6) os tetos, na prática --------------------------------------------------------------

const provedorFalso = (n) => ({
  name: 'falso',
  search: async (_q, opts) => {
    // Um serviço que devolve MAIS do que pedimos: o teto tem de valer aqui também.
    const total = Array.from({ length: n }, (_, i) => ({
      title: `Resultado ${i} sobre relatório trimestral`,
      url: `https://exemplo${i}.test/pagina`,
      snippet: `Trecho ${i} falando do relatório trimestral da unidade`,
    }))
    return total.slice(0, Math.max(opts.maxResults, 0) || total.length)
  },
})

const leitorFalso = (registro) => async (url) => {
  registro.push(url)
  return {
    ok: true,
    url,
    readMethod: 'http',
    reason: 'ok',
    kind: 'article',
    strategies: [],
    contentType: 'text/html',
    capturedAt: new Date().toISOString(),
    links: [],
    text: `Conteúdo da página ${url}. O relatório trimestral da unidade apontou crescimento. `.repeat(20),
    html: '',
    contentHash: 'h',
    metadata: { title: `Página ${url}`, canonicalUrl: url, domain: 'exemplo.test', author: null, publishedAt: null, modifiedAt: null, usefulChars: 900, status: 200 },
    durationMs: 5,
  }
}

test('4) o teto de resultados é respeitado, mesmo se o serviço devolver mais', async () => {
  const lidas = []
  const r = await runWebSearch(provedorFalso(50), 'relatório trimestral', ligado({ maxSearchResults: 3, maxPagesToRead: 1 }), {
    read: leitorFalso(lidas),
  })
  assert.equal(r.found, 3)
})

test('5 e 6) só as páginas ESCOLHIDAS são abertas — e são as mais relevantes', async () => {
  const lidas = []
  const r = await runWebSearch(provedorFalso(10), 'relatório trimestral', ligado({ maxSearchResults: 10, maxPagesToRead: 2 }), {
    read: leitorFalso(lidas),
  })
  assert.equal(r.found, 10, 'dez resultados custaram uma requisição barata')
  assert.equal(r.selected.length, 2)
  assert.equal(lidas.length, 2, 'e só duas páginas foram abertas — a leitura é o que custa')
  assert.deepEqual(lidas, r.selected.map((s) => s.url))
})

test('a evidência é TRECHO com procedência, não a página inteira', async () => {
  const lidas = []
  const r = await runWebSearch(provedorFalso(3), 'relatório trimestral', ligado({ maxPagesToRead: 3, maxEvidenceChunks: 2 }), {
    read: leitorFalso(lidas),
  })
  assert.equal(r.evidence.length, 2, 'o teto de evidências vale')
  for (const e of r.evidence) {
    assert.ok(e.url.startsWith('https://'), 'sem endereço não dá para conferir')
    assert.ok(e.text.length <= 1500, 'página inteira no prompt custa token e piora a resposta')
    assert.match(e.text, /relatório trimestral/)
  }
})

test('o ranking usa a pergunta, e é determinístico', () => {
  const resultados = [
    { title: 'Página institucional', url: 'https://a.test', snippet: 'sobre a empresa' },
    { title: 'Relatório trimestral da unidade 7', url: 'https://b.test', snippet: 'crescimento no trimestre' },
  ]
  const uma = rankResults('relatório trimestral unidade 7', resultados)
  const outra = rankResults('relatório trimestral unidade 7', resultados)
  assert.equal(uma[0].r.url, 'https://b.test', 'o que casa com a pergunta vem primeiro')
  assert.deepEqual(uma.map((x) => x.r.url), outra.map((x) => x.r.url), 'escolher o que abrir é decisão de custo: precisa ser auditável')
})

// --- 8) o que dá errado não derruba a tarefa ------------------------------------------------------

test('8) a busca que falha devolve o motivo, e não uma exceção', async () => {
  const quebrado = {
    name: 'falso',
    search: async () => {
      throw new Error('o serviço de busca respondeu 503')
    },
  }
  const r = await runWebSearch(quebrado, 'qualquer coisa', ligado())
  assert.equal(r.ok, false)
  assert.match(r.error, /503/)
  assert.deepEqual(r.evidence, [], 'sem evidência — e o agente segue com o que já tinha da base')
})

test('página que não pôde ser lida não vira evidência, e não interrompe as outras', async () => {
  const lidas = []
  const leitor = async (url) => {
    lidas.push(url)
    if (url.includes('exemplo0')) {
      return {
        ok: false, url, readMethod: 'http', code: 'LOGIN_REQUIRED', reason: 'pede login', kind: 'unknown',
        strategies: [], contentType: 'text/html', capturedAt: new Date().toISOString(), links: [],
        text: '', html: '', contentHash: '',
        metadata: { title: null, canonicalUrl: url, domain: 'x', author: null, publishedAt: null, modifiedAt: null, usefulChars: 0, status: 200 },
        durationMs: 3,
      }
    }
    return leitorFalso([])(url)
  }
  const r = await runWebSearch(provedorFalso(3), 'relatório trimestral', ligado({ maxPagesToRead: 3 }), { read: leitor })
  assert.equal(lidas.length, 3, 'uma página que pede login não impede as seguintes')
  assert.ok(r.read.some((l) => l.code === 'LOGIN_REQUIRED'))
  assert.ok(r.evidence.length > 0, 'as que deram certo continuam valendo')
})
