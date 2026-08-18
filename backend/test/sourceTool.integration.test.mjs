// INTEGRAÇÃO: "olha essa fonte agora" — a verificação sob demanda.
//
// O monitoramento só existia por relógio: a rotina consulta o feed na frequência
// configurada. Faltava o caso em que a pergunta chega no meio de uma conversa e a
// resposta depende do que está na fonte NESTE instante.
//
// A garantia que mais importa aqui é a de que consultar é uma ESPIADA: o checkpoint da
// rotina não pode ser tocado. Se a conversa consumisse os itens novos, a rotina das 9h
// acharia que não houve novidade e o alerta que o dono configurou nunca sairia.
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { createServer } from 'node:http'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
// O safeFetch recusa endereço privado; o teste sobe um servidor em 127.0.0.1 e usa a
// mesma porta de escape que o resto da suíte usa para exercitar HTTP local.
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { sourceCheckTool, fontesDoAgente } = await import('../dist/automations/sourceTool.js')
const { createRoutine } = await import('../dist/automations/routine.js')
const { mongoClient, db } = await import('../dist/db.js')

const DONO = 'dono-fonte'
const ANDAR = new ObjectId()
const AGENTE = new ObjectId()

// Um feed de verdade, servido localmente: exercita o parser, não um dublê dele.
const FEED = (itens) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Notícias</title>${itens
  .map((i) => `<item><title>${i}</title><link>https://exemplo.test/${encodeURIComponent(i)}</link><guid>${i}</guid></item>`)
  .join('')}</channel></rss>`

let itensDoFeed = ['Primeira notícia', 'Segunda notícia']
const servidor = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/rss+xml' })
  res.end(FEED(itensDoFeed))
})
await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
const PORTA = servidor.address().port
const URL_FEED = `http://127.0.0.1:${PORTA}/feed.xml`

after(async () => {
  servidor.close()
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await db.collection('agents').deleteMany({})
  await db.collection('automations').deleteMany({})
  await db.collection('offices').deleteMany({})
  await db.collection('source_checkpoints').deleteMany({})
  itensDoFeed = ['Primeira notícia', 'Segunda notícia']
})

const agenteFalso = { _id: AGENTE, ownerId: DONO, officeId: ANDAR, name: 'Vigia' }

const criarRotinaComFeed = async (nome = 'Notícias do setor') => {
  // O andar precisa existir: a criação de automação o exige, e criá-lo aqui mantém o
  // teste falando com as mesmas regras da produção.
  await db.collection('offices').updateOne(
    { _id: ANDAR },
    { $set: { _id: ANDAR, ownerId: DONO, name: 'Térreo', status: 'active', createdAt: new Date(), updatedAt: new Date() } },
    { upsert: true },
  )
  await db.collection('agents').updateOne({ _id: AGENTE }, { $set: agenteFalso }, { upsert: true })
  return createRoutine(DONO, AGENTE, {
    name: nome,
    objective: 'resumir',
    recurrence: { kind: 'daily', time: '09:00' },
    timezone: 'America/Sao_Paulo',
    source: { kind: 'rss', url: URL_FEED, initialWindow: '7d' },
  })
}

const rodar = (args) => sourceCheckTool(DONO, AGENTE).run(args)

// --- o que a ferramenta é ------------------------------------------------------------

test('é ferramenta de LEITURA — por isso vale no Playground, onde escrita é bloqueada', () => {
  const t = sourceCheckTool(DONO, AGENTE)
  assert.equal(t.risk, 'read')
  assert.equal(t.name, 'verificar_fonte')
})

test('sem fonte configurada, ela diz isso — não some nem inventa', async () => {
  const r = await rodar({})
  assert.equal(JSON.parse(r.result).status, 'sem_fonte')
})

test('sem argumento, lista as fontes que este agente alcança', async () => {
  await criarRotinaComFeed()
  const corpo = JSON.parse((await rodar({})).result)
  assert.equal(corpo.status, 'ok')
  assert.deepEqual(corpo.fontes, [{ nome: 'Notícias do setor', tipo: 'feed', origem: 'rotina' }])
})

test('consulta o feed pelo nome e devolve os itens', async () => {
  await criarRotinaComFeed()
  const corpo = JSON.parse((await rodar({ fonte: 'notícias' })).result)
  assert.equal(corpo.tipo, 'feed')
  assert.equal(corpo.novos, 2)
  assert.equal(corpo.itens[0].titulo, 'Primeira notícia')
})

test('o nome casa sem acento e sem diferenciar maiúscula', async () => {
  await criarRotinaComFeed()
  const corpo = JSON.parse((await rodar({ fonte: 'NOTICIAS DO SETOR' })).result)
  assert.equal(corpo.fonte, 'Notícias do setor')
})

