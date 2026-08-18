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

// --- o que o DONO escolhe -----------------------------------------------------------------
//
// Os números eram meus, escondidos no código. Quem paga a conta é quem decide — dentro de
// um teto de sistema, para um engano de digitação não virar um prompt de cem mil letras.

const comSites = async (watchedSources, sourceSettings) => {
  await db.collection('agents').updateOne(
    { _id: AGENTE },
    { $set: { ...agenteFalso, watchedSources, ...(sourceSettings ? { sourceSettings } : {}) } },
    { upsert: true },
  )
}

const site = (over = {}) => ({ id: 's1', name: 'Blog', kind: 'rss', url: URL_FEED, when: 'on_demand', initialWindow: '7d', ...over })

test('o teto de itens é o que o dono escolheu, e não o meu', async () => {
  itensDoFeed = Array.from({ length: 20 }, (_, i) => `Notícia ${i}`)
  await comSites([site()], { maxItems: 3, charBudget: 2400, maxSources: 5 })

  const { sourceCheckTool: ferramentaCfg } = await import('../dist/automations/sourceTool.js')
  const { sourceSettingsOf } = await import('../dist/agents.js')
  const agente = await db.collection('agents').findOne({ _id: AGENTE })
  const corpo = JSON.parse((await ferramentaCfg(DONO, AGENTE, sourceSettingsOf(agente)).run({ fonte: 'blog' })).result)

  assert.equal(corpo.itens.length, 3)
})

test('o nome e a descrição da ferramenta são os do dono', async () => {
  const { sourceCheckTool: f } = await import('../dist/automations/sourceTool.js')
  const t = f(DONO, AGENTE, { toolName: 'olhar_site', toolDescription: 'Use quando perguntarem de preço.' })
  assert.equal(t.name, 'olhar_site')
  assert.match(t.description, /perguntarem de preço/)
})

test('um nome que o provedor recusaria é saneado, não aceito', async () => {
  const { sanitizeToolName } = await import('../dist/agents.js')
  // Espaço, acento e sinal quebrariam a chamada inteira no provedor.
  assert.equal(sanitizeToolName('olhar o sítio!', 'verificar_fonte'), 'olhar_o_sitio')
  assert.equal(sanitizeToolName('!!!', 'verificar_fonte'), 'verificar_fonte', 'sem nada aproveitável, volta ao padrão')
})

test('limites fora da faixa são presos no teto do sistema, sem recusar o salvamento', async () => {
  const { sourceSettingsOf } = await import('../dist/agents.js')
  const alto = sourceSettingsOf({ sourceSettings: { maxItems: 9999, charBudget: 9999999, maxSources: 500 } })
  assert.equal(alto.maxItems, 30)
  assert.equal(alto.charBudget, 20000)
  assert.equal(alto.maxSources, 20)

  const baixo = sourceSettingsOf({ sourceSettings: { maxItems: 0, charBudget: 1, maxSources: 0 } })
  assert.equal(baixo.maxItems, 1)
  assert.equal(baixo.charBudget, 200)
})

test('a janela do feed é a escolhida por endereço', async () => {
  await comSites([site({ initialWindow: '24h' })])
  const fontes = await fontesDoAgente(DONO, AGENTE)
  assert.equal(fontes[0].source.initialWindow, '24h')
})

// --- os modos automáticos -------------------------------------------------------------------

test('"sempre" injeta o conteúdo em toda chamada', async () => {
  const { livePassagesFor } = await import('../dist/automations/liveSources.js')
  await comSites([site({ when: 'always' })])
  const agente = await db.collection('agents').findOne({ _id: AGENTE })

  const uma = await livePassagesFor(DONO, agente)
  const outra = await livePassagesFor(DONO, agente)
  assert.equal(uma.length, 1)
  assert.equal(outra.length, 1, 'sempre é sempre — inclusive quando nada mudou')
  assert.match(uma[0].content, /Primeira notícia/)
  assert.equal(uma[0].title, 'Blog')
})

test('"só se mudou" cala na segunda vez, e volta a falar quando muda', async () => {
  const { livePassagesFor } = await import('../dist/automations/liveSources.js')
  await comSites([site({ when: 'on_change' })])
  const agente = await db.collection('agents').findOne({ _id: AGENTE })

  assert.equal((await livePassagesFor(DONO, agente)).length, 1, 'a primeira vez sempre traz')
  assert.equal((await livePassagesFor(DONO, agente)).length, 0, 'nada mudou: 0 token de contexto')

  itensDoFeed = ['Furo de reportagem', ...itensDoFeed]
  const depois = await livePassagesFor(DONO, agente)
  assert.equal(depois.length, 1)
  assert.match(depois[0].content, /Furo de reportagem/)
})

test('"quando o agente julgar" nunca entra sozinho no contexto', async () => {
  const { livePassagesFor } = await import('../dist/automations/liveSources.js')
  await comSites([site({ when: 'on_demand' })])
  const agente = await db.collection('agents').findOne({ _id: AGENTE })
  assert.deepEqual(await livePassagesFor(DONO, agente), [], 'sob demanda é sob demanda')
})

test('site fora do ar não derruba o atendimento', async () => {
  const { livePassagesFor } = await import('../dist/automations/liveSources.js')
  await comSites([site({ when: 'always', url: 'http://127.0.0.1:1/nao-existe' })])
  const agente = await db.collection('agents').findOne({ _id: AGENTE })
  assert.deepEqual(await livePassagesFor(DONO, agente), [], 'o que não deu para ler simplesmente não entra')
})

test('o orçamento de caracteres limita o que entra no contexto', async () => {
  const { livePassagesFor } = await import('../dist/automations/liveSources.js')
  itensDoFeed = Array.from({ length: 30 }, (_, i) => `Notícia número ${i} com um título bem longo para ocupar espaço no contexto`)
  await comSites([site({ when: 'always' })], { maxItems: 30, charBudget: 300, maxSources: 5 })
  const agente = await db.collection('agents').findOne({ _id: AGENTE })

  const passagens = await livePassagesFor(DONO, agente)
  assert.ok(passagens[0].content.length <= 300, `entraram ${passagens[0].content.length} caracteres`)
})
