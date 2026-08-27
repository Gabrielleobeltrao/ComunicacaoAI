// A tela esconde e o motor TAMBÉM não entrega.
//
// Esconder um campo na tela sem tirá-lo do runtime é o pior dos dois mundos: o dono
// deixa de configurar e o comportamento acontece assim mesmo, agora sem ninguém olhando.
// Estes testes exercitam o funil por onde TODO agente passa — Playground, canal,
// automação e delegação usam este mesmo `resolveAgentTools`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()

const { resolveAgentTools } = await import('../dist/builtinTools.js')
const { db, mongoClient } = await import('../dist/db.js')

const OWNER = 'dono-papeis'

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

let toolId
before(async () => {
  // Uma ferramenta reutilizável de verdade, atribuída a todos os agentes abaixo.
  const r = await db.collection('tools').insertOne({
    ownerId: OWNER,
    name: 'consultar_estoque',
    description: 'consulta o estoque',
    enabled: true,
    method: 'GET',
    url: 'https://exemplo.test/estoque',
    inputSchema: { type: 'object', properties: {} },
  })
  toolId = r.insertedId
})

/** O mesmo agente, mudando só o TIPO — é a única variável destes testes. */
const agenteCom = (preset) => ({
  _id: new ObjectId(),
  ownerId: OWNER,
  name: `Agente ${preset}`,
  preset,
  objective: 'trabalhar',
  provider: 'anthropic',
  toolIds: [toolId.toString()],
  // Configuração LEGADA que continua gravada: uma ferramenta HTTP no documento do agente.
  tools: [{ name: 'webhook_antigo', description: 'legado', method: 'POST', url: 'https://exemplo.test/hook', headers: [] }],
})

const nomes = async (preset) => (await resolveAgentTools(agenteCom(preset), OWNER)).map((t) => t.name)

test('1) o coordenador não recebe ferramenta nenhuma de fora — nem a legada', async () => {
  for (const preset of ['manager', 'secretary']) {
    const lista = await nomes(preset)
    assert.ok(!lista.includes('consultar_estoque'), `${preset} não executa ferramenta`)
    assert.ok(!lista.includes('webhook_antigo'), `${preset}: nem a que já estava gravada`)
    // Nem memória operacional, nem olhar site.
    assert.ok(!lista.includes('buscar_memoria'), preset)
    // O que sobra é o que faz dele um coordenador: poder perguntar em vez de chutar.
    assert.ok(lista.length > 0, `${preset} não pode ficar sem nada`)
  }
})

test('2) o analista não recebe ferramenta externa, mas continua com memória', async () => {
  const lista = await nomes('analyst')
  assert.ok(!lista.includes('consultar_estoque'))
  assert.ok(!lista.includes('webhook_antigo'))
  assert.ok(lista.includes('buscar_memoria'), 'lembrar da conversa não é buscar base própria')
})

test('3 e 4) quem EXECUTA recebe as ferramentas concedidas — quem COLETA, não', async () => {
  // Executar é o trabalho de quem executa. O pesquisador levanta fatos e entrega;
  // dar-lhe a ferramenta é deixá-lo agir por conta própria, que é o que o papel
  // existe para separar.
  for (const preset of ['operator', 'communicator', 'custom']) {
    const lista = await nomes(preset)
    assert.ok(lista.includes('consultar_estoque'), `${preset} precisa da ferramenta atribuída`)
    assert.ok(lista.includes('webhook_antigo'), `${preset}: a legada continua funcionando`)
  }
  for (const preset of ['researcher', 'monitor']) {
    const lista = await nomes(preset)
    assert.ok(!lista.includes('consultar_estoque'), `${preset} não aciona ferramenta externa`)
    assert.ok(!lista.includes('webhook_antigo'), `${preset} não aciona ferramenta externa`)
  }
})

