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
  // A ordem mudou quando o runtime passou a executar o plano: o especialista trabalha
  // primeiro e o coordenador entra no fim, para juntar. Quem executou continua o mesmo.
  assert.equal(run.participants.at(-1).role, 'coordinator')
  assert.ok(run.participants.some((p) => p.role === 'specialist'))
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

  // O coordenador é o último a rodar: antes dele vão as tarefas do plano.
  const pedidoDoCoordenador = f.chamadas.at(-1)
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

// --- o plano, no começo do orquestrado -----------------------------------------------------
//
// Antes: o coordenador tinha as ferramentas e a lista da equipe, e a decisão de acionar
// alguém era um impulso no meio da resposta. Agora a distribuição é um passo declarado —
// e o coordenador recebe a lista de chamadas a fazer, não só a lista de quem existe.

test('o plano chega ao coordenador como passos, com objetivo por membro', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const juridico = agente('Jurídico', { capabilities: ['contratos'] })
  const financeiro = agente('Financeiro', { capabilities: ['orcamento'] })
  const setor = {
    _id: new ObjectId(),
    name: 'Retaguarda',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: coordenador._id,
    instruction: '',
    members: [
      { agentId: coordenador._id, isDefault: true },
      { agentId: juridico._id, routingDescription: 'quando envolver contrato ou cláusula' },
      { agentId: financeiro._id, routingDescription: 'quando envolver custo ou orçamento' },
    ],
    stages: [],
  }

  const f = deps([coordenador, juridico, financeiro], { sector: setor })
  // O "modelo" do planejador, dublado: devolve o plano que o teste quer observar. É o
  // único ponto em que o planejador fala com fora — por isso ele é injetado.
  f.deps.planWithModel = async () =>
    JSON.stringify({
      tasks: [
        { id: 'p1', agentId: juridico._id.toString(), objective: 'avaliar o risco da cláusula' },
        { id: 'p2', agentId: financeiro._id.toString(), objective: 'estimar o custo', dependsOn: ['p1'] },
      ],
      synthesisObjective: 'risco e custo numa resposta só',
    })

  await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'qual o risco da cláusula e quanto custa?' })

  const instrucoes = f.chamadas.at(-1).instructions
  assert.match(instrucoes, /PLANO PARA ESTE PEDIDO/)
  assert.match(instrucoes, /Acione Jurídico/)
  assert.match(instrucoes, /avaliar o risco da cláusula/)
  assert.match(instrucoes, /Acione Financeiro/)
  // A dependência vira instrução em português, e não um campo que o modelo teria de decifrar.
  assert.match(instrucoes, /só depois de \(t1\)/)
  assert.match(instrucoes, /risco e custo numa resposta só/)
})

test('sem modelo planejador, o plano determinístico ainda faz o especialista trabalhar', async () => {
  // Instalação sem modelo auxiliar: o planejador cai no determinístico, e o runtime
  // executa esse plano igual. É o ponto do objetivo — a equipe deixa de depender de o
  // coordenador lembrar de chamar alguém.
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const especialista = agente('Especialista')
  const setor = {
    _id: new ObjectId(),
    name: 'Time',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: coordenador._id,
    instruction: '',
    members: [{ agentId: coordenador._id, isDefault: true }, { agentId: especialista._id }],
    stages: [],
  }
  const f = deps([coordenador, especialista], { sector: setor })
  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'me ajuda com uma coisa' })

  assert.deepEqual(run.participants.map((p) => p.role), ['specialist', 'coordinator'])
  assert.match(f.chamadas.at(-1).instructions, /Junte os resultados/)
})

// --- consultar a base de um colega NÃO é acionar o colega ------------------------------------
//
// A distinção que o motor precisa manter: achar um trecho na base de alguém é leitura de
// documento, sai no mesmo turno e não custa inferência nenhuma. Acionar esse alguém é
// outra execução, com o modelo e as ferramentas dele. Se a primeira contasse como a
// segunda, o painel mostraria dois agentes trabalhando onde um trabalhou, e a conta de
// tokens do time deixaria de bater.

