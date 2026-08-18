// INTEGRAÇÃO: o setor executa como time — e encontra o que o time sabe.
//
// O defeito reproduzido: num setor orquestrado com coordenador, pesquisador e analista,
// o pesquisador tinha a série histórica de BBSE3 e o Playground respondia que não havia
// dados. Duas causas somadas:
//
//   1. O Playground e o canal NÃO executavam o time. Um modelo auxiliar escolhia nomes de
//      especialistas e uma única inferência era feita com o membro marcado como padrão.
//      `coordinatorAgentId` e `stages` nunca eram lidos; o pesquisador nunca rodava.
//   2. A busca de conhecimento era só `$vectorSearch`, que exige Atlas Search e um
//      embedding da Voyage. Sem os dois — como aqui, e como em qualquer mongod próprio —
//      ela falha SEMPRE, e o documento nem chega a virar chunk.
//
// Aqui o mongod é de verdade, os documentos são de verdade e a indexação vetorial falha
// de verdade (não há chave de embedding). O que está dublado é só o modelo: `runTask`
// decide, de forma determinística, o que cada agente "responderia" — inclusive acionar o
// especialista, que é o que um coordenador faz com as ferramentas de delegação na mão.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
// Sem chave: a indexação vetorial falha e o documento fica com `indexStatus: 'error'` e
// zero chunks. É exatamente o estado da instalação em que o defeito apareceu.
delete process.env.VOYAGE_API_KEY

const { executeSectorTeam, sectorRunContext, rootContext, buildDelegationTools, TEAM_TOOL_NAMES } = await import('../dist/delegation.js')
const { createDocumentFor } = await import('../dist/knowledge.js')
const { retrieveContext } = await import('../dist/knowledge.js')
const { db } = await import('../dist/db.js')

const OWNER = 'owner-setor'
const OUTRO_DONO = 'owner-vizinho'
const PREDIO = new ObjectId()
const ANDAR = new ObjectId()

const { mongoClient } = await import('../dist/db.js')
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await db.collection('knowledge_documents').deleteMany({})
  await db.collection('knowledge_chunks').deleteMany({})
})

