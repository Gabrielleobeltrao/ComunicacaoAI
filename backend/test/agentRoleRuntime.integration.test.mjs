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

test('3 e 4) pesquisador e executor recebem as ferramentas concedidas', async () => {
  for (const preset of ['researcher', 'operator', 'communicator', 'custom', 'monitor']) {
    const lista = await nomes(preset)
    assert.ok(lista.includes('consultar_estoque'), `${preset} precisa da ferramenta atribuída`)
    assert.ok(lista.includes('webhook_antigo'), `${preset}: a legada continua funcionando`)
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

test('7b) o override do dono devolve a base a quem não a usa por padrão', async () => {
  const analista = { ...agenteCom('analyst'), knowledgeEnabled: true }
  const lista = (await resolveAgentTools(analista, OWNER)).map((t) => t.name)
  // A base voltou, e com ela o "olhar a fonte" — que é leitura de site.
  assert.ok(lista.includes('verificar_fonte'))
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
  assert.equal(publico.roleConfig.role, 'executor')
  assert.equal(publico.roleConfig.allowedKnowledge, true)
})