test('achar o dado na base de um colega não transforma o colega em participante', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const redator = agente('Redator')
  const arquivista = agente('Arquivista')
  const setor = {
    _id: new ObjectId(),
    name: 'Mesa',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: coordenador._id,
    instruction: '',
    members: [{ agentId: coordenador._id, isDefault: true }, { agentId: redator._id }, { agentId: arquivista._id }],
    stages: [],
  }
  // A base é do ARQUIVISTA. O plano aciona só o REDATOR — então o arquivista é lido, e
  // não executado. É a distinção inteira em um teste: RAG entre agentes não é colaboração.
  await createDocumentFor({ ownerType: 'agent', ownerId: arquivista._id }, { title: 'Série BBSE3', content: BBSE3 })

  const f = deps([coordenador, redator, arquivista], { sector: setor })
  f.deps.planWithModel = async () =>
    JSON.stringify({ tasks: [{ id: 't1', agentId: redator._id.toString(), objective: 'redigir o resumo' }] })
  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'quanto valia BBSE3 em 10/08/2026?' })

  assert.deepEqual(run.participants.map((p) => p.name), ['Redator', 'Coordenador'], 'o dono da base não executou')
  // E o trecho dele chegou assim mesmo — como conhecimento, não como colaboração.
  const contextos = f.chamadas.map((c) => (c.context ?? []).join('\n')).join('\n')
  assert.match(contextos, /36,42/)
})

// --- o RUNTIME executa o plano ---------------------------------------------------------------
//
// Antes: coordenador chama A, gosta da resposta, e B nunca é consultado — o plano existia
// e podia ser ignorado no meio de uma inferência. Agora as tarefas rodam no runtime, em
// ondas, e a síntese recebe o que todo mundo produziu.

const equipeDe = (coordenador, membros) => ({
  _id: new ObjectId(),
  name: 'Retaguarda',
  officeId: ANDAR,
  mode: 'orchestrated',
  coordinatorAgentId: coordenador._id,
  instruction: '',
  members: [{ agentId: coordenador._id, isDefault: true }, ...membros.map((m) => ({ agentId: m._id }))],
  stages: [],
})

// A prova de paralelismo é uma BARREIRA, não um cronômetro.
//
// Comparar janelas de tempo mente aqui: a busca de conhecimento roda contra um mongod de
// verdade e leva de 100 a 200 ms, então duas tarefas concorrentes podem ter janelas de
// modelo que não se sobrepõem mesmo tendo começado juntas. Com a barreira não há dúvida:
// cada tarefa só termina depois que a outra chegou. Em execução serial isto trava — e o
// teste falha dizendo isso, em vez de passar por acidente.
const barreira = (quantos, limiteMs = 5000) => {
  let chegaram = 0
  let liberar
  const todos = new Promise((r) => (liberar = r))
  return async (nome) => {
    chegaram += 1
    if (chegaram >= quantos) liberar()
    const estourou = new Promise((_, rejeitar) =>
      setTimeout(() => rejeitar(new Error(`execução serial: ${nome} esperou sozinho`)), limiteMs),
    )
    await Promise.race([todos, estourou])
    return chegaram
  }
}

