// A integração com o Brave, e o teto que impede a fatura.
//
// Nada aqui fala com o Brave de verdade: um servidor local se faz passar por ele, o que
// permite conferir o que SAI daqui — endereço, cabeçalho e o mapeamento da resposta.
//
// A chave usada é inventada e local. Nenhuma credencial real entra em teste, em log ou
// em arquivo deste repositório.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { reserveSearchRequest, releaseSearchRequest, searchBudgetConfig, searchBudgetStatus, searchPeriod, searchPeriodResetAt, resetSearchBudget, BRAVE_FREE_MONTHLY_REQUESTS } =
  await import('../dist/webSearch/budget.js')
const { activeSearchProvider, configuredProviderName } = await import('../dist/webSearch/provider.js')
const { mongoClient, db } = await import('../dist/db.js')

const CHAVE_DE_TESTE = 'chave-local-de-teste-nao-e-credencial'
let servidor
let porta
let recebido = []

before(async () => {
  servidor = createServer((req, res) => {
    recebido.push({ url: req.url, headers: req.headers })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        web: {
          results: [
            { title: 'Primeiro resultado', url: 'https://exemplo.test/a', description: 'um   trecho\ncom espaços' },
            { title: 'Segundo', url: 'https://exemplo.test/b', description: 'outro trecho' },
            { title: 'Sem endereço', url: '', description: 'não deve entrar' },
          ],
        },
      }),
    )
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  porta = servidor.address().port
})

after(async () => {
  await new Promise((r) => servidor.close(r))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await resetSearchBudget('brave')
  await resetSearchBudget('http')
  recebido = []
  delete process.env.BRAVE_PAID_USAGE_ENABLED
  delete process.env.BRAVE_MONTHLY_REQUEST_LIMIT
})

// --- a escolha do provedor -------------------------------------------------------------------

test('o padrão é brave, e sem chave não há provedor — a ausência é dita, não disfarçada', () => {
  delete process.env.WEB_SEARCH_PROVIDER
  delete process.env.BRAVE_SEARCH_API_KEY
  assert.equal(configuredProviderName(), 'brave')
  assert.equal(activeSearchProvider(), null, 'sem provedor, o agente sabe que não pode procurar')
})

test('o adaptador genérico continua funcionando quando escolhido', async () => {
  process.env.WEB_SEARCH_PROVIDER = 'http'
  process.env.WEB_SEARCH_URL = `http://127.0.0.1:${porta}/generico?q={query}`
  process.env.WEB_SEARCH_RESULTS_PATH = 'web.results'
  process.env.WEB_SEARCH_SNIPPET_FIELD = 'description'
  try {
    const p = activeSearchProvider()
    assert.equal(p.name, 'http')
    const r = await p.search('assunto', { maxResults: 5, timeoutMs: 5000 })
    assert.equal(r.length, 2)
    assert.equal(r[0].url, 'https://exemplo.test/a')
  } finally {
    for (const k of ['WEB_SEARCH_PROVIDER', 'WEB_SEARCH_URL', 'WEB_SEARCH_RESULTS_PATH', 'WEB_SEARCH_SNIPPET_FIELD']) delete process.env[k]
  }
})

// --- o que SAI daqui ----------------------------------------------------------------------------

const comBrave = async (fn) => {
  process.env.WEB_SEARCH_PROVIDER = 'brave'
  process.env.BRAVE_SEARCH_API_KEY = CHAVE_DE_TESTE
  // O endereço do Brave é fixo no código; para o teste, o servidor local assume o lugar.
  process.env.BRAVE_SEARCH_BASE_URL_FOR_TEST = `http://127.0.0.1:${porta}/res/v1/web/search`
  try {
    return await fn()
  } finally {
    delete process.env.WEB_SEARCH_PROVIDER
    delete process.env.BRAVE_SEARCH_API_KEY
    delete process.env.BRAVE_SEARCH_BASE_URL_FOR_TEST
  }
}

test('o pedido vai com a consulta e o cabeçalho que o serviço define', async () => {
  await comBrave(async () => {
    const p = activeSearchProvider()
    assert.equal(p.name, 'brave')
    const r = await p.search('relatório trimestral', { maxResults: 3, timeoutMs: 5000 })

    const pedido = recebido.at(-1)
    assert.match(pedido.url, /\/res\/v1\/web\/search/)
    assert.match(pedido.url, /q=relat/, 'a consulta vai codificada')
    assert.match(pedido.url, /count=3/, 'o teto de resultados chega ao serviço')
    assert.equal(pedido.headers['x-subscription-token'], CHAVE_DE_TESTE)
    // E o mapeamento: title, url e description.
    assert.equal(r[0].title, 'Primeiro resultado')
    assert.equal(r[0].url, 'https://exemplo.test/a')
    assert.equal(r[0].snippet, 'um trecho com espaços', 'o trecho vem normalizado')
    assert.equal(r.length, 2, 'resultado sem endereço não entra')
  })
})