const agente = (nome, over = {}) => ({
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

// As dependências reais onde importa (banco, conhecimento) e dubladas onde o teste
// precisa decidir (o modelo).
function deps(agentes, over = {}) {
  const porId = new Map(agentes.map((a) => [a._id.toString(), a]))
  const chamadas = []
  const eventos = []
  const base = {
    chamadas,
    eventos,
    deps: {
      loadAgent: async (ownerId, id) => {
        const a = porId.get(id.toString())
        // Escopo de conta: um agente de outro dono não existe para este.
        return a && a.ownerId === ownerId ? a : null
      },
      loadSector: async () => over.sector ?? null,
      listAgentsInBuilding: async () => agentes,
      buildingIdForFloor: async () => PREDIO.toString(),
      resolveTools: over.resolveTools ?? (async () => []),
      apiKeyFor: async () => 'k',
      runTask: async (req) => {
        chamadas.push(req)
        return over.runTask
          ? over.runTask(req, base)
          : { output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
      },
      startDelegation: async () => new ObjectId(),
      finishDelegation: async () => undefined,
      recordEvent: (e) => eventos.push(e),
      // A busca de verdade, contra o banco de verdade.
      retrieveContext: (agentId, query, opts) => retrieveContext(agentId, query, { verifiedSectorId: opts.sectorId ?? null }),
    },
  }
  return base
}

const ctxPessoa = () => sectorRunContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'teste' })

const BBSE3 = 'Série histórica BBSE3.\nEm 10/08/2026 o papel BBSE3 fechou a R$ 36,42.\nEm 11/08/2026 fechou a R$ 36,90.'

// --- o caso relatado -------------------------------------------------------------------

test('o coordenador aciona o pesquisador, e a resposta traz o valor que está na base dele', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager', delegationPolicy: 'none' })
  const pesquisador = agente('Pesquisador')
  const analista = agente('Analista')
  const setor = {
    _id: new ObjectId(),
    name: 'Mesa de análise',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: coordenador._id,
    instruction: '',
    members: [{ agentId: coordenador._id, isDefault: true }, { agentId: pesquisador._id }, { agentId: analista._id }],
    stages: [],
  }
  // A base é do PESQUISADOR — não do coordenador. Era esse o ponto do defeito.
  await createDocumentFor({ ownerType: 'agent', ownerId: pesquisador._id }, { title: 'BBSE3 histórico', content: BBSE3 })

  const f = deps([coordenador, pesquisador, analista], {
    sector: setor,
    // As ferramentas de delegação de verdade, ligadas ao contexto-filho — é assim que o
    // coordenador alcança o time.
    resolveTools: async (alvo, ownerId, childCtx) =>
      alvo._id.toString() === coordenador._id.toString() ? buildDelegationTools(childCtx, f.deps) : [],
    runTask: async (req, self) => {
      // O coordenador delega ao pesquisador — o que um coordenador faz.
      const delega = (req.tools ?? []).find((t) => t.name === 'delegate_to_agent')
      if (delega) {
        const r = await delega.run({ agentId: pesquisador._id.toString(), objective: req.instructions })
        return { output: `Resposta do time: ${JSON.parse(r.result).output}`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
      }
      // O pesquisador responde a partir do que a base entregou a ele.
      const trecho = (req.context ?? []).join('\n')
      const achado = /R\$ 36,42/.test(trecho) ? 'R$ 36,42' : 'não tenho esses dados'
      void self
      return { output: `Em 10/08/2026, BBSE3 fechou a ${achado}.`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })

  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, {
    objective: 'Qual foi a cotação de BBSE3 em 10/08/2026?',
  })

  assert.match(run.output, /R\$ 36,42/, 'a resposta precisa trazer o valor que está na base')
  assert.doesNotMatch(run.output, /não tenho esses dados/)
  // E o pesquisador precisa aparecer como quem trabalhou.
  const nomes = f.chamadas.map((c) => c.objective)
  assert.ok(nomes.some((o) => o === pesquisador.objective), 'o pesquisador precisa ter executado de verdade')
  assert.equal(run.participants[0].role, 'coordinator')
})

test('a data escrita em ISO encontra o documento escrito em português', async () => {
  const pesquisador = agente('Pesquisador')
  await createDocumentFor({ ownerType: 'agent', ownerId: pesquisador._id }, { title: 'BBSE3', content: BBSE3 })

  const r = await retrieveContext([pesquisador._id], 'cotação de BBSE3 em 2026-08-10')
  assert.equal(r.status, 'ok', 'sem Atlas e sem Voyage, a busca exata é a que responde')
  assert.match(r.context.join('\n'), /36,42/)
  assert.ok(r.sources[0].title, 'a fonte precisa vir nomeada')
})

test('a base de outra conta nunca é alcançada', async () => {
  const meu = agente('Meu')
  const alheio = agente('Alheio', { ownerId: OUTRO_DONO })
  await createDocumentFor({ ownerType: 'agent', ownerId: alheio._id }, { title: 'BBSE3 do vizinho', content: BBSE3 })

  const r = await retrieveContext([meu._id], 'BBSE3 em 10/08/2026')
  assert.equal(r.context.length, 0, 'o documento do vizinho não pode aparecer')
  assert.notEqual(r.status, 'ok')
})

test('quando a busca não pode rodar, o status é unavailable — e não "vazio"', async () => {
  const pesquisador = agente('Pesquisador')
  // Nenhum documento: o léxico não acha nada e o vetorial falhou (sem Atlas/Voyage).
  const r = await retrieveContext([pesquisador._id], 'BBSE3 em 10/08/2026')
  assert.equal(r.status, 'unavailable')
  assert.equal(r.failed, true, 'dizer "não existe" aqui seria afirmar o que não se sabe')
})

// --- memória determinística --------------------------------------------------------------

test('o mesmo caso, com o dado na memória determinística em vez da base', async () => {
  const { ensureMemoryIndexes, writeMemory, searchMemory, scopeKeyOf } = await import('../dist/memory/records.js')
  await ensureMemoryIndexes()
  const pesquisador = agente('Pesquisador')
  await writeMemory({
    tenantId: OWNER,
    target: { scope: 'agent', agentId: pesquisador._id },
    key: 'bbse3:2026-08-10',
    payload: { ativo: 'BBSE3', data: '10/08/2026', fechamento: 'R$ 36,42' },
    strategy: 'upsert',
  })

  // A mesma consulta que `buscar_memoria` faz — determinística, sem modelo nenhum.
  const achado = await searchMemory({
    tenantId: OWNER,
    scopeKeys: [scopeKeyOf({ scope: 'agent', agentId: pesquisador._id })],
    query: 'BBSE3',
  })
  assert.equal(achado.total, 1)
  assert.match(JSON.stringify(achado.records ?? achado.items ?? achado), /36,42/)

  // E a de outra conta não alcança este registro.
  const alheio = await searchMemory({
    tenantId: OUTRO_DONO,
    scopeKeys: [scopeKeyOf({ scope: 'agent', agentId: pesquisador._id })],
    query: 'BBSE3',
  })
  assert.equal(alheio.total, 0, 'memória não atravessa conta')
})

// --- pipeline por etapas ------------------------------------------------------------------

test('pipeline com members vazio executa TODAS as etapas, na ordem, encadeando a saída', async () => {
  const um = agente('Coleta')
  const dois = agente('Análise')
  const tres = agente('Redação')
  const setor = {
    _id: new ObjectId(),
    name: 'Esteira',
    officeId: ANDAR,
    mode: 'pipeline',
    // members VAZIO de propósito: o editor novo salva etapas e limpa membros, e o
    // Playground antigo resolvia membros — por isso não executava nada.
    members: [],
    stages: [
      { id: 's1', name: 'Coleta', agentId: um._id, instruction: 'colete', dependsOn: [], inputMapping: {}, expectedOutput: '', retryPolicy: { maxAttempts: 1, backoffMs: 0 }, onError: 'stop' },
      { id: 's2', name: 'Análise', agentId: dois._id, instruction: 'analise', dependsOn: ['s1'], inputMapping: {}, expectedOutput: '', retryPolicy: { maxAttempts: 1, backoffMs: 0 }, onError: 'stop' },
      { id: 's3', name: 'Redação', agentId: tres._id, instruction: 'escreva', dependsOn: ['s2'], inputMapping: {}, expectedOutput: '', retryPolicy: { maxAttempts: 1, backoffMs: 0 }, onError: 'stop' },
    ],
  }
  const f = deps([um, dois, tres], {
    sector: setor,
    runTask: async (req) => ({ output: `${req.objective}<-${String(req.input ?? '')}`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  })

  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'faça o relatório', input: 'entrada' })

  assert.equal(run.participants.length, 3, 'as três etapas precisam executar')
  assert.deepEqual(run.participants.map((p) => p.stageName), ['Coleta', 'Análise', 'Redação'])
  assert.deepEqual(run.participants.map((p) => p.order), [1, 2, 3])
  // A saída de uma etapa é a entrada da seguinte.
  assert.match(run.output, /objetivo de Redação<-objetivo de Análise<-/)
})

// --- cada agente com a sua configuração ---------------------------------------------------

test('cada agente do time roda com o PRÓPRIO provedor e modelo', async () => {
  const coordenador = agente('Coordenador', { provider: 'anthropic', model: 'claude-sonnet-5', preset: 'manager' })
  const pesquisador = agente('Pesquisador', { provider: 'openai', model: 'gpt-5' })
  const setor = {
    _id: new ObjectId(),
    name: 'Time',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: coordenador._id,
    instruction: '',
    members: [{ agentId: coordenador._id, isDefault: true }, { agentId: pesquisador._id }],
    stages: [],
  }
  const f = deps([coordenador, pesquisador], {
    sector: setor,
    resolveTools: async (alvo, _o, childCtx) =>
      alvo._id.toString() === coordenador._id.toString() ? buildDelegationTools(childCtx, f.deps) : [],
    runTask: async (req) => {
      const delega = (req.tools ?? []).find((t) => t.name === 'delegate_to_agent')
      if (delega) {
        await delega.run({ agentId: pesquisador._id.toString(), objective: 'pesquise' })
        return { output: 'pronto', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
      }
      return { output: 'dado', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })

  await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'pergunta' })

  const porProvedor = f.chamadas.map((c) => `${c.provider}:${c.model}`)
  assert.ok(porProvedor.includes('anthropic:claude-sonnet-5'), 'o coordenador usa o modelo dele')
  assert.ok(porProvedor.includes('openai:gpt-5'), 'o pesquisador usa o DELE — e não o do coordenador')
})

// --- o Playground não escreve ---------------------------------------------------------------

test('no Playground, ferramenta de escrita não chega a nenhum agente do time', async () => {
  const { playgroundDelegationDeps } = await import('../dist/delegationWiring.js')
  const depsTeste = playgroundDelegationDeps()
  const alvo = agente('Executor', { delegationPolicy: 'all' })

  // O resolvedor real, com o agente sem ferramenta própria: sobram as builtins e as de
  // time. Nenhuma de escrita pode passar.
  const ctx = rootContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'c', agent: alvo })
  const ferramentas = await depsTeste.resolveTools(alvo, OWNER, { ...ctx, sectorGrant: { sectorId: 'x', memberIds: [new ObjectId().toString()] } })

  const escrita = ferramentas.filter((t) => (t.risk ?? 'write') !== 'read' && !TEAM_TOOL_NAMES.includes(t.name))
  assert.deepEqual(escrita.map((t) => t.name), [], 'nada que escreva pode sobrar no teste')
  // E o time continua alcançável, senão não haveria o que testar.
  assert.ok(ferramentas.some((t) => t.name === 'delegate_to_agent'))
  assert.ok(ferramentas.some((t) => t.name === 'buscar_memoria'), 'buscar_memoria é leitura e continua disponível')
})

// --- organization não executa ----------------------------------------------------------------

test('um setor de organização não é executado por este caminho', async () => {
  const a = agente('A')
  const setor = { _id: new ObjectId(), name: 'Grupo', officeId: ANDAR, mode: 'orchestrated', members: [], stages: [] }
  const f = deps([a], { sector: setor })
  // Sem coordenador e sem membros não há quem executar — e o erro diz isso.
  await assert.rejects(() => executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'x' }), /coordenador nem membros/)
})

