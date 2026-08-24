// O que as seis fases NÃO podiam quebrar.
//
// Cinco fases mexeram no caminho por onde passa todo agente: o contrato, o planejador, a
// execução de etapa, o formulário e a auditoria. Cada uma delas foi escrita para ser
// aditiva, e "aditivo" é fácil de afirmar e difícil de garantir — a mudança que quebra é
// justamente a que ninguém pensou em conferir, porque parecia não ter relação.
//
// Estas provas percorrem os quatro caminhos que existiam ANTES de tudo isso, com agentes
// sem um único campo novo, e conferem que eles continuam se comportando como sempre.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
delete process.env.VOYAGE_API_KEY

const { executeSectorTeam, runAgentTask, rootContext, sectorRunContext, buildDelegationTools } = await import('../dist/delegation.js')
const { runInteractive } = await import('../dist/interactiveRun.js')
const { mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'owner-regressao'
const PREDIO = new ObjectId()
const ANDAR = new ObjectId()

/**
 * Um agente EXATAMENTE como era antes da fase 1.
 *
 * Sem executorKind, sem responseMode, sem executorConfig, sem inputJsonSchema. É este o
 * agente que existe nas contas de verdade, e é ele que não pode mudar de comportamento.
 */
const agenteAntigo = (nome, over = {}) => ({
  _id: new ObjectId(),
  ownerId: OWNER,
  officeId: ANDAR,
  name: nome,
  objective: `objetivo de ${nome}`,
  provider: 'anthropic',
  model: null,
  preset: 'researcher',
  capabilities: [],
  activationModes: ['manual'],
  inputContract: '',
  outputContract: '',
  delegationPolicy: 'none',
  callerPolicy: 'all',
  callableAgentIds: [],
  callableSectorIds: [],
  allowedCallerAgentIds: [],
  ...over,
})

function deps(agentes, over = {}) {
  const porId = new Map(agentes.map((a) => [a._id.toString(), a]))
  const chamadas = []
  const base = {
    chamadas,
    deps: {
      loadAgent: async (ownerId, id) => {
        const a = porId.get(id.toString())
        return a && a.ownerId === ownerId ? a : null
      },
      loadSector: async () => over.sector ?? null,
      listAgentsInBuilding: async () => agentes,
      buildingIdForFloor: async () => PREDIO.toString(),
      resolveTools: over.resolveTools ?? (async () => []),
      apiKeyFor: async () => 'k',
      runTask: async (req) => {
        chamadas.push(req)
        return over.runTask ? over.runTask(req, base) : { output: `resposta de ${req.objective}`, usage: { inputTokens: 2, outputTokens: 3 }, toolCalls: [] }
      },
      startDelegation: async () => new ObjectId(),
      finishDelegation: async () => undefined,
      recordEvent: () => undefined,
      planWithModel: over.planWithModel,
    },
  }
  return base
}

const ctxSetor = () => sectorRunContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'regressao' })

// --- 1. a tarefa avulsa de um agente: rotina, gatilho, automação ------------------------------

test('ROTINA: um agente antigo executa uma tarefa e devolve o texto, como sempre', async () => {
  const a = agenteAntigo('Rotineiro')
  const f = deps([a])
  const ctx = rootContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'rotina', agent: a })
  const r = await runAgentTask(f.deps, ctx, a, 'gerar o relatório do dia', 'dados de entrada', undefined)

  // O pedido do momento vai em `instructions`; `objective` é o do próprio agente, que vale
  // para todo trabalho dele. Continua sendo assim.
  assert.match(String(f.chamadas[0].instructions), /gerar o relatório do dia/)
  assert.equal(f.chamadas[0].objective, a.objective)
  assert.ok(r.output)
  assert.equal(r.usage.inputTokens, 2)
  // Sem contrato declarado, nada de dado estruturado — e nenhuma validação a cumprir.
  assert.equal(r.json, undefined)
  assert.equal(f.chamadas.length, 1)
})

test('ROTINA: o formato pedido por quem chama continua mandando', async () => {
  const a = agenteAntigo('Rotineiro')
  const f = deps([a], {
    runTask: async (req) =>
      req.output?.format === 'json'
        ? { output: '{"ok":true}', json: { ok: true }, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [], format: { requested: 'json', valid: true, repaired: false } }
        : { output: 'texto', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] },
  })
  const ctx = rootContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'rotina', agent: a })
  const r = await runAgentTask(f.deps, ctx, a, 'trabalhar', '', 'json')
  assert.deepEqual(r.json, { ok: true })
})

// --- 2. a delegação de um agente para outro ------------------------------------------------------

test('DELEGAÇÃO: um agente antigo chama outro e recebe a resposta dele', async () => {
  const chamador = agenteAntigo('Chamador', { delegationPolicy: 'all' })
  const alvo = agenteAntigo('Especialista')
  const f = deps([chamador, alvo])
  const ctx = rootContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'deleg', agent: chamador })
  const ferramentas = buildDelegationTools(ctx, f.deps)
  const delegar = ferramentas.find((t) => t.name === 'delegate_to_agent')
  assert.ok(delegar, 'a ferramenta de delegação precisa existir para um agente que delega')

  const r = await delegar.run({ agentId: alvo._id.toString(), objective: 'levantar o número' })
  const corpo = JSON.parse(r.result)
  assert.ok(corpo.output, 'a resposta do colega volta para quem pediu')
  assert.ok(
    f.chamadas.some((c) => /levantar o número/.test(String(c.instructions ?? ''))),
    'o pedido chega ao especialista como instrução do momento',
  )
})