test('a chave nunca sai em erro nem em log', async () => {
  const capturado = []
  const original = console.warn
  console.warn = (...args) => capturado.push(args.join(' '))
  try {
    await comBrave(async () => {
      const p = activeSearchProvider()
      // Um endereço que não responde: o erro não pode carregar o cabeçalho enviado.
      process.env.BRAVE_SEARCH_BASE_URL_FOR_TEST = 'http://127.0.0.1:1/res/v1/web/search'
      await p.search('x', { maxResults: 1, timeoutMs: 800 }).catch((e) => {
        assert.ok(!e.message.includes(CHAVE_DE_TESTE), 'a mensagem de erro não repete a credencial')
      })
    })
  } finally {
    console.warn = original
  }
  assert.ok(!capturado.join(' ').includes(CHAVE_DE_TESTE))
})

// --- a franquia mensal ----------------------------------------------------------------------------

test('900 passam e a 901 é bloqueada ANTES de a chamada sair', async () => {
  const cfg = { paidUsageEnabled: false, monthlyRequestLimit: 900 }
  for (let i = 0; i < 900; i++) {
    const r = await reserveSearchRequest('brave', cfg)
    assert.equal(r.ok, true, `a requisição ${i + 1} deveria caber`)
  }
  const passou = await reserveSearchRequest('brave', cfg)
  assert.equal(passou.ok, false)
  assert.equal(passou.code, 'monthly_limit_reached')
  assert.match(passou.reason, /franquia mensal/)
  assert.equal(passou.used, 900)
})

test('execuções paralelas na borda não passam juntas', async () => {
  const cfg = { paidUsageEnabled: false, monthlyRequestLimit: 10 }
  const r = await Promise.all(Array.from({ length: 30 }, () => reserveSearchRequest('brave', cfg)))
  assert.equal(r.filter((x) => x.ok).length, 10, 'exatamente o teto, nem uma a mais')
  const doc = await db.collection('web_search_budget').findOne({ _id: `brave:${searchPeriod()}` })
  assert.equal(doc.used, 10)
})

test('com uso pago DESLIGADO, nenhuma variável configura acima de 900', () => {
  process.env.BRAVE_MONTHLY_REQUEST_LIMIT = '50000'
  process.env.BRAVE_PAID_USAGE_ENABLED = 'false'
  assert.equal(searchBudgetConfig().monthlyRequestLimit, BRAVE_FREE_MONTHLY_REQUESTS)

  // Ligar o uso pago é uma decisão explícita — aí o número configurado vale.
  process.env.BRAVE_PAID_USAGE_ENABLED = 'true'
  assert.equal(searchBudgetConfig().monthlyRequestLimit, 50_000)
})

test('o padrão, sem nenhuma variável, é 900 e uso pago desligado', () => {
  const cfg = searchBudgetConfig()
  assert.equal(cfg.monthlyRequestLimit, 900)
  assert.equal(cfg.paidUsageEnabled, false)
})

test('uma tentativa que SAIU conta mesmo falhando; uma que não saiu volta', async () => {
  const cfg = { paidUsageEnabled: false, monthlyRequestLimit: 5 }
  await reserveSearchRequest('brave', cfg)
  // O Brave não devolve cota porque a resposta deu erro: nosso número acompanha o dele.
  let doc = await db.collection('web_search_budget').findOne({ _id: `brave:${searchPeriod()}` })
  assert.equal(doc.used, 1)

  // Já a requisição que nem chegou a sair é devolvida — este é o único caso.
  await releaseSearchRequest('brave')
  doc = await db.collection('web_search_budget').findOne({ _id: `brave:${searchPeriod()}` })
  assert.equal(doc.used, 0)
})

test('o mês seguinte começa do zero, sozinho, em UTC', async () => {
  const cfg = { paidUsageEnabled: false, monthlyRequestLimit: 2 }
  const janeiro = new Date(Date.UTC(2026, 0, 15, 12))
  await reserveSearchRequest('brave', cfg, janeiro)
  await reserveSearchRequest('brave', cfg, janeiro)
  assert.equal((await reserveSearchRequest('brave', cfg, janeiro)).ok, false)

  const fevereiro = new Date(Date.UTC(2026, 1, 1, 0, 0, 1))
  assert.equal((await reserveSearchRequest('brave', cfg, fevereiro)).ok, true, 'período novo nasce sozinho')
  assert.equal(searchPeriod(janeiro), '2026-01')
  assert.equal(searchPeriodResetAt(janeiro).toISOString(), '2026-02-01T00:00:00.000Z')
  // E o mês anterior continua gravado: a virada não apaga histórico.
  const antigo = await db.collection('web_search_budget').findOne({ _id: 'brave:2026-01' })
  assert.equal(antigo.used, 2)
})

// --- o que o painel recebe ----------------------------------------------------------------------

test('o status diz o suficiente e NADA sobre a chave', async () => {
  const cfg = { paidUsageEnabled: false, monthlyRequestLimit: 900 }
  await reserveSearchRequest('brave', cfg)
  const s = await searchBudgetStatus('brave', true, cfg)

  assert.deepEqual(Object.keys(s).sort(), ['configured', 'limit', 'paidUsageEnabled', 'period', 'provider', 'remaining', 'resetAt', 'used'])
  assert.equal(s.used, 1)
  assert.equal(s.remaining, 899)
  assert.equal(s.configured, true)
  assert.ok(!JSON.stringify(s).toLowerCase().includes('key'), 'nem o nome da variável aparece')
})

test('sem chave, o status diz que NÃO está configurado', async () => {
  const s = await searchBudgetStatus('brave', false)
  assert.equal(s.configured, false)
  assert.equal(s.used, 0)
})