test('6) trocar o tipo muda o que o motor entrega, sem tocar no que está gravado', async () => {
  const agente = agenteCom('operator')
  const comoExecutor = (await resolveAgentTools(agente, OWNER)).map((t) => t.name)
  const comoCoordenador = (await resolveAgentTools({ ...agente, preset: 'manager' }, OWNER)).map((t) => t.name)

  assert.ok(comoExecutor.includes('consultar_estoque'))
  assert.ok(!comoCoordenador.includes('consultar_estoque'))
  // E o documento continua com tudo: a capacidade é IGNORADA, nunca apagada. Voltar o
  // tipo devolve as ferramentas sozinho.
  assert.equal(agente.toolIds.length, 1)
  assert.equal(agente.tools.length, 1)
  const devolta = (await resolveAgentTools({ ...agente, preset: 'operator' }, OWNER)).map((t) => t.name)
  assert.ok(devolta.includes('consultar_estoque'))
})

test('7) agente antigo sem preset nenhum: nada é tirado dele', async () => {
  const legado = { ...agenteCom('custom') }
  delete legado.preset
  const lista = (await resolveAgentTools(legado, OWNER)).map((t) => t.name)
  assert.ok(lista.includes('consultar_estoque'), 'tirar capacidade de quem não declarou tipo quebraria quem já funciona')
  assert.ok(lista.includes('buscar_memoria'))
})

test('7b) o override do dono NÃO devolve a base a quem o papel proíbe', async () => {
  const analista = { ...agenteCom('analyst'), knowledgeEnabled: true }
  const lista = (await resolveAgentTools(analista, OWNER)).map((t) => t.name)
  // Nem a base, nem o "olhar a fonte" — que é leitura de site, e portanto coleta.
  assert.ok(!lista.includes('verificar_fonte'), 'o analista recuperou a leitura de site por interruptor')

  // E onde o papel PERMITE, o interruptor continua mandando.
  const pesquisador = { ...agenteCom('researcher'), knowledgeEnabled: true }
  assert.ok((await resolveAgentTools(pesquisador, OWNER)).map((t) => t.name).includes('verificar_fonte'))
})

// --- a API carrega a regra até a tela ------------------------------------------------------

test('o agente devolvido pela API já diz o que ele pode fazer', async () => {
  const { toPublicAgent } = await import('../dist/agents.js')
  const publico = toPublicAgent(agenteCom('manager'))

  assert.equal(publico.roleConfig.role, 'coordinator')
  assert.equal(publico.roleConfig.allowedTools, false)
  assert.ok(!publico.roleConfig.sections.includes('ferramentas'))
  // Derivado, nunca gravado: o documento continua sem esse campo.
  assert.equal(agenteCom('manager').roleConfig, undefined)
  // E o que estava gravado continua saindo — a capacidade é ignorada, não apagada.
  assert.equal(publico.toolIds.length, 1)
  assert.equal(publico.tools.length, 1)
})

test('agente antigo, sem preset: a API responde do mesmo jeito, sem quebrar', async () => {
  const { toPublicAgent } = await import('../dist/agents.js')
  const legado = { ...agenteCom('custom') }
  delete legado.preset
  const publico = toPublicAgent(legado)
  // Sem preset ele é PERSONALIZADO — a ausência de perfil, não um executor. É o que
  // preserva os agentes montados à mão: eles continuam com o que o dono configurou.
  assert.equal(publico.roleConfig.role, 'custom')
  assert.equal(publico.roleConfig.allowedKnowledge, true)
  assert.equal(publico.roleConfig.allowedTools, true)
  assert.deepEqual(publico.roleConfig.legacyConflicts, [], 'nada dele é incompatível')
})

// --- num PLANO, quem procura é o pesquisador -------------------------------------------------
//
// O plano mostrava o analista e o coordenador consultando a base. O gate da busca já os
// impedia, mas três coisas ao redor dele vazavam: o balão acendia "consultando a base"
// para todo mundo, o painel emitia um evento de base para todo mundo, e as fontes vivas
// (o conteúdo de um site marcado para entrar sozinho) eram injetadas em qualquer papel —
// que é consultar base pela porta dos fundos.