test('tarefas independentes rodam em PARALELO, e a síntese usa as duas', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const a = agente('Agente A')
  const b = agente('Agente B')
  const setor = equipeDe(coordenador, [a, b])
  const esperar = barreira(2)

  const f = deps([coordenador, a, b], {
    sector: setor,
    runTask: async (req) => {
      if (/Junte os resultados/.test(req.instructions)) {
        return { output: 'resposta final', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
      }
      // Só termina quando a outra tarefa também estiver aqui dentro.
      await esperar(req.instructions)
      return { output: `saída de ${req.instructions}`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })
  f.deps.planWithModel = async () =>
    JSON.stringify({
      tasks: [
        { id: 't1', agentId: a._id.toString(), objective: 'parte A' },
        { id: 't2', agentId: b._id.toString(), objective: 'parte B' },
      ],
    })

  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'preciso de A e de B' })

  // Os três executaram: A, B e o coordenador juntando.
  assert.equal(run.participants.length, 3)
  assert.equal(run.output, 'resposta final')

  // E a síntese recebeu os DOIS resultados, cada um com seu autor.
  const sintese = f.chamadas.find((c) => /Junte os resultados/.test(c.instructions))
  assert.match(sintese.input, /ORIGINAL USER QUESTION/)
  assert.match(sintese.input, /preciso de A e de B/)
  assert.match(sintese.input, /\[Agente A\]/)
  assert.match(sintese.input, /saída de parte A/)
  assert.match(sintese.input, /\[Agente B\]/)
  assert.match(sintese.input, /saída de parte B/)
  assert.match(sintese.input, /SYNTHESIS INSTRUCTIONS/)
})

test('quem depende de dois só roda depois dos dois — e recebe o que eles produziram', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const a = agente('Agente A')
  const b = agente('Agente B')
  const c = agente('Agente C')
  const setor = equipeDe(coordenador, [a, b, c])
  const ordem = []

  const f = deps([coordenador, a, b, c], {
    sector: setor,
    runTask: async (req) => {
      if (/Junte os resultados/.test(req.instructions)) return { output: 'final', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
      ordem.push(req.instructions)
      await new Promise((r) => setTimeout(r, 20))
      return { output: `saída de ${req.instructions}`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })
  f.deps.planWithModel = async () =>
    JSON.stringify({
      tasks: [
        { id: 't1', agentId: a._id.toString(), objective: 'parte A' },
        { id: 't2', agentId: b._id.toString(), objective: 'parte B' },
        { id: 't3', agentId: c._id.toString(), objective: 'junta A e B', dependsOn: ['t1', 't2'] },
      ],
    })

  await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'A, B e depois C' })

  // C é o último a começar, sempre.
  assert.equal(ordem.at(-1), 'junta A e B')
  // E a entrada de C traz o que A e B produziram, com autoria — não a pergunta de novo.
  const chamadaC = f.chamadas.find((c) => c.instructions === 'junta A e B')
  assert.match(chamadaC.input, /\[Agente A\]/)
  assert.match(chamadaC.input, /saída de parte A/)
  assert.match(chamadaC.input, /\[Agente B\]/)
  assert.match(chamadaC.input, /saída de parte B/)
})

test('uma tarefa que falha não leva as outras, e a síntese sabe que faltou', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const a = agente('Agente A')
  const b = agente('Agente B')
  const setor = equipeDe(coordenador, [a, b])

  const f = deps([coordenador, a, b], {
    sector: setor,
    runTask: async (req) => {
      if (/Junte os resultados/.test(req.instructions)) return { output: 'final parcial', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
      if (/parte B/.test(req.instructions)) throw new Error('provider caiu')
      return { output: 'saída de A', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })
  f.deps.planWithModel = async () =>
    JSON.stringify({
      tasks: [
        { id: 't1', agentId: a._id.toString(), objective: 'parte A' },
        { id: 't2', agentId: b._id.toString(), objective: 'parte B' },
      ],
    })

  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'A e B' })

  assert.equal(run.output, 'final parcial', 'a execução continua e entrega o que deu')
  // A falha é dita, não escondida.
  assert.match(run.warnings.join(' '), /Agente B/)
  const sintese = f.chamadas.find((c) => /Junte os resultados/.test(c.instructions))
  assert.match(sintese.input, /saída de A/)
  assert.match(sintese.input, /FALHOU/)
  // E o painel mostra quem tentou e não conseguiu.
  const falho = run.participants.find((p) => p.name === 'Agente B')
  assert.equal(falho.status, 'failed')
})

