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

// --- o coordenador precisa SABER que tem equipe -------------------------------------------
//
// O direito de chamar os membros já era concedido; a informação de que eles existem, não.
// O coordenador recebia o próprio objetivo e o pedido, e mais nada — e um modelo que não
// sabe que tem equipe faz o óbvio: responde sozinho. Como coordenador quase nunca tem base
// própria, ele respondia sozinho e errado, com o dado na base de um colega do mesmo setor.

test('o coordenador recebe a equipe escrita: nome, id e função de cada membro', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager', delegationPolicy: 'none' })
  const pesquisador = agente('Pesquisador de Mercado', { capabilities: ['renda variável', 'proventos'] })
  const analista = agente('Analista', { role: 'compara cenários e recomenda' })
  const setor = {
    _id: new ObjectId(),
    name: 'Mesa de análise',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: coordenador._id,
    instruction: 'Responda em português.',
    members: [
      { agentId: coordenador._id, isDefault: true },
      { agentId: pesquisador._id, routingDescription: 'quando a pergunta for sobre preço ou provento de uma ação' },
      { agentId: analista._id },
    ],
    stages: [],
  }

  const f = deps([coordenador, pesquisador, analista], { sector: setor })
  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'qual foi o último provento de BBSE3?' })

  const pedidoDoCoordenador = f.chamadas[0]
  const instrucoes = pedidoDoCoordenador.instructions
  assert.match(instrucoes, /COORDENA a equipe "Mesa de análise"/)
  // O id é o que permite delegar sem gastar uma chamada de descoberta antes.
  assert.ok(instrucoes.includes(pesquisador._id.toString()), 'o id do pesquisador precisa estar na lista')
  assert.ok(instrucoes.includes(analista._id.toString()), 'o id do analista precisa estar na lista')
  // A frase que o dono escreveu sobre QUANDO mandar para ele vale mais que o objetivo.
  assert.match(instrucoes, /quando a pergunta for sobre preço ou provento/)
  assert.match(instrucoes, /compara cenários e recomenda/, 'sem descrição de roteamento, a função')
  assert.match(instrucoes, /renda variável, proventos/)
  // E a regra que fecha o buraco: o que é do especialista, delega.
  assert.match(instrucoes, /delegate_to_agent/)
  // O que o setor manda e o pedido continuam lá, depois do briefing.
  assert.match(instrucoes, /Responda em português\./)
  assert.match(instrucoes, /qual foi o último provento de BBSE3\?/)
  assert.equal(run.warnings.length, 0)
})

test('a equipe escrita NÃO entra na busca de conhecimento', async () => {
  // A consulta é montada a partir do objetivo e da entrada. Se o briefing entrasse ali,
  // a busca passaria a casar com nomes e competências dos membros em vez da pergunta —
  // e num briefing grande a própria pergunta cairia fora do limite de caracteres.
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const pesquisador = agente('Pesquisador de Mercado', { capabilities: ['renda variável'] })
  const setor = {
    _id: new ObjectId(),
    name: 'Mesa de análise',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: coordenador._id,
    instruction: '',
    members: [{ agentId: coordenador._id, isDefault: true }, { agentId: pesquisador._id }],
    stages: [],
  }
  const consultas = []
  const f = deps([coordenador, pesquisador], { sector: setor })
  const original = f.deps.retrieveContext
  f.deps.retrieveContext = (agentId, query, opts) => {
    consultas.push(query)
    return original(agentId, query, opts)
  }

  await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'qual foi o último provento de BBSE3?' })

  assert.ok(consultas.length > 0, 'a busca precisa ter acontecido')
  for (const q of consultas) {
    assert.ok(!q.includes('COORDENA a equipe'), 'o briefing vazou para a consulta')
    assert.ok(!q.includes(pesquisador._id.toString()), 'o id do membro vazou para a consulta')
  }
  assert.ok(consultas.some((q) => q.includes('BBSE3')), 'a pergunta é que deve ser buscada')
})

