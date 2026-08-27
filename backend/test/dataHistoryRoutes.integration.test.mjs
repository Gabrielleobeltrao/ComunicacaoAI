// As rotas do histórico genérico — com o dono no filtro, sempre.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.DATA_HISTORY_MIN_INTERVAL_MS = '1000'

const { mongoClient, db } = await import('../dist/db.js')
const { dataHistoryRouter } = await import('../dist/routes/dataHistoryRoutes.js')
const { ensureDataHistoryIndexes } = await import('../dist/dataHistory/store.js')

const DONO = 'dono-rotas'
const VIZINHO = 'vizinho'
let sessao = DONO
let servidor
let port

before(async () => {
  await ensureDataHistoryIndexes()
  const app = express()
  app.use(express.json())
  app.use('/api/data-history', (req, res, next) => {
    res.locals.userId = sessao
    next()
  }, dataHistoryRouter)
  servidor = app.listen(0)
  await new Promise((r) => servidor.once('listening', r))
  port = servidor.address().port
})
after(async () => {
  servidor.close()
  await mongoClient.close()
  await stopMongo()
})
beforeEach(async () => {
  sessao = DONO
  for (const c of ['data_recorders', 'data_history_records', 'data_history_windows']) await db.collection(c).deleteMany({})
})

const pedir = async (metodo, caminho, corpo) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/data-history${caminho}`, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await res.text()
  return { status: res.status, body: texto ? JSON.parse(texto) : null }
}

const DEF = { name: 'meu histórico', source: { kind: 'manual', ref: 'erp' }, mode: 'every_event', entityKeyPath: 'sku' }

test('criar, listar, ler, atualizar e apagar', async () => {
  const criado = await pedir('POST', '/recorders', DEF)
  assert.equal(criado.status, 201)
  assert.equal(criado.body.name, 'meu histórico')
  assert.equal(criado.body.enabled, true)

  assert.equal((await pedir('GET', '/recorders')).body.length, 1)
  assert.equal((await pedir('GET', `/recorders/${criado.body.id}`)).body.storedRecords, 0)

  const mudado = await pedir('PATCH', `/recorders/${criado.body.id}`, { enabled: false })
  assert.equal(mudado.body.enabled, false)

  assert.equal((await pedir('DELETE', `/recorders/${criado.body.id}`)).status, 204)
  assert.equal((await pedir('GET', '/recorders')).body.length, 0)
})

test('uma definição inválida é recusada com o motivo, e nada é criado', async () => {
  const r = await pedir('POST', '/recorders', { ...DEF, mode: 'window_aggregate', intervalMs: 60_000, aggregations: [] })
  assert.equal(r.status, 400)
  assert.match(r.body.message, /agregação/)
  assert.equal(await db.collection('data_recorders').countDocuments({}), 0)
})

test('o histórico de outro dono não existe: 404, e não 403', async () => {
  const meu = (await pedir('POST', '/recorders', DEF)).body
  sessao = VIZINHO
  for (const [metodo, caminho, corpo] of [
    ['GET', `/recorders/${meu.id}`],
    ['PATCH', `/recorders/${meu.id}`, { name: 'sequestrado' }],
    ['DELETE', `/recorders/${meu.id}`],
    ['GET', `/recorders/${meu.id}/records`],
    ['GET', `/recorders/${meu.id}/keys`],
    ['GET', `/recorders/${meu.id}/aggregate`],
  ]) {
    const r = await pedir(metodo, caminho, corpo)
    assert.equal(r.status, 404, `${metodo} ${caminho} devolveu ${r.status}`)
  }
})

test('a prévia roda o motor e NÃO deixa rastro', async () => {
  const r = await pedir('POST', '/preview', {
    recorder: {
      name: 'prévia',
      source: { kind: 'manual', ref: 'erp' },
      mode: 'window_aggregate',
      intervalMs: 60_000,
      entityKeyPath: 'sku',
      aggregations: [
        { from: 'qty', op: 'sum', to: 'total' },
        { from: '', op: 'count', to: 'linhas' },
      ],
    },
    samples: [
      { sku: 'A', qty: 3 },
      { sku: 'A', qty: 4 },
    ],
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.decisions.length, 2)
  assert.equal(r.body.windows.length, 1)
  assert.equal(r.body.windows[0].value.total, 7)
  assert.equal(r.body.windows[0].value.linhas, 2)

  // Nem recorder, nem registro, nem janela: testar não cria nada.
  assert.equal(await db.collection('data_recorders').countDocuments({}), 0)
  assert.equal(await db.collection('data_history_records').countDocuments({}), 0)
  assert.equal(await db.collection('data_history_windows').countDocuments({}), 0)
})

test('a prévia recusa uma configuração inválida antes de rodar', async () => {
  const r = await pedir('POST', '/preview', { recorder: { name: 'x', source: { kind: 'manual', ref: 'r' }, mode: 'nao_existe' }, samples: [{}] })
  assert.equal(r.status, 400)
})

test('consultar registros por chave e período', async () => {
  const rec = (await pedir('POST', '/recorders', DEF)).body
  const engine = await import('../dist/dataHistory/engine.js')
  engine.limparCacheDeRecorders()
  const t0 = Date.parse('2026-08-01T00:00:00.000Z')
  for (const [i, sku] of ['A', 'B', 'A'].entries()) {
    await engine.ingestFact({ ownerId: DONO, sourceKey: 'manual:erp', entityKey: null, occurredAt: new Date(t0 + i * 60_000), value: { sku, qty: i + 1 } })
  }

  const todos = await pedir('GET', `/recorders/${rec.id}/records`)
  assert.equal(todos.body.count, 3)

  const soA = await pedir('GET', `/recorders/${rec.id}/records?entityKey=A&order=asc`)
  assert.deepEqual(soA.body.items.map((i) => i.value.qty), [1, 3])

  const chaves = await pedir('GET', `/recorders/${rec.id}/keys`)
  assert.deepEqual([...chaves.body].sort(), ['A', 'B'])

  const resumo = await pedir('GET', `/recorders/${rec.id}/aggregate`)
  assert.equal(resumo.body.result.total, 3, 'sem regras próprias, o resumo é a contagem')
})

// --- a rodada de acabamento -------------------------------------------------------

test('o catálogo de fontes é do dono, e os eventos são do sistema', async () => {
  const r = await pedir('GET', '/sources')
  assert.equal(r.status, 200)
  assert.ok(Array.isArray(r.body.live_data))
  assert.ok(r.body.event.some((e) => e.ref === 'market.candle.closed'))
  // Cada opção traz o que a tela mostra e o que o servidor guarda.
  assert.ok(r.body.event.every((e) => typeof e.ref === 'string' && typeof e.label === 'string'))
})

test('a prévia diz o que resolveu, e não só o veredito', async () => {
  const r = await pedir('POST', '/preview', {
    recorder: {
      name: 'prévia detalhada',
      source: { kind: 'manual', ref: 'erp' },
      mode: 'condition',
      entityKeyPath: 'sku',
      occurredAtPath: 'quando',
      selectedFields: ['sku', 'qty'],
      filters: [{ path: 'qty', operator: 'lt', value: 10 }],
    },
    samples: [
      { sku: 'A', qty: 3, quando: '2026-02-02T10:00:00.000Z', ruido: 'fora' },
      { sku: 'B', qty: 50, quando: '2026-02-02T11:00:00.000Z' },
    ],
  })
  assert.equal(r.status, 200)
  const [aceito, recusado] = r.body.decisions

  assert.equal(aceito.resultado, 'gravado')
  assert.equal(aceito.entityKey, 'A', 'a chave resolvida aparece')
  assert.equal(aceito.occurredAt, '2026-02-02T10:00:00.000Z', 'e o instante do fato também')
  assert.deepEqual(aceito.valor, { sku: 'A', qty: 3 }, 'o valor já recortado')

  assert.equal(recusado.resultado, 'filtrado')
  assert.match(recusado.motivo, /filtros/, 'o motivo é uma frase, não um código')

  // E nada ficou para trás.
  assert.equal(await db.collection('data_history_records').countDocuments({}), 0)
  assert.equal(await db.collection('data_recorders').countDocuments({}), 0)
})

test('a consulta pagina, conta o total e separa por tipo', async () => {
  const rec = (await pedir('POST', '/recorders', DEF)).body
  const engine = await import('../dist/dataHistory/engine.js')
  engine.limparCacheDeRecorders()
  const t0 = Date.parse('2026-08-01T00:00:00.000Z')
  for (let i = 0; i < 5; i += 1) {
    await engine.ingestFact({ ownerId: DONO, sourceKey: 'manual:erp', entityKey: null, occurredAt: new Date(t0 + i * 1000), value: { sku: 'A', qty: i } })
  }

  const p1 = await pedir('GET', `/recorders/${rec.id}/records?limit=2&order=asc`)
  assert.equal(p1.body.count, 2)
  assert.equal(p1.body.total, 5, 'o total é quanto existe, não quanto veio')
  assert.equal(p1.body.skip, 0)

  const p2 = await pedir('GET', `/recorders/${rec.id}/records?limit=2&skip=2&order=asc`)
  assert.equal(p2.body.count, 2)
  assert.notEqual(p1.body.items[0].id, p2.body.items[0].id)

  // Tudo é bruto neste histórico: filtrar por resumo devolve vazio.
  assert.equal((await pedir('GET', `/recorders/${rec.id}/records?recordKind=raw`)).body.total, 5)
  assert.equal((await pedir('GET', `/recorders/${rec.id}/records?recordKind=aggregate`)).body.total, 0)
  // E cada registro diz o que é.
  assert.equal(p1.body.items[0].recordKind, 'raw')
})

test('condition sem filtro é recusado pela API, com a frase certa', async () => {
  const r = await pedir('POST', '/recorders', { ...DEF, mode: 'condition' })
  assert.equal(r.status, 400)
  assert.match(r.body.message, /pelo menos um filtro/)
})

test('uma fonte de outra conta é recusada na criação e na edição', async () => {
  const { createInstallation } = await import('../dist/apps/installations.js')
  const { getApp } = await import('../dist/apps/registry.js')
  const doVizinho = await createInstallation(VIZINHO, getApp('websocket'), { name: 'Do vizinho', config: { token: 'x'.repeat(12) }, publicMetadata: {} })

  const criado = await pedir('POST', '/recorders', { ...DEF, source: { kind: 'live_data', ref: doVizinho._id.toString() } })
  assert.equal(criado.status, 400)
  assert.match(criado.body.message, /não existe nesta conta/)

  const meu = (await pedir('POST', '/recorders', DEF)).body
  const editado = await pedir('PATCH', `/recorders/${meu.id}`, { source: { kind: 'live_data', ref: doVizinho._id.toString() } })
  assert.equal(editado.status, 400, 'a edição confere igual à criação')
})

test('a agenda com fuso vai e volta pela API', async () => {
  const r = await pedir('POST', '/recorders', {
    ...DEF,
    mode: 'schedule_snapshot',
    schedule: { cron: '0 8 * * 1-5', timezone: 'America/New_York' },
  })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.schedule, { cron: '0 8 * * 1-5', timezone: 'America/New_York' })

  const ruim = await pedir('POST', '/recorders', { ...DEF, name: 'outro', mode: 'schedule_snapshot', schedule: { cron: 'toda manhã', timezone: 'UTC' } })
  assert.equal(ruim.status, 400)
})

test('a política de persistência vai e volta, com o padrão seguro', async () => {
  const janela = {
    ...DEF,
    name: 'com janela',
    mode: 'window_aggregate',
    intervalMs: 60_000,
    aggregations: [{ from: 'qty', op: 'sum', to: 'total' }],
  }
  const padrao = await pedir('POST', '/recorders', janela)
  assert.equal(padrao.body.persistPolicy, 'aggregate_only', 'o padrão não guarda cada dado')

  const ambos = await pedir('PATCH', `/recorders/${padrao.body.id}`, { persistPolicy: 'raw_and_aggregate' })
  assert.equal(ambos.body.persistPolicy, 'raw_and_aggregate')
})

test('a API expõe destino e retenção, e aceita os dois formatos', async () => {
  const padrao = (await pedir('POST', '/recorders', DEF)).body
  assert.deepEqual(padrao.storage, { kind: 'internal', connectionId: null })
  assert.deepEqual(padrao.retention, { mode: 'ttl', days: 90 })
  assert.equal(padrao.retentionDays, 90, 'o campo antigo continua saindo, para quem já o lê')

  const eterno = (await pedir('POST', '/recorders', { ...DEF, name: 'eterno', retention: { mode: 'forever' } })).body
  assert.deepEqual(eterno.retention, { mode: 'forever' })
  assert.equal(eterno.retentionDays, null, 'para sempre não tem prazo em dias')

  // O formato ANTIGO na entrada continua funcionando.
  const velho = (await pedir('POST', '/recorders', { ...DEF, name: 'formato velho', retentionDays: 15 })).body
  assert.deepEqual(velho.retention, { mode: 'ttl', days: 15 })

  // Ida e volta pelos dois lados.
  const virouEterno = (await pedir('PATCH', `/recorders/${velho.id}`, { retention: { mode: 'forever' } })).body
  assert.deepEqual(virouEterno.retention, { mode: 'forever' })
  const voltou = (await pedir('PATCH', `/recorders/${velho.id}`, { retention: { mode: 'ttl', days: 200 } })).body
  assert.deepEqual(voltou.retention, { mode: 'ttl', days: 200 })
  assert.deepEqual(voltou.storage, { kind: 'internal', connectionId: null }, 'o destino ficou onde estava')
})

test('a API recusa retenção e destino impossíveis', async () => {
  const prazoRuim = await pedir('POST', '/recorders', { ...DEF, retention: { mode: 'ttl', days: 5000 } })
  assert.equal(prazoRuim.status, 400)
  assert.match(prazoRuim.body.message, /retenção/)

  const destinoRuim = await pedir('POST', '/recorders', { ...DEF, storage: { kind: 's3' } })
  assert.equal(destinoRuim.status, 400)
  assert.match(destinoRuim.body.message, /não está disponível/)
})

test('os destinos disponíveis vêm por rota, para a tela não fixar a lista', async () => {
  const r = await pedir('GET', '/storages')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, [{ kind: 'internal', label: 'Banco interno' }])
})

test('“Banco interno + Para sempre”: o caminho inteiro, de ponta a ponta', async () => {
  const rec = (await pedir('POST', '/recorders', {
    name: 'Tudo que o ERP manda, para sempre',
    source: { kind: 'manual', ref: 'erp' },
    mode: 'every_event',
    entityKeyPath: 'sku',
    storage: { kind: 'internal' },
    retention: { mode: 'forever' },
  })).body
  assert.deepEqual(rec.storage, { kind: 'internal', connectionId: null })
  assert.deepEqual(rec.retention, { mode: 'forever' })

  const engine = await import('../dist/dataHistory/engine.js')
  engine.limparCacheDeRecorders()
  await engine.ingestFact({ ownerId: DONO, sourceKey: 'manual:erp', entityKey: null, occurredAt: new Date('2026-01-01T00:00:00Z'), value: { sku: 'A', qty: 7 } })

  const consulta = await pedir('GET', `/recorders/${rec.id}/records`)
  assert.equal(consulta.body.total, 1)
  assert.equal(consulta.body.items[0].value.qty, 7)
  // E no banco, o registro não tem prazo nenhum.
  assert.equal(await db.collection('data_history_records').countDocuments({ expiresAt: null }), 1)
})

test('o histórico de outro dono continua não existindo, com destino ou sem', async () => {
  const meu = (await pedir('POST', '/recorders', { ...DEF, retention: { mode: 'forever' } })).body
  sessao = VIZINHO
  assert.equal((await pedir('GET', `/recorders/${meu.id}/records`)).status, 404)
  assert.equal((await pedir('PATCH', `/recorders/${meu.id}`, { retention: { mode: 'ttl', days: 5 } })).status, 404)
  assert.equal((await pedir('GET', '/storages')).status, 200, 'a lista de destinos é do servidor, não do dono')
})