test('nome que não existe devolve as opções, e não um erro seco', async () => {
  await criarRotinaComFeed()
  const corpo = JSON.parse((await rodar({ fonte: 'clima' })).result)
  assert.equal(corpo.status, 'nao_encontrada')
  assert.deepEqual(corpo.disponiveis, ['Notícias do setor'])
})

// --- a garantia central --------------------------------------------------------------

test('consultar NÃO cria nem avança checkpoint — a rotina não perde o alerta dela', async () => {
  await criarRotinaComFeed()
  await rodar({ fonte: 'notícias' })
  await rodar({ fonte: 'notícias' })

  const checkpoints = await db.collection('source_checkpoints').find({}).toArray()
  assert.equal(checkpoints.length, 0, 'a espiada não pode marcar item nenhum como visto')
})

test('o que a rotina JÁ viu não é apresentado como novidade', async () => {
  const rotina = await criarRotinaComFeed()
  // Simula a rotina tendo rodado: os dois itens já são conhecidos.
  await db.collection('source_checkpoints').insertOne({
    ownerId: DONO,
    automationId: rotina._id,
    stepId: 'source',
    sourceFingerprint: 'x',
    initialized: true,
    seenKeys: ['Primeira notícia', 'Segunda notícia'],
    contentHash: null,
    lastCheckedAt: new Date(),
    lastChangedAt: new Date(),
    updatedAt: new Date(),
  })

  const antes = JSON.parse((await rodar({ fonte: 'notícias' })).result)
  assert.equal(antes.status, 'sem_novidade')
  assert.equal(antes.novos, 0)

  // Chega um item novo no feed.
  itensDoFeed = ['Terceira notícia', ...itensDoFeed]
  const depois = JSON.parse((await rodar({ fonte: 'notícias' })).result)
  assert.equal(depois.status, 'novidade')
  assert.equal(depois.novos, 1)
  assert.equal(depois.itens[0].titulo, 'Terceira notícia')
})

test('a resposta avisa que os itens continuam pendentes para a rotina', async () => {
  await criarRotinaComFeed()
  const corpo = JSON.parse((await rodar({ fonte: 'notícias' })).result)
  assert.match(corpo.observacao, /somente leitura/)
})

// --- teto de custo -----------------------------------------------------------------------

test('um feed enorme não vira um prompt enorme', async () => {
  itensDoFeed = Array.from({ length: 60 }, (_, i) => `Notícia número ${i} com um título razoavelmente longo para ocupar espaço`)
  await criarRotinaComFeed()
  const corpo = JSON.parse((await rodar({ fonte: 'notícias' })).result)

  assert.ok(corpo.itens.length <= 8, `voltaram ${corpo.itens.length} itens`)
  assert.ok(corpo.nota, 'quando corta, precisa dizer que cortou')
  assert.ok((await rodar({ fonte: 'notícias' })).result.length < 4000, 'o resultado inteiro tem teto')
})

// --- isolamento -----------------------------------------------------------------------------

test('a fonte de outra conta não é alcançada', async () => {
  await criarRotinaComFeed()
  const doVizinho = await fontesDoAgente('outro-dono', AGENTE)
  assert.deepEqual(doVizinho, [])
})

test('o agente sem rotina de outro dono não vê fonte nenhuma', async () => {
  await criarRotinaComFeed()
  const corpo = JSON.parse((await sourceCheckTool('outro-dono', AGENTE).run({})).result)
  assert.equal(corpo.status, 'sem_fonte')
})

// --- o site cadastrado NO AGENTE ------------------------------------------------------------
//
// A rotina responde "verifique de hora em hora". Isto responde "quando alguém perguntar,
// olhe aqui" — sem horário, sem checkpoint e sem custo enquanto ninguém pergunta.

test('um site cadastrado no agente é consultável, sem rotina nenhuma', async () => {
  await db.collection('agents').updateOne(
    { _id: AGENTE },
    { $set: { ...agenteFalso, watchedSources: [{ id: 's1', name: 'Blog da empresa', kind: 'rss', url: URL_FEED }] } },
    { upsert: true },
  )

  const lista = JSON.parse((await rodar({})).result)
  assert.deepEqual(lista.fontes, [{ nome: 'Blog da empresa', tipo: 'feed', origem: 'agente' }])

  const corpo = JSON.parse((await rodar({ fonte: 'blog' })).result)
  assert.equal(corpo.fonte, 'Blog da empresa')
  assert.equal(corpo.itens.length, 2)
  assert.match(corpo.observacao, /sob demanda/)
})

test('o site do agente não inventa checkpoint nem "novidade" que não pode saber', async () => {
  await db.collection('agents').updateOne(
    { _id: AGENTE },
    { $set: { ...agenteFalso, watchedSources: [{ id: 's1', name: 'Blog', kind: 'rss', url: URL_FEED }] } },
    { upsert: true },
  )
  await rodar({ fonte: 'blog' })
  const checkpoints = await db.collection('source_checkpoints').find({}).toArray()
  assert.equal(checkpoints.length, 0, 'consultar sob demanda não cria estado')
})