test('o fallback do time procura na base dos colegas quando a do coordenador não responde', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const pesquisador = agente('Pesquisador')
  const setor = {
    _id: new ObjectId(),
    name: 'Time',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: coordenador._id,
    instruction: '',
    members: [{ agentId: coordenador._id, isDefault: true }, { agentId: pesquisador._id }],
    stages: [],
  }
  // A base é do pesquisador; o coordenador não tem nenhuma.
  await createDocumentFor({ ownerType: 'agent', ownerId: pesquisador._id }, { title: 'BBSE3', content: BBSE3 })

  // O coordenador NÃO delega — é o pior caso, e é onde a rede de segurança vale.
  const f = deps([coordenador, pesquisador], {
    sector: setor,
    runTask: async (req) => ({ output: (req.context ?? []).join('\n'), usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  })

  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'BBSE3 em 10/08/2026' })
  assert.match(run.output, /36,42/, 'a base do colega do mesmo setor é consultada antes de concluir ausência')
})

// --- um executor só, pelas três portas ------------------------------------------------------

test('delegate_to_sector executa as etapas pelo mesmo executor', async () => {
  const um = agente('Etapa um')
  const dois = agente('Etapa dois')
  const chamador = agente('Chamador', { delegationPolicy: 'all' })
  const setor = {
    _id: new ObjectId(),
    name: 'Esteira',
    officeId: ANDAR,
    mode: 'pipeline',
    members: [],
    stages: [
      { id: 's1', name: 'Um', agentId: um._id, instruction: 'a', dependsOn: [], inputMapping: {}, expectedOutput: '', retryPolicy: { maxAttempts: 1, backoffMs: 0 }, onError: 'stop' },
      { id: 's2', name: 'Dois', agentId: dois._id, instruction: 'b', dependsOn: ['s1'], inputMapping: {}, expectedOutput: '', retryPolicy: { maxAttempts: 1, backoffMs: 0 }, onError: 'stop' },
    ],
  }
  const f = deps([um, dois, chamador], {
    sector: setor,
    runTask: async (req) => ({ output: `saída de ${req.objective}`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  })
  const ctx = rootContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'c', agent: chamador })
  const ferramenta = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'delegate_to_sector')

  const r = await ferramenta.run({ sectorId: setor._id.toString(), objective: 'faça' })
  const corpo = JSON.parse(r.result)

  assert.equal(corpo.status, 'ok')
  assert.equal(f.chamadas.length, 2, 'as duas etapas executam pela ferramenta também')
  assert.deepEqual(corpo.participants, ['Etapa um', 'Etapa dois'], 'a ferramenta diz quem trabalhou')
})