test('setor orquestrado sem outros membros avisa, em vez de parecer quebrado', async () => {
  // Um único participante no painel de teste parecia defeito. Não é: não há mais ninguém
  // no setor para acionar, e é isso que o aviso diz.
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const setor = {
    _id: new ObjectId(),
    name: 'Time de um',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: coordenador._id,
    instruction: '',
    members: [{ agentId: coordenador._id, isDefault: true }],
    stages: [],
  }
  const f = deps([coordenador], { sector: setor })
  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'e aí?' })

  assert.equal(run.participants.length, 1)
  assert.match(run.warnings.join(' '), /sem outros membros/)
  // E sem equipe não se inventa instrução de delegação: procurar quem não existe é pior.
  assert.ok(!f.chamadas[0].instructions.includes('COORDENA a equipe'))
})

// --- o caso da VALE3 e da BBSE3 ------------------------------------------------------------
//
// Relatado: perguntaram a cotação da Vale em 4 de agosto e a resposta veio com os números
// da BBSE3. Depois, perguntando pelo dia 6, veio de novo a linha do dia 4. As duas séries
// estavam na base; nenhuma das duas perguntas encontrava a LINHA.
//
// A causa não era o modelo. A busca determinística não entendia data escrita por gente
// ("4 de agosto") nem a data que as tabelas exportadas usam ("Aug 4, 2026") — e sem um
// termo de data para ancorar, a janela era recortada em volta do ticker, que aparece no
// TÍTULO. O modelo recebia sempre o começo do documento, nunca a linha pedida.

const CABECA = 'Date Open High Low Close Adj Close Volume'
const serie = (nome, base) =>
  [
    nome,
    'Currency in BRL. Historical data.',
    CABECA,
    ...Array.from({ length: 40 }, (_, i) => `Jul ${i + 1}, 2026 ${base}.00 ${base + 900}.00 ${base - 300}.00 ${base + 100}.00 ${base + 100}.00 1,${100 + i}`),
    `Aug 4, 2026 ${base + 1400}.00 ${base + 2500}.00 ${base + 1150}.00 ${base + 1480}.00 ${base + 1480}.00 2,088`,
    `Aug 5, 2026 ${base + 1660}.00 ${base + 1800}.00 ${base + 1400}.00 ${base + 1510}.00 ${base + 1510}.00 1,904`,
    `Aug 6, 2026 ${base + 1770}.00 ${base + 1880}.00 ${base + 1410}.00 ${base + 1620}.00 ${base + 1620}.00 2,210`,
  ].join('\n')

test('a linha do dia pedido é encontrada, mesmo escrita como as tabelas escrevem', async () => {
  const pesquisador = agente('Pesquisador de Mercado')
  await createDocumentFor({ ownerType: 'agent', ownerId: pesquisador._id }, { title: 'Ação Vale3', content: serie('Vale S.A. (VALE3.BA)', 22100) })
  await createDocumentFor({ ownerType: 'agent', ownerId: pesquisador._id }, { title: 'dados bbse3', content: serie('BB Seguridade (BBSE3.SA)', 40200) })

  const r = await retrieveContext([pesquisador._id], 'entao agora me da os valores da VALE3 do dia 6 de agosto')
  const texto = r.context.join('\n---\n')

  assert.equal(r.status, 'ok')
  // A linha PEDIDA, e não o começo do documento.
  assert.match(texto, /Aug 6, 2026/, 'a linha do dia 6 precisa estar no contexto')
  // E com o cabeçalho junto: sem ele, qual número é a abertura é adivinhação.
  assert.ok(texto.includes(CABECA), 'as colunas precisam viajar com a linha')
  // O documento certo vem primeiro: quem pergunta por VALE3 não pode receber a série da
  // BBSE3 como resposta mais relevante.
  assert.match(r.sources[0].title ?? '', /vale/i)
})