test('DELEGAÇÃO: um agente de OUTRA conta continua invisível', async () => {
  const chamador = agenteAntigo('Chamador', { delegationPolicy: 'all' })
  const alheio = agenteAntigo('Alheio', { ownerId: 'outra-conta' })
  const f = deps([chamador, alheio])
  const ctx = rootContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'deleg', agent: chamador })
  const delegar = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'delegate_to_agent')
  const r = await delegar.run({ agentId: alheio._id.toString(), objective: 'x' })
  assert.ok(!r.ok || /não/i.test(r.result), 'o agente de outra conta não pode ser alcançado')
})

// --- 3. o setor orquestrado, com agentes sem nenhum campo novo ----------------------------------

test('SETOR: um time inteiro de agentes antigos responde como sempre respondeu', async () => {
  const chefe = agenteAntigo('Chefe', { preset: 'manager' })
  const um = agenteAntigo('Um')
  const dois = agenteAntigo('Dois', { preset: 'analyst' })
  const setor = {
    _id: new ObjectId(),
    name: 'Mesa',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: chefe._id,
    instruction: '',
    members: [{ agentId: chefe._id, isDefault: true }, { agentId: um._id }, { agentId: dois._id }],
    stages: [],
  }
  const f = deps([chefe, um, dois], {
    sector: setor,
    planWithModel: async () =>
      JSON.stringify({
        tasks: [
          { id: 't1', agentId: um._id.toString(), objective: 'levantar' },
          { id: 't2', agentId: dois._id.toString(), objective: 'analisar', dependsOn: ['t1'] },
        ],
      }),
  })
  const run = await executeSectorTeam(f.deps, ctxSetor(), setor, { objective: 'pergunta de sempre' })

  assert.ok(run.output, 'a resposta final existe')
  // Nenhuma conferência de contrato pode aparecer: não há contrato nenhum declarado.
  assert.equal(run.warnings.filter((w) => /confere/.test(w)).length, 0, JSON.stringify(run.warnings))
  // E a ligação entre as etapas continua sendo o TEXTO, com autoria.
  assert.ok(f.chamadas.some((c) => /\[Um\]/.test(String(c.input ?? ''))))
  assert.ok(run.participants.some((p) => p.role === 'specialist'))
})

test('SETOR: sem modelo auxiliar, o plano determinístico continua respondendo', async () => {
  const chefe = agenteAntigo('Chefe', { preset: 'manager' })
  const um = agenteAntigo('Um')
  const setor = {
    _id: new ObjectId(),
    name: 'Mesa',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: chefe._id,
    instruction: '',
    members: [{ agentId: chefe._id, isDefault: true }, { agentId: um._id }],
    stages: [],
  }
  // `planWithModel` ausente: é a instalação sem modelo auxiliar, e ela nunca pode ficar sem
  // plano — um plano vazio faria o coordenador responder sozinho.
  const f = deps([chefe, um], { sector: setor })
  const run = await executeSectorTeam(f.deps, ctxSetor(), setor, { objective: 'qualquer coisa' })
  assert.ok(run.participants.some((p) => p.role === 'specialist'))
})

// --- 4. a conversa: playground, canal, widget -----------------------------------------------------

test('CONVERSA: o caminho interativo não conhece executor nenhum', async () => {
  // Playground, canal e widget passam por aqui. Nenhuma das fases mexeu neste caminho, e é
  // isto que a prova fixa: uma resposta de conversa continua sendo texto, sem contrato.
  const r = await runInteractive({
    reply: async () => ({ text: 'olá, tudo bem?', usage: { inputTokens: 4, outputTokens: 6 }, toolCalls: [] }),
    objective: 'atender',
    history: [{ role: 'user', content: 'oi' }],
  })
  assert.equal(r.text, 'olá, tudo bem?')
  assert.equal(r.outputValid, true)
  assert.equal(r.outputRepaired, false)
  assert.equal(r.json, undefined, 'sem contrato de saída não há dado a extrair')
})

test('CONVERSA: com contrato JSON, o dado sai lido — e o texto continua junto', async () => {
  const r = await runInteractive({
    reply: async () => ({ text: '{"titulo":"x"}', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
    objective: 'atender',
    history: [],
    output: { format: 'json', jsonSchema: { type: 'object', properties: { titulo: { type: 'string' } }, required: ['titulo'] } },
  })
  assert.deepEqual(r.json, { titulo: 'x' })
  assert.equal(r.text, '{"titulo":"x"}')
})

test('CONVERSA: o reparo continua sendo UM por padrão, e continua sendo cobrado', async () => {
  let chamadas = 0
  const r = await runInteractive({
    reply: async () => {
      chamadas += 1
      return { text: chamadas === 1 ? '{"errado":1}' : '{"titulo":"certo"}', usage: { inputTokens: 5, outputTokens: 5 }, toolCalls: [] }
    },
    objective: 'atender',
    history: [],
    output: { format: 'json', jsonSchema: { type: 'object', properties: { titulo: { type: 'string' } }, required: ['titulo'] } },
  })
  assert.equal(chamadas, 2)
  assert.equal(r.outputRepaired, true)
  assert.equal(r.usage.inputTokens, 10, 'as duas chamadas entram na mesma conta')
})