const { runAgentTask } = await import('../dist/delegation.js')

/** As dependências mínimas para rodar UMA tarefa, com espiões no que interessa. */
const bancada = (preset, over = {}) => {
  const chamadas = { retrieve: 0, livePassages: 0, estados: [], trace: [] }
  const alvo = {
    _id: new ObjectId(),
    ownerId: OWNER,
    name: `Agente ${preset}`,
    preset,
    objective: 'trabalhar',
    provider: 'anthropic',
    ...over,
  }
  const deps = {
    loadAgent: async () => alvo,
    resolveTools: async () => [],
    apiKeyFor: async () => 'k',
    // A forma COMPLETA do que o executor devolve: um duplo que mente sobre o formato
    // faria o teste falhar por um motivo que não é o assunto dele.
    runTask: async () => ({
      status: 'succeeded',
      output: 'pronto',
      usage: { inputTokens: 1, outputTokens: 1 },
      toolCalls: [],
      format: { repaired: false },
      model: 'fake',
      provider: 'anthropic',
    }),
    retrieveContext: async () => {
      chamadas.retrieve += 1
      return { context: ['um trecho da base'], sources: [], status: 'ok' }
    },
    livePassages: async () => {
      chamadas.livePassages += 1
      return [{ title: 'Site vivo', content: 'conteúdo do site' }]
    },
    trackerFor: () => ({
      report: (estado) => chamadas.estados.push(estado),
      reportNow: async (estado) => chamadas.estados.push(estado),
      finish: async () => undefined,
    }),
    recordEvent: async () => undefined,
    chargeUsage: async () => undefined,
    startDelegation: async () => null,
    finishDelegation: async () => undefined,
  }
  return { alvo, deps, chamadas }
}

/** O contexto de uma execução no topo da cadeia — o mesmo formato do runtime. */
const contexto = (alvo, traceId = 't1') => ({
  ownerId: OWNER,
  buildingId: new ObjectId().toString(),
  correlationId: 'c1',
  callerAgentId: alvo._id.toString(),
  callerAgentName: alvo.name,
  ancestry: [],
  depth: 0,
  budget: { tokenLimit: 300_000, tokensSpent: 0 },
  traceId,
})

const rodar = async (preset, over) => {
  const { alvo, deps, chamadas } = bancada(preset, over)
  await runAgentTask(deps, contexto(alvo), alvo, 'qual foi o resultado do período?', 'entrada vinda de quem coletou', 'text')
  return chamadas
}

test('o analista NÃO consulta base, nem acende o balão, nem recebe site vivo', async () => {
  const c = await rodar('analyst')
  assert.equal(c.retrieve, 0, 'quem analisa trabalha sobre o que recebe')
  assert.equal(c.livePassages, 0, 'site vivo no prompt é consultar base pela porta dos fundos')
  assert.ok(!c.estados.includes('reading_knowledge'), 'o mapa mostrava trabalho que não estava acontecendo')
})

test('o coordenador também não — nem a própria base, nem fonte viva', async () => {
  for (const preset of ['manager', 'secretary']) {
    const c = await rodar(preset)
    assert.equal(c.retrieve, 0, preset)
    assert.equal(c.livePassages, 0, preset)
    assert.ok(!c.estados.includes('reading_knowledge'), preset)
  }
})

test('o pesquisador consulta — é o trabalho dele', async () => {
  const c = await rodar('researcher')
  assert.equal(c.retrieve, 1)
  assert.equal(c.livePassages, 1)
  assert.ok(c.estados.includes('reading_knowledge'))
})