test('perguntar por outro dia devolve outra linha — e não a mesma de antes', async () => {
  const pesquisador = agente('Pesquisador de Mercado')
  await createDocumentFor({ ownerType: 'agent', ownerId: pesquisador._id }, { title: 'Ação Vale3', content: serie('Vale S.A. (VALE3.BA)', 22100) })

  const dia4 = await retrieveContext([pesquisador._id], 'valores da VALE3 no dia 4 de agosto de 2026')
  const dia6 = await retrieveContext([pesquisador._id], 'valores da VALE3 no dia 6 de agosto de 2026')

  // O sintoma mais claro do defeito: as duas perguntas recebiam exatamente o mesmo texto.
  assert.notEqual(dia4.context.join(''), dia6.context.join(''), 'dias diferentes não podem devolver o mesmo trecho')
  assert.match(dia4.context.join('\n'), /Aug 4, 2026/)
  assert.match(dia6.context.join('\n'), /Aug 6, 2026/)
})

test('com duas séries no contexto, o prompt avisa que os documentos são diferentes', async () => {
  const { multiSourceNotice } = await import('../dist/retrievalQuery.js')
  const aviso = multiSourceNotice([
    { documentId: 'a', title: 'Ação Vale3' },
    { documentId: 'b', title: 'dados bbse3' },
  ])
  assert.match(aviso, /documentos DIFERENTES/)
  assert.match(aviso, /Ação Vale3/)
  assert.match(aviso, /não use o número do outro/)
  // Uma fonte só não precisa de aviso nenhum.
  assert.equal(multiSourceNotice([{ documentId: 'a', title: 'Ação Vale3' }]), null)
})

// --- duas bases no MESMO agente ------------------------------------------------------------
//
// A pergunta era direta: com a tabela de cotações E o texto de uma notícia na base do
// mesmo agente, ele cruza as duas na resposta? A recuperação devolve UMA passagem por
// documento e corta por nota, top-K e orçamento de caracteres — então cabem as duas,
// desde que as duas tenham algum termo específico da pergunta.

test('a tabela e a notícia entram juntas no contexto do mesmo agente', async () => {
  const analista = agente('Analista de Mercado')
  await createDocumentFor(
    { ownerType: 'agent', ownerId: analista._id },
    { title: 'Cotações VALE3', content: serie('Vale S.A. (VALE3.BA)', 22100) },
  )
  await createDocumentFor(
    { ownerType: 'agent', ownerId: analista._id },
    {
      title: 'Notícia Vale',
      content:
        'Vale (VALE3) anuncia acordo em 6 de agosto de 2026.\n' +
        'A companhia informou ao mercado que fechou acordo de reparação, com impacto estimado no fluxo de caixa do trimestre. ' +
        'Analistas avaliaram o anúncio como positivo para o papel no curto prazo.',
    },
  )

  const r = await retrieveContext([analista._id], 'o que aconteceu com a VALE3 em 6 de agosto de 2026 e qual foi a cotação?')
  const titulos = r.sources.map((f) => f.title)

  assert.equal(r.status, 'ok')
  // As DUAS bases chegam ao modelo — é isso que permite cruzar preço com notícia.
  assert.ok(titulos.includes('Cotações VALE3'), `faltou a tabela: ${JSON.stringify(titulos)}`)
  assert.ok(titulos.includes('Notícia Vale'), `faltou a notícia: ${JSON.stringify(titulos)}`)
  const texto = r.context.join('\n')
  assert.match(texto, /Aug 6, 2026/, 'a linha do dia pedido')
  assert.match(texto, /acordo de reparação/, 'e o que a notícia diz')
})

test('um link solto na base não é a mesma coisa que a notícia', async () => {
  // Guardar só a URL guarda uma string. Nada lê aquela página na hora da resposta — para
  // isso existe o site cadastrado em "Como trabalha", que é consultado sob demanda.
  const analista = agente('Analista de Mercado')
  await createDocumentFor(
    { ownerType: 'agent', ownerId: analista._id },
    { title: 'Link da notícia', content: 'https://exemplo.test/noticias/vale-acordo-agosto-2026' },
  )

  const r = await retrieveContext([analista._id], 'o que a notícia diz sobre o acordo da Vale?')
  const texto = r.context.join('\n')
  // A URL pode até ser recuperada; o que ela NÃO tem é o conteúdo da notícia.
  assert.ok(!/acordo de reparação/.test(texto), 'não há texto de notícia nenhum guardado aqui')
})
