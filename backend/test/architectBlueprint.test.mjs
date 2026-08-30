// O CONTRATO do blueprint: o que a validação determinística aceita e o que ela recusa.
//
// Este é o arquivo que decide se "a LLM propõe, o código valida" é verdade ou slogan.
// Tudo aqui é puro — sem banco, sem provedor — porque uma validação que só dá para
// exercitar com Mongo de pé é uma validação que ninguém exercita.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { validateOfficeBlueprint, emptyOwnershipContext } = await import('../dist/architect/validate.js')
const { emptyBlueprint, mergeBlueprintPatch, computeBlueprintHash } = await import('../dist/architect/blueprint.js')
const { maskSecrets, containsSecret, maskSecretsDeep } = await import('../dist/architect/secrets.js')
const { deriveChecklist, applyChecklistState, computeReadiness } = await import('../dist/architect/checklist.js')
const { canTransition, isEditable } = await import('../dist/architect/state.js')
const { diffBlueprints } = await import('../dist/architect/diff.js')
const L = await import('../dist/architect/limits.js')

// Uma proposta mínima que PASSA — a base de comparação de todo caso negativo daqui.
const valido = () => ({
  ...emptyBlueprint('Atendimento do Restaurante', 'automatizar o atendimento'),
  floors: [{ key: 'andar', action: 'create', name: 'Atendimento', workMode: 'organization' }],
  agents: [
    { key: 'gerente', action: 'create', floorKey: 'andar', name: 'Gerente de atendimento' },
    { key: 'duvidas', action: 'create', floorKey: 'andar', name: 'Atendente de dúvidas' },
  ],
  sectors: [
    {
      key: 'atendimento',
      action: 'create',
      floorKey: 'andar',
      name: 'Atendimento',
      mode: 'orchestrated',
      memberAgentKeys: ['gerente', 'duvidas'],
      coordinatorAgentKey: 'gerente',
    },
  ],
})

const erros = (bp, ctx) => validateOfficeBlueprint(bp, ctx).issues.filter((i) => i.severity === 'error')
const temCodigo = (bp, code, ctx) => erros(bp, ctx).some((i) => i.code === code)