test('o override do dono NÃO devolve a consulta a quem o papel proíbe', async () => {
  // Era a brecha: `knowledgeEnabled: true` reativava a base em qualquer papel, e um
  // analista voltava a analisar o que ele mesmo guardou em vez das evidências
  // recebidas. O interruptor agora só anda dentro do que o papel permite — e isto é
  // verificado no CAMINHO DE EXECUÇÃO, não só na matriz.
  const c = await rodar('analyst', { knowledgeEnabled: true })
  assert.equal(c.retrieve, 0, 'o analista continua sem consultar base própria')
})

test('"só responder com base no conhecimento" não bloqueia quem não consulta', async () => {
  // Sem isto, `grounding` é sempre 'no_base' para o analista e ele nunca responde: um
  // analista que nunca analisa. A exigência dele é ter ENTRADA, não ter base.
  const c = await rodar('analyst', { requireGrounding: true })
  assert.equal(c.retrieve, 0)
  assert.ok(!c.estados.includes('blocked'), 'a exigência é impossível para este papel, não é uma barreira legítima')
})

test('o pesquisador que EXIGE base continua sendo barrado quando não acha nada', async () => {
  const { alvo, deps, chamadas } = bancada('researcher', { requireGrounding: true })
  deps.retrieveContext = async () => {
    chamadas.retrieve += 1
    return { context: [], sources: [], status: 'empty' }
  }
  await assert.rejects(() => runAgentTask(deps, contexto(alvo), alvo, 'pergunta', '', 'text'))
  assert.equal(chamadas.retrieve, 1, 'ele procurou, não achou, e por isso parou — que é a regra funcionando')
})

// --- busca na web: só o pesquisador, só ligada -------------------------------------------------

const { readTrace } = await import('../dist/executionTrace.js')

/** Cada execução com a SUA trilha: o painel guarda por id, e reusar um id mistura testes. */
let proximoTrace = 0
const comBusca = async (preset, webSearch, over = {}) => {
  const traceId = `busca-${proximoTrace++}`
  const { alvo, deps, chamadas } = bancada(preset, { webSearch, ...over })
  // O adaptador genérico, para o teste não depender de credencial de nenhum serviço.
  process.env.WEB_SEARCH_PROVIDER = 'http'
  process.env.WEB_SEARCH_URL = 'https://busca.test/api?q={query}'
  try {
    await runAgentTask(deps, contexto(alvo, traceId), alvo, 'qual foi o resultado do trimestre?', '', 'text')
  } finally {
    delete process.env.WEB_SEARCH_URL
    delete process.env.WEB_SEARCH_PROVIDER
  }
  return { chamadas, alvo, traceId }
}

test('9) o painel mostra a decisão de NÃO buscar, com o motivo', async () => {
  // "Não procurou" e "procurou e não achou" precisam ser distinguíveis: só um deles é
  // motivo para mexer na configuração.
  const { alvo, traceId } = await comBusca('researcher', { enabled: true, policy: 'fallback_only' })
  const eventos = readTrace(traceId, OWNER)
  const busca = eventos.find((e) => /busca na web/.test(e.title))
  assert.ok(busca, `nenhum evento de busca; vieram: ${eventos.map((e) => e.title).join(' | ')}`)
  assert.match(busca.title, /não foi necessária/, 'a base respondeu, então não se procura fora')
  assert.match(busca.metadata.reason, /a base já respondeu/)
  assert.equal(busca.metadata.policy, 'fallback_only')
  assert.ok(alvo)
})

test('o pesquisador com a busca DESLIGADA não gera evento nenhum de busca', async () => {
  const { traceId } = await comBusca('researcher', { enabled: false })
  const eventos = readTrace(traceId, OWNER)
  assert.equal(eventos.filter((e) => /busca na web/.test(e.title)).length, 0)
})

test('analista e coordenador não buscam nem com o interruptor ligado', async () => {
  for (const preset of ['analyst', 'manager']) {
    const { traceId } = await comBusca(preset, { enabled: true, policy: 'always' })
    const eventos = readTrace(traceId, OWNER)
    assert.equal(eventos.filter((e) => /busca na web/.test(e.title)).length, 0, preset)
  }
})