test('pergunta simples: uma tarefa só, sem acionar a equipe inteira', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const a = agente('Agente A')
  const b = agente('Agente B')
  const c = agente('Agente C')
  const setor = equipeDe(coordenador, [a, b, c])

  const f = deps([coordenador, a, b, c], {
    sector: setor,
    runTask: async (req) => ({
      output: /Junte os resultados/.test(req.instructions) ? 'final' : 'só A',
      usage: { inputTokens: 1, outputTokens: 1 },
      toolCalls: [],
    }),
  })
  f.deps.planWithModel = async () => JSON.stringify({ tasks: [{ id: 't1', agentId: a._id.toString(), objective: 'só isso' }] })

  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'uma coisa simples' })

  const especialistas = run.participants.filter((p) => p.role === 'specialist')
  assert.equal(especialistas.length, 1, 'ninguém mais foi acionado')
  assert.equal(especialistas[0].name, 'Agente A')
  // Duas inferências no total: o especialista e a consolidação para quem perguntou.
  assert.equal(run.participants.length, 2)
})

test('setor sem outros membros continua como antes: o coordenador responde o pedido', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const setor = equipeDe(coordenador, [])
  const f = deps([coordenador], { sector: setor })

  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'e aí?' })

  assert.equal(run.participants.length, 1)
  // Sem plano não há síntese: a instrução é o pedido, como sempre foi.
  assert.ok(!/Junte os resultados/.test(f.chamadas[0].instructions))
  assert.match(f.chamadas[0].instructions, /e aí\?/)
})

// --- ACEITAÇÃO: dois especialistas, conhecimentos distintos, uma resposta cruzada -----------
//
// Genérico de propósito: uma entidade qualquer ("Unidade 7"), um agente com a SÉRIE de
// medições e outro com os EVENTOS do período. A pergunta liga as duas coisas — o que
// mudou, e o que aconteceu que possa explicar. Nada aqui sabe de domínio nenhum.

const SERIE = [
  'Unidade 7 — medições diárias',
  'Data | Leitura',
  '2026-08-01 | 118',
  '2026-08-02 | 121',
  '2026-08-03 | 119',
  '2026-08-04 | 164',
  '2026-08-05 | 171',
].join('\n')

const EVENTOS = [
  'Unidade 7 — registro de ocorrências',
  '03/08/2026: troca do equipamento auxiliar, parada de 4 horas.',
  '04/08/2026: entrada do turno extra, com dobra de operadores.',
].join('\n')

