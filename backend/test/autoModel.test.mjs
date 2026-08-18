// "Automático": qual modelo este agente merece.
//
// Antes havia só "Padrão do sistema", que é uma CONSTANTE por provedor — todo agente
// deixado no padrão rodava o mesmo modelo, o mais caro, inclusive o que só reescreve um
// texto. A tela dizia "padrão" e quem lia entendia "o sistema escolhe"; ele não escolhia.
//
// A regra aqui é para ser lida, prevista e discordada. Uma pergunta só: errar custa caro?
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { AUTO_MODEL, chooseModelTier, resolveAutoModel } = await import('../dist/autoModel.js')

const agente = (over = {}) => ({ preset: 'custom', ...over })

// --- por perfil ---------------------------------------------------------------------

test('quem planeja, decide ou age fica no modelo principal', () => {
  for (const preset of ['manager', 'analyst', 'researcher', 'operator']) {
    assert.equal(chooseModelTier(agente({ preset })).tier, 'main', preset)
  }
})

test('quem transforma um texto que já existe usa o barato', () => {
  for (const preset of ['communicator', 'secretary', 'monitor']) {
    assert.equal(chooseModelTier(agente({ preset })).tier, 'aux', preset)
  }
})

test('perfil personalizado fica no principal — não saber é motivo para não economizar', () => {
  assert.equal(chooseModelTier(agente({ preset: 'custom' })).tier, 'main')
  assert.equal(chooseModelTier(agente({ preset: undefined })).tier, 'main')
  assert.equal(chooseModelTier(agente({ preset: 'inventado' })).tier, 'main')
})

test('a escolha vem com o motivo, para a tela poder mostrar', () => {
  assert.match(chooseModelTier(agente({ preset: 'manager' })).reason, /coordena/)
  assert.match(chooseModelTier(agente({ preset: 'communicator' })).reason, /já existe/)
})

// --- os motivos para SUBIR ------------------------------------------------------------

test('ferramenta que escreve sobe para o principal: o erro vira ação real', () => {
  const escolha = chooseModelTier(agente({ preset: 'communicator' }), ['read', 'write'])
  assert.equal(escolha.tier, 'main')
  assert.match(escolha.reason, /ação real/)
})

test('risco desconhecido conta como escrita, como no resto do sistema', () => {
  assert.equal(chooseModelTier(agente({ preset: 'monitor' }), [undefined]).tier, 'main')
})

test('só ferramentas de leitura não sobem nada', () => {
  assert.equal(chooseModelTier(agente({ preset: 'communicator' }), ['read', 'read']).tier, 'aux')
})

test('saída com schema sobe: cumprir estrutura é onde o barato falha', () => {
  const escolha = chooseModelTier(agente({ preset: 'secretary', defaultOutputFormat: 'json', outputJsonSchema: { type: 'object' } }))
  assert.equal(escolha.tier, 'main')
  assert.match(escolha.reason, /JSON/)
})

test('formato json SEM schema não sobe — não há estrutura a cumprir', () => {
  assert.equal(chooseModelTier(agente({ preset: 'secretary', defaultOutputFormat: 'json' })).tier, 'aux')
})

test('quem só pode responder pela base sobe: tem que ler a base direito', () => {
  assert.equal(chooseModelTier(agente({ preset: 'monitor', requireGrounding: true })).tier, 'main')
})

test('esforço de raciocínio alto pedido pelo dono é respeitado', () => {
  assert.equal(chooseModelTier(agente({ preset: 'communicator', runConfig: { reasoningEffort: 'high' } })).tier, 'main')
  assert.equal(chooseModelTier(agente({ preset: 'communicator', runConfig: { reasoningEffort: 'low' } })).tier, 'aux')
})

test('a regra só SOBE de classe, nunca desce', () => {
  // Um gerente continua no principal por mais barato que seja o resto da configuração.
  const gerente = agente({ preset: 'manager', runConfig: { reasoningEffort: 'low' } })
  assert.equal(chooseModelTier(gerente, ['read']).tier, 'main')
})

// --- o id concreto ----------------------------------------------------------------------

