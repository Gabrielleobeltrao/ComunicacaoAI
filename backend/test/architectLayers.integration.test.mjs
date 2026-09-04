// A CAMADA APROVADA — e a promessa de que é ela que vai ser escrita.
//
// O plano inteiro fica guardado; o que a pessoa lê, confirma e aplica é o recorte.
// Cada teste aqui existe porque a alternativa é a pior forma de errar isso: uma tela
// mostrando "Essencial" e uma aplicação criando o "Completo".
//
// Precisa de banco porque o que se confere é o que FOI ESCRITO no escritório — não o
// que a função devolveu.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.LLM_FAKE = '1'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const repo = await import('../dist/architect/repository.js')
const service = await import('../dist/architect/service.js')
const { computeBlueprintHash } = await import('../dist/architect/blueprint.js')
const { deriveChecklist, applyChecklistState, computeReadiness } = await import('../dist/architect/checklist.js')
const { ensureTokenUsageIndexes } = await import('../dist/tokenUsage.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
const { ensureMemoryIndexes } = await import('../dist/memory/records.js')
const { setProviderApiKey, setMonthlyTokenCap } = await import('../dist/userSettings.js')
const { resetGuards } = await import('../dist/architect/guard.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')
const { runLlmCritique } = await import('../dist/architect/criticLlm.js')
const { getMonthlyTokens } = await import('../dist/tokenUsage.js')

const DONO = 'dono-camadas'

before(async () => {
  await mongoClient.connect()
  await repo.ensureArchitectIndexes()
  await ensureTokenUsageIndexes()
  await ensureRunIndexes()
  await ensureMemoryIndexes()
})
after(async () => {
  await mongoClient.close()
  await stopMongo()
})
beforeEach(async () => {
  for (const c of ['architect_projects', 'architect_messages', 'architect_operations', 'floors', 'agents', 'sectors', 'automations', 'buildings', 'user_settings', 'token_usage', 'token_usage_charges']) {
    await db.collection(c).deleteMany({})
  }
  resetGuards()
  await ensureDefaultBuilding(DONO)
  await setProviderApiKey(DONO, 'anthropic', 'chave-de-teste')
  await setMonthlyTokenCap(DONO, 0)
})

/** O plano inteiro: um agente no núcleo, um recomendado, e uma rotina no completo. */
const PLANO = () => ({
  version: 1,
  title: 'Atendimento',
  objective: 'atender',
  floors: [{ key: 'andar', action: 'create', name: 'Atendimento', workMode: 'organization', layer: 'essential' }],
  agents: [
    { key: 'marina', action: 'create', floorKey: 'andar', name: 'Marina', preset: 'manager', delegationPolicy: 'floor', objective: 'Receber o que chega, acionar quem resolve e devolver uma resposta só', layer: 'essential', layerReason: 'é quem recebe e responde' },
    { key: 'rafael', action: 'create', floorKey: 'andar', name: 'Rafael', preset: 'analyst', objective: 'analisar reclamações', inputContract: 'as reclamações do dia', layer: 'recommended', layerReason: 'divide um trabalho que o primeiro faria sozinho' },
  ],
  sectors: [
    { key: 'mesa', action: 'create', floorKey: 'andar', name: 'Mesa', mode: 'orchestrated', memberAgentKeys: ['marina', 'rafael'], coordinatorAgentKey: 'marina', layer: 'recommended' },
  ],
  routines: [
    { key: 'resumo', action: 'create', floorKey: 'andar', ownerAgentKey: 'rafael', name: 'Resumo diário', triggerType: 'schedule', cron: '0 8 * * *', timezone: 'America/Sao_Paulo', steps: [{ id: 'executar', type: 'agent.execute', config: { agentKey: 'rafael', instruction: 'resuma o dia' } }], layer: 'complete' },
  ],
  appRequirements: [],
  knowledgeRequirements: [],
  assumptions: [],
  warnings: [],
  checklist: [],
})

/** Um plano LEGADO: nasceu antes das camadas, e nenhum item tem camada nenhuma. */
const LEGADO = () => {
  const bp = PLANO()
  const limpar = (o) => {
    const { layer, layerReason, ...resto } = o
    return resto
  }
  return { ...bp, floors: bp.floors.map(limpar), agents: bp.agents.map(limpar), sectors: bp.sectors.map(limpar), routines: bp.routines.map(limpar) }
}

async function projetoCom(blueprint, extra = {}) {
  const p = await repo.createProject(DONO, { title: 'Teste', objective: 'teste' })
  const { selectLayer } = await import('../dist/architect/compile.js')
  const recorte = selectLayer(blueprint, extra.layer ?? 'complete')
  const checklist = applyChecklistState(deriveChecklist(recorte), new Set())
  await repo.patchProject(DONO, p._id, {
    blueprint,
    blueprintHash: computeBlueprintHash(recorte),
    status: 'ready',
    checklist,
    readiness: computeReadiness(checklist, []),
    ...extra,
  })
  return await repo.getProject(DONO, p._id)
}

const escritorio = async () => ({
  agentes: (await db.collection('agents').find({ ownerId: DONO }).toArray()).map((a) => a.name).sort(),
  setores: await db.collection('sectors').countDocuments({ ownerId: DONO }),
  rotinas: await db.collection('automations').countDocuments({ ownerId: DONO }),
})

// --- o legado ----------------------------------------------------------------------

test('projeto legado não é recortado: sem camada nos itens, o plano inteiro é a proposta', async () => {
  const p = await projetoCom(LEGADO())
  const detalhe = service.projectDetail(p)
  assert.deepEqual(detalhe.blueprint, p.blueprint, 'o legado foi reescrito pelo recorte')
  assert.equal(detalhe.blueprintHash, computeBlueprintHash(p.blueprint))
  // Inclusive o que as regras de tamanho cortariam: o gerente continua gerente.
  assert.equal(detalhe.blueprint.agents[0].preset, 'manager')
  assert.equal(detalhe.blueprint.agents[0].delegationPolicy, 'floor')
})

test('projeto legado continua aplicável — e aplica tudo', async () => {
  const p = await projetoCom(LEGADO())
  await service.applyProject(DONO, p._id, { blueprintHash: p.blueprintHash, idempotencyKey: 'op-legado', confirm: true })
  assert.deepEqual((await escritorio()).agentes, ['Marina', 'Rafael'])
})

// --- o recorte ---------------------------------------------------------------------

test('a camada muda o hash: a confirmação anterior deixa de valer', async () => {
  const p = await projetoCom(PLANO())
  const antes = p.blueprintHash

  const trocado = await service.setProjectLayer(DONO, p._id, 'essential')
  assert.notEqual(trocado.blueprintHash, antes, 'trocar de camada precisa mudar o que foi carimbado')
  assert.equal(trocado.status, 'draft', 'recorte novo é proposta a validar de novo')

  // E a confirmação em voo, com o hash de antes, é recusada.
  await service.validateProject(DONO, p._id)
  await assert.rejects(
    () => service.applyProject(DONO, p._id, { blueprintHash: antes, idempotencyKey: 'op-velha', confirm: true }),
    /revisou|proposta/i,
  )
})

test('o diff mostra o que a troca de camada tirou', async () => {
  const p = await projetoCom(PLANO())
  const trocado = await service.setProjectLayer(DONO, p._id, 'essential')
  const detalhe = service.projectDetail(trocado)
  const removidos = detalhe.changes.filter((c) => c.change === 'removed').map((c) => c.key)
  assert.ok(removidos.includes('rafael'), `o agente que saiu precisa aparecer no diff: ${JSON.stringify(detalhe.changes)}`)
  assert.ok(removidos.includes('resumo'))
})

test('aplica SÓ a camada aprovada', async () => {
  const p = await projetoCom(PLANO(), { layer: 'essential' })
  await service.validateProject(DONO, p._id)
  const atual = await repo.getProject(DONO, p._id)
  await service.applyProject(DONO, p._id, { blueprintHash: atual.blueprintHash, idempotencyKey: 'op-essencial', confirm: true })

  const criado = await escritorio()
  assert.deepEqual(criado.agentes, ['Marina'], 'o agente recomendado não foi aprovado e não pode nascer')
  assert.equal(criado.setores, 0, 'setor de um membro só não é setor')
  assert.equal(criado.rotinas, 0, 'a rotina depende do agente que ficou de fora')
})

test('a camada completa aplica o plano inteiro', async () => {
  const p = await projetoCom(PLANO(), { layer: 'complete' })
  await service.validateProject(DONO, p._id)
  const atual = await repo.getProject(DONO, p._id)
  await service.applyProject(DONO, p._id, { blueprintHash: atual.blueprintHash, idempotencyKey: 'op-completo', confirm: true })

  const criado = await escritorio()
  assert.deepEqual(criado.agentes, ['Marina', 'Rafael'])
  assert.equal(criado.setores, 1)
  assert.equal(criado.rotinas, 1)
})

test('a prévia e o ensaio falam da camada escolhida, não do plano', async () => {
  const p = await projetoCom(PLANO(), { layer: 'essential' })
  const previa = await service.previewProject(DONO, p._id)
  assert.equal(previa.layer, 'essential')
  assert.equal(previa.layerCounts.essential.agents, 1)
  assert.equal(previa.layerCounts.complete.agents, 2)
  // O crítico não pode cobrar equipe de quem a camada deixou sozinho.
  const erros = previa.critique.findings.filter((f) => f.severity === 'error')
  assert.deepEqual(erros, [], JSON.stringify(erros))
  assert.ok(previa.simulation.cases.length > 0)
})

test('a camada é validada: nome inventado não vira recorte', async () => {
  const p = await projetoCom(PLANO())
  await assert.rejects(() => service.setProjectLayer(DONO, p._id, 'tudo'), /essencial/i)
})

// --- a segunda leitura: cacheada, descartável, e nunca no caminho crítico -------------

test('demora demais não quebra nada: a proposta segue sem a leitura', async () => {
  // O provedor que nunca responde. Sem prazo, isto prenderia a rodada inteira.
  let chamou = false
  const nuncaResponde = () => {
    chamou = true
    return new Promise(() => {})
  }
  const r = await runLlmCritique({
    ownerId: DONO,
    provider: 'anthropic',
    model: null,
    chargeKey: 'k-prazo',
    blueprint: PLANO(),
    hash: 'h1',
    timeoutMs: 20,
    ask: nuncaResponde,
  })
  assert.ok(chamou, 'o provedor nem foi chamado: este teste não estaria provando o prazo')
  assert.equal(r.status, 'failed')
  assert.deepEqual(r.findings, [])
  assert.equal(r.hash, 'h1', 'a leitura vazia também é DESTA revisão')
})

test('provedor que explode não vira exceção na rodada', async () => {
  const explode = () => Promise.reject(new Error('502 do provedor'))
  const r = await runLlmCritique({ ownerId: DONO, provider: 'anthropic', model: null, chargeKey: 'k-erro', blueprint: PLANO(), hash: 'h2', ask: explode })
  assert.equal(r.status, 'failed')
  assert.deepEqual(r.findings, [])
})

test('resposta ilegível não vira achado inventado', async () => {
  const conversa = async () => ({ text: 'Claro! Aqui vai a minha análise: parece bom.', usage: { inputTokens: 1, outputTokens: 1 } })
  const r = await runLlmCritique({ ownerId: DONO, provider: 'anthropic', model: null, chargeKey: 'k-ilegivel', blueprint: PLANO(), hash: 'h3', ask: conversa })
  assert.equal(r.status, 'failed')
  assert.deepEqual(r.findings, [])
})

test('a leitura é feita UMA vez por revisão — abrir a prévia de novo não custa nada', async () => {
  const p = await projetoCom(PLANO())
  // A leitura guardada é desta revisão: é o que a prévia junta ao crítico determinístico.
  await repo.patchProject(DONO, p._id, {
    llmCritique: {
      hash: p.blueprintHash,
      status: 'ok',
      createdAt: new Date(),
      findings: [{ source: 'llm', code: 'limite_vago', message: 'ninguém diz o que não faz', fix: 'escreva', severity: 'warning', evidence: [] }],
    },
  })

  const gastoAntes = await getMonthlyTokens(DONO)
  const primeira = await service.previewProject(DONO, p._id)
  const segunda = await service.previewProject(DONO, p._id)
  assert.equal(await getMonthlyTokens(DONO), gastoAntes, 'abrir a prévia não pode custar inferência')

  assert.equal(primeira.critique.llmStatus, 'ok')
  assert.deepEqual(primeira.critique.findings, segunda.critique.findings)
  const doModelo = primeira.critique.findings.filter((f) => f.source === 'llm')
  assert.equal(doModelo.length, 1)
  assert.equal(doModelo[0].severity, 'warning', 'a leitura auxiliar não bloqueia')
  assert.equal(primeira.critique.clean, true, 'e não muda o veredito da aplicação')
})

test('mudou a revisão, a leitura anterior é DESCARTADA — não apontada sobre o desenho novo', async () => {
  const p = await projetoCom(PLANO())
  await repo.patchProject(DONO, p._id, {
    llmCritique: {
      hash: p.blueprintHash,
      status: 'ok',
      createdAt: new Date(),
      findings: [{ source: 'llm', code: 'sobre_rafael', agentKey: 'rafael', message: 'Rafael se sobrepõe a Marina', fix: 'junte os dois', severity: 'warning', evidence: [] }],
    },
  })

  // O recorte essencial tira o Rafael: a leitura passa a falar de um agente que a
  // proposta na tela não tem mais.
  await service.setProjectLayer(DONO, p._id, 'essential')
  const previa = await service.previewProject(DONO, p._id)
  assert.equal(previa.critique.llmStatus, 'stale')
  assert.deepEqual(previa.critique.findings.filter((f) => f.source === 'llm'), [])
})

test('projeto sem leitura nenhuma diz isso — não finge que foi revisado', async () => {
  const p = await projetoCom(PLANO())
  const previa = await service.previewProject(DONO, p._id)
  assert.equal(previa.critique.llmStatus, 'absent')
})

// --- corrigir o entendimento refaz o desenho -----------------------------------------

test('corrigir "O que entendi" refaz a proposta — sem chamar o modelo', async () => {
  const { emptyBrief, applyBriefPatch } = await import('../dist/architect/brief.js')
  const { compileBrief } = await import('../dist/architect/compile.js')
  const brief = applyBriefPatch(emptyBrief('atender'), {
    businessGoal: 'atender o cliente',
    jobs: [{ id: 'duvidas', name: 'Responder dúvidas', trigger: 'chega mensagem', input: 'a pergunta', decision: 'o que responder', action: 'responder', output: 'a resposta' }],
  })
  const compilado = compileBrief(brief, null, { title: 'Teste', objective: 'teste' })
  const p = await projetoCom(compilado.blueprint, { brief, compiled: true })

  const gastoAntes = await getMonthlyTokens(DONO)
  const depois = await service.editBrief(DONO, p._id, {
    jobs: [
      ...brief.jobs,
      { id: 'reclamacoes', name: 'Avaliar reclamações e recomendar', trigger: 'vira reclamação', input: 'o relato', decision: 'a gravidade', action: 'recomendar', output: 'a recomendação' },
    ],
  })

  assert.equal(await getMonthlyTokens(DONO), gastoAntes, 'refazer o desenho compilado não custa inferência')
  assert.deepEqual(depois.blueprint.agents.map((a) => a.key), ['duvidas', 'reclamacoes'], 'o trabalho novo virou agente')
  assert.notEqual(depois.blueprintHash, p.blueprintHash, 'desenho novo pede aprovação de novo')
  assert.equal(depois.status, 'draft')

  // E desfazer volta as duas coisas: o entendimento e o desenho.
  const desfeito = await service.undoBrief(DONO, p._id)
  assert.deepEqual(desfeito.blueprint.agents.map((a) => a.key), ['duvidas'])
  assert.equal(desfeito.blueprintHash, p.blueprintHash, 'desfazer devolve exatamente a revisão anterior')
})

test('projeto legado NÃO é recompilado quando o entendimento muda', async () => {
  // O desenho do modelo tem outras chaves. Recompilar trocaria todas — e num projeto
  // aplicado, chave nova é recurso novo ao lado do que já existe.
  const p = await projetoCom(LEGADO(), { brief: { ...(await import('../dist/architect/brief.js')).emptyBrief('atender'), businessGoal: 'x' } })
  const depois = await service.editBrief(DONO, p._id, { businessGoal: 'outra coisa completamente' })
  assert.deepEqual(depois.blueprint, p.blueprint, 'o desenho do legado não pode ser reescrito')
  assert.equal(depois.blueprintHash, p.blueprintHash)
})