test('ACEITAÇÃO: séries com um agente, eventos com outro, resposta cruzando os dois', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const dados = agente('Medições', { capabilities: ['series historicas'] })
  const contexto = agente('Ocorrências', { capabilities: ['eventos operacionais'] })
  const setor = equipeDe(coordenador, [dados, contexto])

  await createDocumentFor({ ownerType: 'agent', ownerId: dados._id }, { title: 'Série Unidade 7', content: SERIE })
  await createDocumentFor({ ownerType: 'agent', ownerId: contexto._id }, { title: 'Ocorrências Unidade 7', content: EVENTOS })

  const esperar = barreira(2)
  const f = deps([coordenador, dados, contexto], {
    sector: setor,
    // Cada agente responde a partir do que a base DELE entregou — é o que prova que a
    // execução real aconteceu, e não uma leitura de base feita por outro.
    runTask: async (req) => {
      if (/Junte os resultados/.test(req.instructions)) {
        const entrada = req.input ?? ''
        return {
          output: `Subiu de 119 para 164 em 04/08. ${/turno extra/.test(entrada) ? 'Coincide com a entrada do turno extra em 04/08.' : 'Sem contexto para explicar.'}`,
          usage: { inputTokens: 1, outputTokens: 1 },
          toolCalls: [],
        }
      }
      await esperar(req.instructions)
      const trechos = (req.context ?? []).join('\n')
      if (/164/.test(trechos)) return { output: 'A leitura passou de 119 em 03/08 para 164 em 04/08.', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
      if (/turno extra/.test(trechos)) return { output: 'Em 04/08 entrou turno extra, com dobra de operadores.', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
      return { output: 'nada encontrado', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })
  f.deps.planWithModel = async (_o, _c, prompt) => {
    // O mesmo dublê responde às duas perguntas do motor: planejar e avaliar suficiência.
    if (/sufficient/.test(prompt)) return JSON.stringify({ sufficient: true })
    return JSON.stringify({
      tasks: [
        { id: 't1', agentId: dados._id.toString(), objective: 'o que mudou na série da Unidade 7' },
        { id: 't2', agentId: contexto._id.toString(), objective: 'ocorrências da Unidade 7 no período' },
      ],
      synthesisObjective: 'relacionar a mudança com as ocorrências',
    })
  }

  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, {
    objective: 'a leitura da Unidade 7 mudou no começo de agosto? o que pode explicar?',
  })

  // Os dois especialistas executaram (em paralelo — a barreira exige) e o coordenador juntou.
  assert.deepEqual(run.participants.map((p) => p.role), ['specialist', 'specialist', 'coordinator'])
  // A síntese recebeu os DOIS, cada um com seu autor.
  const sintese = f.chamadas.find((c) => /Junte os resultados/.test(c.instructions))
  assert.match(sintese.input, /\[Medições\]/)
  assert.match(sintese.input, /119 em 03\/08 para 164/)
  assert.match(sintese.input, /\[Ocorrências\]/)
  assert.match(sintese.input, /turno extra/)
  // E a resposta cruza: a mudança E o evento que a acompanha.
  assert.match(run.output, /164/)
  assert.match(run.output, /turno extra/)
})

// --- suficiência, rodadas e repetição --------------------------------------------------------

test('faltando informação e havendo quem consultar, o motor faz UMA segunda rodada', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const a = agente('Agente A')
  const b = agente('Agente B')
  const setor = equipeDe(coordenador, [a, b])
  const rodadas = []

  const f = deps([coordenador, a, b], {
    sector: setor,
    runTask: async (req) => ({
      output: /Junte os resultados/.test(req.instructions) ? 'consolidado' : `saída de ${req.instructions}`,
      usage: { inputTokens: 1, outputTokens: 1 },
      toolCalls: [],
    }),
  })
  f.deps.planWithModel = async (_o, _c, prompt) => {
    if (/sufficient/.test(prompt)) return JSON.stringify({ sufficient: false, missing: 'os dados do B' })
    rodadas.push(prompt)
    // A segunda rodada só enxerga quem sobrou — o prompt de planejamento prova isso.
    return rodadas.length === 1
      ? JSON.stringify({ tasks: [{ id: 't1', agentId: a._id.toString(), objective: 'parte A' }] })
      : JSON.stringify({ tasks: [{ id: 't1', agentId: b._id.toString(), objective: 'parte B' }] })
  }

  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'preciso de tudo' })

  assert.equal(rodadas.length, 2, 'houve replanejamento')
  assert.ok(!rodadas[1].includes(a._id.toString()), 'a segunda rodada não reconsulta quem já respondeu')
  const especialistas = run.participants.filter((p) => p.role === 'specialist').map((p) => p.name)
  assert.deepEqual(especialistas, ['Agente A', 'Agente B'])
})