test('resolve para o id de cada provedor, e o principal pode ser o padrão do adapter', () => {
  const barato = resolveAutoModel(agente({ preset: 'communicator' }), { main: null, aux: 'gpt-5-mini' })
  assert.equal(barato.model, 'gpt-5-mini')
  assert.equal(barato.tier, 'aux')

  const caro = resolveAutoModel(agente({ preset: 'manager' }), { main: null, aux: 'gpt-5-mini' })
  assert.equal(caro.model, null, 'null = o padrão do adapter, que é o comportamento de sempre')
  assert.equal(caro.tier, 'main')
})

test('o marcador é uma constante, e não uma string solta pelo código', () => {
  assert.equal(AUTO_MODEL, 'auto')
})

// --- o marcador nunca chega ao provedor ------------------------------------------------
//
// `auto` é um valor guardado, não um nome de modelo. Se ele vazar para o adapter, a
// chamada é recusada pelo provedor e o erro aparece como "falha do modelo" — longe daqui.

const { resolveAgentRun } = await import('../dist/agentDefinition.js')

const agenteCompleto = (over = {}) => ({
  _id: 'a1',
  ownerId: 'o1',
  name: 'X',
  objective: 'obj',
  provider: 'openai',
  model: AUTO_MODEL,
  preset: 'communicator',
  capabilities: [],
  activationModes: [],
  inputContract: '',
  outputContract: '',
  delegationPolicy: 'none',
  callerPolicy: 'all',
  callableAgentIds: [],
  callableSectorIds: [],
  allowedCallerAgentIds: [],
  toolIds: [],
  ...over,
})

test('resolveAgentRun devolve um modelo de VERDADE quando a escolha é automática', () => {
  const r = resolveAgentRun(agenteCompleto(), { context: 'chat', toolRisks: [] })
  assert.notEqual(r.model, AUTO_MODEL, 'o marcador não pode sair daqui')
  assert.ok(typeof r.model === 'string' && r.model.length > 0)
  assert.ok(r.modelReason, 'e vem com o motivo, para a tela poder mostrar')
})

test('um agente que planeja resolve para o principal (null = padrão do adapter)', () => {
  const r = resolveAgentRun(agenteCompleto({ preset: 'manager' }), { context: 'chat', toolRisks: [] })
  assert.equal(r.model, null)
})

test('o modelo escolhido à mão passa intocado', () => {
  const r = resolveAgentRun(agenteCompleto({ model: 'gpt-5.1' }), { context: 'chat', toolRisks: [] })
  assert.equal(r.model, 'gpt-5.1')
  assert.equal(r.modelReason, null, 'escolha manual não tem motivo a explicar')
})

test('quem nunca escolheu nada continua em null — o comportamento de sempre', () => {
  const r = resolveAgentRun(agenteCompleto({ model: null }), { context: 'chat', toolRisks: [] })
  assert.equal(r.model, null)
})

test('as ferramentas do momento entram na decisão', () => {
  const semNada = resolveAgentRun(agenteCompleto(), { context: 'chat', toolRisks: ['read'] })
  const comEscrita = resolveAgentRun(agenteCompleto(), { context: 'chat', toolRisks: ['write'] })
  assert.ok(semNada.model, 'comunicador sem escrita: modelo barato')
  assert.equal(comEscrita.model, null, 'com escrita, sobe para o principal')
})

test('nenhum caminho do servidor manda `agent.model` cru ao provedor', async () => {
  // Prova estrutural: os pontos que montam a chamada usam o modelo RESOLVIDO. Se alguém
  // voltar a passar `agent.model`, o marcador `auto` vaza e o provedor recusa a chamada.
  const { readFileSync } = await import('node:fs')
  const arquivos = ['../src/index.ts', '../src/delegation.ts', '../src/automations/routineExecution.ts']
  for (const caminho of arquivos) {
    const fonte = readFileSync(new URL(caminho, import.meta.url), 'utf8')
    for (const proibido of ['          agent.model,', '    model: agent.model,', '    model: target.model,']) {
      assert.ok(!fonte.includes(proibido), `${caminho} voltou a passar o modelo cru: ${proibido.trim()}`)
    }
  }
})