test('não existe mais um segundo caminho de execução de setor no código', async () => {
  // Uma prova estrutural: o defeito era ter DUAS implementações com o mesmo nome. Se
  // uma delas voltar, este teste é quem avisa.
  const { readFileSync } = await import('node:fs')
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

  // O Playground e o canal chamam o executor único — as duas portas.
  const chamadas = index.split('executeSectorTeam(').length - 1
  assert.ok(chamadas >= 2, `o Playground e o canal precisam usar o executor único (achei ${chamadas} chamadas)`)

  // E o roteador conversacional paralelo não existe mais.
  for (const morto of ['resolveSectorTurn(', 'planSectorResponse(', 'planStageTransition(', 'buildStageTransitionOptions(']) {
    assert.ok(!index.includes(morto), `${morto} voltou a existir — são dois comportamentos de novo`)
  }
})

// --- amplitude: saber que existe mais do que coube ------------------------------------------
//
// Sem isto o agente recebe seis trechos sem saber se são seis de seis ou seis de dois mil.
// Nos dois casos ele responde com a mesma confiança — e no segundo a resposta é um recorte
// arbitrário apresentado como conclusão.

test('a busca informa quantos trechos correspondiam, e não só os que couberam', async () => {
  const pesquisador = agente('Pesquisador')
  // Vinte documentos que casam com o mesmo termo: a seleção corta bem antes disso.
  for (let i = 0; i < 20; i++) {
    await createDocumentFor(
      { ownerType: 'agent', ownerId: pesquisador._id },
      { title: `Ata ${i}`, content: `Reunião ${i} sobre BBSE3 e o mercado, com deliberações e anexos.` },
    )
  }

  const r = await retrieveContext([pesquisador._id], 'BBSE3')
  assert.equal(r.status, 'ok')
  assert.ok(r.totalMatches >= 20, `esperava ao menos 20 correspondências, veio ${r.totalMatches}`)
  assert.ok(r.context.length < r.totalMatches, 'o que coube é menos que o que existe')
  assert.equal(r.truncated, true, 'e isso precisa vir dito, não deduzido')
})