test('o motor não roda para sempre: no teto, responde com o que tem e diz o que faltou', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const a = agente('Agente A')
  const b = agente('Agente B')
  const c = agente('Agente C')
  const setor = equipeDe(coordenador, [a, b, c])
  let planejamentos = 0

  const f = deps([coordenador, a, b, c], {
    sector: setor,
    runTask: async (req) => ({
      output: /Junte os resultados/.test(req.instructions) ? 'o que deu' : 'parcial',
      usage: { inputTokens: 1, outputTokens: 1 },
      toolCalls: [],
    }),
  })
  // Nunca satisfeito: se não houvesse teto, isto rodaria para sempre.
  f.deps.planWithModel = async (_o, _c, prompt) => {
    if (/sufficient/.test(prompt)) return JSON.stringify({ sufficient: false, missing: 'sempre falta algo' })
    planejamentos += 1
    const alvo = [a, b, c][Math.min(planejamentos - 1, 2)]
    return JSON.stringify({ tasks: [{ id: 't1', agentId: alvo._id.toString(), objective: `parte ${planejamentos}` }] })
  }

  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'quero tudo' })

  assert.equal(planejamentos, 2, 'duas rodadas, nunca três')
  // A limitação é dita, não escondida.
  assert.match(run.warnings.join(' '), /informação incompleta/)
  const sintese = f.chamadas.filter((c) => /Junte os resultados/.test(c.instructions)).at(-1)
  assert.match(sintese.instructions, /ainda falta informação/i)
  assert.match(sintese.instructions, /sempre falta algo/)
})

test('quem já respondeu não é reconsultado na rodada seguinte', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const a = agente('Agente A')
  const b = agente('Agente B')
  const setor = equipeDe(coordenador, [a, b])
  const executadas = []

  const f = deps([coordenador, a, b], {
    sector: setor,
    runTask: async (req) => {
      if (!/Junte os resultados/.test(req.instructions)) executadas.push(req.instructions)
      return { output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })
  // O planejador tenta insistir no MESMO agente na segunda rodada. Ele nem aparece na
  // lista de candidatos — e, se aparecesse, a chave agente+objetivo o barraria.
  f.deps.planWithModel = async (_o, _c, prompt) => {
    if (/sufficient/.test(prompt)) return JSON.stringify({ sufficient: false, missing: 'mais do mesmo' })
    return JSON.stringify({ tasks: [{ id: 't1', agentId: a._id.toString(), objective: 'a mesma coisa' }] })
  }

  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'pergunta' })

  const vezesDoA = run.participants.filter((p) => p.name === 'Agente A').length
  assert.equal(vezesDoA, 1, 'o agente A executou uma vez só, em duas rodadas')
  assert.ok(!executadas.some((i, idx) => idx > 0 && i === executadas[0]), 'nenhuma instrução repetida')
})

test('sem ninguém sobrando, não se pergunta se falta — e não há segunda rodada', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const a = agente('Agente A')
  const setor = equipeDe(coordenador, [a])
  let perguntouSuficiencia = false

  const f = deps([coordenador, a], {
    sector: setor,
    runTask: async () => ({ output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  })
  f.deps.planWithModel = async (_o, _c, prompt) => {
    if (/sufficient/.test(prompt)) {
      perguntouSuficiencia = true
      return JSON.stringify({ sufficient: false, missing: 'x' })
    }
    return JSON.stringify({ tasks: [{ id: 't1', agentId: a._id.toString(), objective: 'única' }] })
  }

  await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'pergunta' })
  assert.equal(perguntouSuficiencia, false, 'uma pergunta que não muda nada é uma pergunta que não se faz')
})

test('se a consolidação falhar, o trabalho da equipe não é jogado fora', async () => {
  const coordenador = agente('Coordenador', { preset: 'manager' })
  const a = agente('Agente A')
  const setor = equipeDe(coordenador, [a])

  const f = deps([coordenador, a], {
    sector: setor,
    runTask: async (req) => {
      if (/Junte os resultados/.test(req.instructions)) throw new Error('provider caiu')
      return { output: 'o que o A apurou', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })
  f.deps.planWithModel = async () => JSON.stringify({ tasks: [{ id: 't1', agentId: a._id.toString(), objective: 'apurar' }] })

  const run = await executeSectorTeam(f.deps, ctxPessoa(), setor, { objective: 'pergunta' })

  assert.match(run.output, /o que o A apurou/, 'o resultado real sobrevive')
  assert.match(run.output, /Agente A/, 'com o nome de quem respondeu')
  assert.match(run.warnings.join(' '), /não foi possível consolidar/)
})