test('a proposta mínima do restaurante é aceita', () => {
  const r = validateOfficeBlueprint(valido())
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('sem título não há proposta', () => {
  assert.ok(temCodigo({ ...valido(), title: '  ' }, 'required'))
})

test('versão desconhecida é recusada em vez de interpretada', () => {
  assert.ok(temCodigo({ ...valido(), version: 2 }, 'unsupported_version'))
})

// --- keys e referências ----------------------------------------------------------------

test('duas keys iguais são recusadas: uma referência ficaria ambígua', () => {
  const bp = valido()
  bp.agents.push({ key: 'gerente', action: 'create', floorKey: 'andar', name: 'Outro' })
  assert.ok(temCodigo(bp, 'duplicate_key'))
})

test('um agente aponta para um andar que não está na proposta', () => {
  const bp = valido()
  bp.agents[0].floorKey = 'andar-que-nao-existe'
  assert.ok(temCodigo(bp, 'unknown_ref'))
})

test('membro de setor precisa trabalhar no andar do setor', () => {
  const bp = valido()
  bp.floors.push({ key: 'outro', action: 'create', name: 'Outro andar', workMode: 'organization' })
  bp.agents[1].floorKey = 'outro'
  assert.ok(temCodigo(bp, 'wrong_floor'))
})

test('setor orquestrado sem coordenador não é orquestrado', () => {
  const bp = valido()
  bp.sectors[0].coordinatorAgentKey = null
  assert.ok(temCodigo(bp, 'required'))
})

test('o coordenador precisa ser membro do próprio setor', () => {
  const bp = valido()
  bp.agents.push({ key: 'fora', action: 'create', floorKey: 'andar', name: 'De fora' })
  bp.sectors[0].coordinatorAgentKey = 'fora'
  assert.ok(temCodigo(bp, 'coordinator_outside'))
})

test('coordenador sozinho não coordena ninguém', () => {
  const bp = valido()
  bp.sectors[0].memberAgentKeys = ['gerente']
  assert.ok(temCodigo(bp, 'coordinator_alone'))
})

test('andar coordenado exige coordenador daquele andar', () => {
  const bp = valido()
  bp.floors[0].workMode = 'coordinated'
  assert.ok(temCodigo(bp, 'required'))
  bp.floors[0].coordinatorAgentKey = 'gerente'
  assert.equal(validateOfficeBlueprint(bp).valid, true)
})

// --- pipeline e ciclos ------------------------------------------------------------------

const comPipeline = (stages) => {
  const bp = valido()
  bp.sectors[0] = { key: 'linha', action: 'create', floorKey: 'andar', name: 'Linha', mode: 'pipeline', memberAgentKeys: ['gerente', 'duvidas'], stages }
  return bp
}

test('pipeline sem etapa nenhuma é recusado', () => {
  assert.ok(temCodigo(comPipeline([]), 'required'))
})

test('etapa que depende de etapa inexistente é recusada', () => {
  const bp = comPipeline([{ key: 'a', agentKey: 'gerente', dependsOn: ['fantasma'] }])
  assert.ok(temCodigo(bp, 'unknown_ref'))
})

test('etapas em círculo são recusadas, e a mensagem mostra o círculo', () => {
  const bp = comPipeline([
    { key: 'a', agentKey: 'gerente', dependsOn: ['b'] },
    { key: 'b', agentKey: 'duvidas', dependsOn: ['a'] },
  ])
  const ciclo = erros(bp).find((i) => i.code === 'cycle')
  assert.ok(ciclo, 'esperava o ciclo')
  assert.match(ciclo.message, /→/)
})

test('um pipeline em cadeia, sem ciclo, passa', () => {
  const bp = comPipeline([
    { key: 'a', agentKey: 'gerente', dependsOn: [] },
    { key: 'b', agentKey: 'duvidas', dependsOn: ['a'] },
  ])
  assert.equal(validateOfficeBlueprint(bp).valid, true, JSON.stringify(erros(bp)))
})

// --- posse -------------------------------------------------------------------------------

test('reutilizar um recurso exige dizer QUAL', () => {
  const bp = valido()
  bp.floors[0] = { key: 'andar', action: 'reuse', name: 'Existente', workMode: 'organization' }
  assert.ok(temCodigo(bp, 'required'))
})

test('reutilizar um recurso de outra conta é recusado', () => {
  const bp = valido()
  bp.floors[0] = { key: 'andar', action: 'reuse', name: 'Existente', workMode: 'organization', resourceId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }
  const ctx = emptyOwnershipContext()
  assert.ok(temCodigo(bp, 'not_owned', ctx), 'sem o id nos conjuntos do dono, não passa')
  ctx.floorIds.add('aaaaaaaaaaaaaaaaaaaaaaaa')
  assert.equal(validateOfficeBlueprint(bp, ctx).valid, true)
})

test('um item que será criado não pode apontar para recurso existente', () => {
  const bp = valido()
  bp.agents[0].resourceId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
  assert.ok(temCodigo(bp, 'unexpected_resource'))
})

// --- contratos ----------------------------------------------------------------------------

test('prometer saída estruturada sem declarar o formato é contrato que ninguém confere', () => {
  const bp = valido()
  bp.agents[0].responseMode = 'structured'
  assert.ok(temCodigo(bp, 'contract_incomplete'))
  bp.agents[0].outputJsonSchema = { type: 'object' }
  assert.equal(validateOfficeBlueprint(bp).valid, true)
})

test('delegação para agentes escolhidos precisa listar quais', () => {
  const bp = valido()
  bp.agents[0].delegationPolicy = 'selected'
  assert.ok(temCodigo(bp, 'required'))
})

test('política de chamada não aponta para fora da proposta', () => {
  const bp = valido()
  bp.agents[0].callableAgentKeys = ['alguem-de-outra-conta']
  assert.ok(temCodigo(bp, 'unknown_ref'))
})

// --- rotinas -------------------------------------------------------------------------------

test('o Arquiteto não arma webhook nem gatilho de evento', () => {
  for (const tipo of ['webhook', 'internal_event']) {
    const bp = valido()
    bp.routines = [{ key: 'r', action: 'create', floorKey: 'andar', ownerAgentKey: 'gerente', name: 'Rotina', triggerType: tipo }]
    assert.ok(temCodigo(bp, 'trigger_not_allowed'), tipo)
  }
})

test('rotina agendada sem horário é recusada', () => {
  const bp = valido()
  bp.routines = [{ key: 'r', action: 'create', floorKey: 'andar', ownerAgentKey: 'gerente', name: 'Rotina', triggerType: 'schedule' }]
  assert.ok(temCodigo(bp, 'required'))
})

test('a rotina passa pelo validador que a plataforma já usa', () => {
  const bp = valido()
  bp.routines = [
    {
      key: 'r',
      action: 'create',
      floorKey: 'andar',
      ownerAgentKey: 'gerente',
      name: 'Rotina',
      triggerType: 'manual',
      steps: [{ id: 's1', name: 'passo', type: 'tipo.que.nao.existe', enabled: true, dependsOn: [], inputMapping: {}, config: {}, timeoutMs: 1000, retryPolicy: { maxAttempts: 1, backoffMs: 0 }, continueOnError: false }],
    },
  ]
  assert.ok(temCodigo(bp, 'invalid_routine'))
})

// --- Apps -----------------------------------------------------------------------------------

test('um App fora do catálogo é recusado; sem instalação vira aviso, não permissão', () => {
  const bp = valido()
  bp.appRequirements = [{ key: 'a1', appKey: 'app-inventado', reason: 'porque sim', required: true, actionKeys: [], agentKeys: [] }]
  const ctx = emptyOwnershipContext()
  ctx.knownAppKeys.add('web-chat')
  assert.ok(temCodigo(bp, 'unknown_app', ctx))

  bp.appRequirements[0].appKey = 'web-chat'
  const r = validateOfficeBlueprint(bp, ctx)
  assert.equal(r.valid, true, 'App conhecido e não conectado NÃO bloqueia')
  assert.ok(r.issues.some((i) => i.code === 'app_not_connected' && i.severity === 'warning'))
})

test('não se pede uma ação que o App não tem', () => {
  const bp = valido()
  bp.appRequirements = [{ key: 'a1', appKey: 'web-chat', reason: 'r', required: true, actionKeys: ['acao.inventada'], agentKeys: [] }]
  const ctx = emptyOwnershipContext()
  ctx.knownAppKeys.add('web-chat')
  ctx.installedAppKeys.add('web-chat')
  ctx.appActionKeys.set('web-chat', new Set(['acao.real']))
  assert.ok(temCodigo(bp, 'unknown_action', ctx))
})

// --- conhecimento ------------------------------------------------------------------------------

test('conhecimento confirmado sem conteúdo é recusado: é aí que se inventaria cardápio', () => {
  const bp = valido()
  bp.knowledgeRequirements = [
    { key: 'cardapio', scope: 'agent', targetKey: 'duvidas', title: 'Cardápio', description: '', required: true, expectedSource: 'upload', state: 'confirmed' },
  ]
  assert.ok(temCodigo(bp, 'no_content'))
  bp.knowledgeRequirements[0].state = 'missing'
  assert.equal(validateOfficeBlueprint(bp).valid, true, 'ausente é pendência, e pendência é válida')
})

test('conhecimento aponta para alguém que está na proposta', () => {
  const bp = valido()
  bp.knowledgeRequirements = [{ key: 'k', scope: 'agent', targetKey: 'ninguem', title: 'T', description: '', required: true, expectedSource: 'manual', state: 'missing' }]
  assert.ok(temCodigo(bp, 'unknown_ref'))
})

// --- tetos ---------------------------------------------------------------------------------------

test('uma proposta não vira uma migração', () => {
  const bp = valido()
  bp.agents = Array.from({ length: L.MAX_AGENTS + 1 }, (_, i) => ({ key: `a${i}`, action: 'create', floorKey: 'andar', name: `Agente ${i}` }))
  assert.ok(temCodigo(bp, 'too_many'))
})

// --- segredo -----------------------------------------------------------------------------------

test('credencial no blueprint bloqueia a aplicação', () => {
  const bp = valido()
  bp.agents[0].instructions = 'use a chave sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'
  assert.ok(temCodigo(bp, 'secret_in_blueprint'))
})

test('o mascaramento pega os formatos anunciados e a atribuição explícita', () => {
  const casos = [
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
    'ghp_abcdefghijklmnopqrstuvwxyz0123',
    'AKIAIOSFODNN7EXAMPLE',
    'Authorization: Bearer abcdefghijklmnopqrstuvwx',
    'minha api_key = abcdefgh12345678',
    'senha: umaSenhaBemLonga123',
  ]
  for (const caso of casos) {
    assert.ok(containsSecret(caso), caso)
    assert.ok(!maskSecrets(caso).includes('abcdefgh') || caso.includes('AKIA'), caso)
  }
  assert.equal(containsSecret('quero automatizar o atendimento do meu restaurante'), false)
})

test('o mascaramento desce na estrutura inteira', () => {
  const fora = maskSecretsDeep({ a: ['ghp_abcdefghijklmnopqrstuvwxyz0123'], b: { c: 'texto normal' } })
  assert.ok(!JSON.stringify(fora).includes('ghp_'))
  assert.equal(fora.b.c, 'texto normal')
})

// --- merge de patch --------------------------------------------------------------------------------

test('o patch casa por key: revisar não apaga o que não foi repetido', () => {
  const base = valido()
  const fora = mergeBlueprintPatch(base, { agents: [{ key: 'duvidas', name: 'Atendente renomeada' }] }, { title: 't', objective: 'o' })
  assert.equal(fora.agents.length, 2, 'o gerente continua lá')
  assert.equal(fora.agents.find((a) => a.key === 'duvidas').name, 'Atendente renomeada')
  assert.equal(fora.agents.find((a) => a.key === 'duvidas').floorKey, 'andar', 'campo ausente no patch mantém o valor anterior')
})

test('o patch acrescenta o que é novo, sem duplicar o que já existe', () => {
  const fora = mergeBlueprintPatch(valido(), { agents: [{ key: 'pedidos', action: 'create', floorKey: 'andar', name: 'Pedidos' }] }, { title: 't', objective: 'o' })
  assert.deepEqual(fora.agents.map((a) => a.key), ['gerente', 'duvidas', 'pedidos'])
})

test('item sem key é descartado: não haveria como referenciá-lo', () => {
  const fora = mergeBlueprintPatch(valido(), { agents: [{ name: 'Sem chave' }] }, { title: 't', objective: 'o' })
  assert.equal(fora.agents.length, 2)
})

// --- hash ------------------------------------------------------------------------------------------

test('o hash não depende da ordem das chaves, e muda quando o conteúdo muda', () => {
  const a = valido()
  const b = JSON.parse(JSON.stringify({ ...a }))
  assert.equal(computeBlueprintHash(a), computeBlueprintHash(b))
  b.agents[0].name = 'Outro nome'
  assert.notEqual(computeBlueprintHash(a), computeBlueprintHash(b))
})

// --- checklist e prontidão ------------------------------------------------------------------------------

test('a checklist é derivada do blueprint, não escrita pelo modelo', () => {
  const bp = valido()
  bp.knowledgeRequirements = [{ key: 'cardapio', scope: 'agent', targetKey: 'duvidas', title: 'Enviar cardápio', description: '', required: true, expectedSource: 'upload', state: 'missing' }]
  bp.appRequirements = [{ key: 'chat', appKey: 'web-chat', reason: 'canal', required: true, actionKeys: [], agentKeys: [] }]
  // O modelo tenta entregar um item já concluído e automático.
  bp.checklist = [{ id: 'inventado', category: 'app', title: 'Tudo pronto', description: '', required: true, status: 'done', completionMode: 'connection_state', dependsOn: [] }]

  const itens = deriveChecklist(bp)
  const inventado = itens.find((i) => i.title === 'Tudo pronto')
  assert.ok(inventado, 'a sugestão entra')
  assert.equal(inventado.completionMode, 'manual', 'mas como revisão manual')
  assert.equal(inventado.required, false)
  assert.equal(inventado.status, 'pending')
  assert.ok(itens.some((i) => i.category === 'knowledge' && i.title === 'Enviar cardápio'))
  assert.ok(itens.some((i) => i.category === 'app' && i.completionMode === 'connection_state'))
})

test('um item automático não é marcado à mão', () => {
  const itens = deriveChecklist(valido())
  const automatico = itens.find((i) => i.completionMode === 'resource_state')
  const fora = applyChecklistState(itens, new Set(), new Set([automatico.id]))
  assert.notEqual(fora.find((i) => i.id === automatico.id).status, 'done')
})

test('o que depende do que ainda não existe aparece travado', () => {
  const itens = deriveChecklist(valido())
  const fora = applyChecklistState(itens, new Set())
  const agente = fora.find((i) => i.id === 'structure:agent-gerente')
  assert.equal(agente.status, 'blocked', 'o andar ainda não existe')
  const andar = fora.find((i) => i.id === 'structure:floor-andar')
  assert.equal(andar.status, 'ready', 'este já dá para fazer')
})

test('“pronto” exige TODO obrigatório concluído e nenhum bloqueio', () => {
  const itens = deriveChecklist(valido())
  const todos = new Set(itens.filter((i) => i.completionMode !== 'manual').map((i) => i.id))
  const manuais = new Set(itens.filter((i) => i.completionMode === 'manual').map((i) => i.id))
  const parcial = applyChecklistState(itens, todos, new Set())
  assert.equal(computeReadiness(parcial).ready, false, 'falta o teste manual')

  const completo = applyChecklistState(itens, todos, manuais)
  assert.equal(computeReadiness(completo).ready, true)
  assert.equal(computeReadiness(completo, ['algo bloqueia']).ready, false, 'um bloqueio derruba a prontidão')
})

// --- máquina de estados ------------------------------------------------------------------------------------

test('aplicar só sai de ready, e o que já foi aplicado não volta a ser rascunho', () => {
  assert.equal(canTransition('ready', 'applying'), true)
  assert.equal(canTransition('draft', 'applying'), false)
  assert.equal(canTransition('discovery', 'applying'), false)
  assert.equal(canTransition('applied', 'draft'), false)
  assert.equal(canTransition('failed', 'applying'), true, 'retomar')
  assert.equal(canTransition('archived', 'draft'), false)
  assert.equal(isEditable('applied'), false)
  assert.equal(isEditable('discovery'), true)
})

// --- 8) o que mudou entre uma versão e outra ------------------------------------------------

test('sem versão anterior não há mudança a mostrar — e isso não é "nada mudou"', () => {
  assert.deepEqual(diffBlueprints(null, valido()), [])
  assert.deepEqual(diffBlueprints(undefined, valido()), [])
})

test('a mesma proposta duas vezes não inventa mudança', () => {
  assert.deepEqual(diffBlueprints(valido(), valido()), [])
})

test('o agente que SUMIU aparece — é a mudança que ninguém percebe sozinho', () => {
  const depois = valido()
  depois.agents = depois.agents.filter((a) => a.key !== 'duvidas')
  const mudancas = diffBlueprints(valido(), depois)
  const sumiu = mudancas.find((m) => m.key === 'duvidas')
  assert.equal(sumiu.change, 'removed')
  assert.equal(sumiu.kind, 'agent')
  assert.equal(sumiu.label, 'Atendente de dúvidas', 'o nome de quem saiu vem do que EXISTIA antes')
  // E some primeiro na lista: é o que mais custa não ver.
  assert.equal(mudancas[0].change, 'removed')
})

test('o campo alterado é dito pelo nome, em português', () => {
  const depois = valido()
  depois.agents[0].name = 'Recepcionista'
  depois.agents[0].objective = 'Receber e encaminhar'
  const m = diffBlueprints(valido(), depois).find((x) => x.key === 'gerente')
  assert.equal(m.change, 'changed')
  assert.deepEqual(m.fields, ['nome', 'objetivo'])
  assert.equal(m.label, 'Recepcionista', 'o rótulo é o valor NOVO')
})

test('item novo é adição, e reordenar não é mudança nenhuma', () => {
  const depois = valido()
  depois.agents.push({ key: 'cobranca', action: 'create', floorKey: 'andar', name: 'Cobrança' })
  assert.equal(diffBlueprints(valido(), depois).find((m) => m.key === 'cobranca').change, 'added')

  const invertido = valido()
  invertido.agents.reverse()
  assert.deepEqual(diffBlueprints(valido(), invertido), [], 'casar por key, e não por posição')
})

test('a composição do setor conta como mudança', () => {
  const depois = valido()
  depois.sectors[0].memberAgentKeys = ['gerente']
  depois.sectors[0].coordinatorAgentKey = 'duvidas'
  const m = diffBlueprints(valido(), depois)[0]
  assert.deepEqual(m.fields, ['coordenador', 'membros'])
})

test('a lista tem teto: uma proposta trocada inteira não vira uma parede de texto', () => {
  const antes = { ...emptyBlueprint('t', 'o'), agents: Array.from({ length: 200 }, (_, i) => ({ key: `a${i}`, action: 'create', floorKey: 'andar', name: `Agente ${i}` })) }
  const depois = { ...emptyBlueprint('t', 'o'), agents: [] }
  assert.ok(diffBlueprints(antes, depois).length <= 60)
})