test('quando tudo coube, não há aviso de amplitude', async () => {
  const pesquisador = agente('Pesquisador')
  await createDocumentFor({ ownerType: 'agent', ownerId: pesquisador._id }, { title: 'Única', content: BBSE3 })

  const r = await retrieveContext([pesquisador._id], 'BBSE3 em 10/08/2026')
  assert.equal(r.truncated, undefined, 'inventar amplitude onde não há é tão ruim quanto escondê-la')
})

// --- o time também pode perguntar em vez de chutar -----------------------------------------
//
// O esclarecimento funcionava entre agentes (o especialista devolve `needs_clarification`
// ao coordenador) e sumia justamente quando quem perguntava era o coordenador — que é
// quem fala com o visitante.

test('quando o coordenador pede recorte, o pedido chega a quem falou com ele', async () => {
  const { CLARIFY_TOOL_NAME } = await import('../dist/clarify.js')
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const setor = {
    _id: new ObjectId(),
    name: 'Time',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: coordenador._id,
    instruction: '',
    members: [{ agentId: coordenador._id, isDefault: true }],
    stages: [],
  }
  const f = deps([coordenador], {
    sector: setor,
    runTask: async () => ({
      output: 'De qual período você precisa?',
      usage: { inputTokens: 1, outputTokens: 1 },
      toolCalls: [
        {
          name: CLARIFY_TOOL_NAME,
          ok: true,
          arguments: { pergunta: 'De qual período?', motivo: 'o pedido cobre 3 anos', opcoes: ['7 dias', '30 dias'] },
          result: '{}',
        },
      ],
    }),
  })

  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'me fale do mercado' })

  assert.ok(run.clarification, 'sem isto o canal não tem como marcar o turno nem escrever as opções')
  assert.equal(run.clarification.question, 'De qual período?')
  assert.deepEqual(run.clarification.options, ['7 dias', '30 dias'])
})

test('uma execução comum do time não traz pedido nenhum', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const setor = {
    _id: new ObjectId(),
    name: 'Time',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: coordenador._id,
    instruction: '',
    members: [{ agentId: coordenador._id, isDefault: true }],
    stages: [],
  }
  const f = deps([coordenador], { sector: setor })
  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'oi' })
  assert.equal(run.clarification, null)
})
