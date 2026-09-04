// O BLUEPRINT V2 — o que o validador estrutural garante, e o que ele deliberadamente não faz.
//
// Ele confere a FORMA: keys únicas e referenciáveis, referências que existem, dependências
// sem ciclo, tetos e ausência de segredo. O que é específico de um domínio continua sendo
// validado por ele — a condição de um monitor pela AST canônica, a config de uma fonte pela
// união discriminada da Central. Uma segunda opinião divergiria da primeira no campo
// seguinte, e a que estivesse errada só apareceria na hora de aplicar.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const v2 = await import('../dist/architect/blueprintV2.js')
const t = await import('../dist/architect/typesV2.js')

const agente = (over = {}) => ({
  key: 'marina',
  action: 'create',
  layer: 'essential',
  rationale: 'recebe quem chega',
  dependsOn: [],
  floorKey: 'atendimento',
  name: 'Marina',
  role: 'Recebe o cliente e entende o pedido',
  trigger: 'chega uma mensagem no canal',
  inputContract: 'a mensagem do cliente',
  outputContract: 'o pedido entendido, ou um encaminhamento',
  ...over,
})

const andar = (over = {}) => ({
  key: 'atendimento',
  action: 'create',
  layer: 'essential',
  rationale: 'é onde a operação mora',
  dependsOn: [],
  name: 'Atendimento',
  workMode: 'organization',
  ...over,
})

const base = (over = {}) => {
  const bp = t.emptyBlueprintV2('Atendimento', 'Atender quem chega', 'create')
  bp.organization.floors = [andar()]
  bp.organization.agents = [agente()]
  return Object.assign(bp, over)
}

const erros = (bp) => v2.validateBlueprintV2(bp).issues.filter((i) => i.severity === 'error')
const temCodigo = (bp, code) => erros(bp).some((i) => i.code === code)

// --- o caminho feliz ----------------------------------------------------------------------

test('ACEITAÇÃO: um plano mínimo e coerente passa', () => {
  const r = v2.validateBlueprintV2(base())
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('o vazio tem os três blocos e as duas listas de topo', () => {
  const bp = t.emptyBlueprintV2('x', 'y')
  assert.equal(bp.version, 2)
  assert.deepEqual(Object.keys(bp.organization).sort(), ['agents', 'floors', 'sectors'])
  assert.deepEqual(Object.keys(bp.resources).sort(), ['appRequirements', 'databases', 'datasets', 'knowledge', 'memoryPolicies', 'tools'])
  assert.deepEqual(
    Object.keys(bp.operations).sort(),
    ['channels', 'deliveries', 'flows', 'histories', 'liveDestinations', 'monitors', 'routines', 'sources'],
  )
})

// --- keys ------------------------------------------------------------------------------------

test('a key é única no DOCUMENTO, não na lista', () => {
  // Duas listas com a mesma key transformariam uma dependência em ambiguidade.
  const bp = base()
  bp.resources.databases = [{ key: 'marina', action: 'create', layer: 'essential', rationale: 'x', dependsOn: [], name: 'Marina', owner: { ownerType: 'account' }, adapterKind: 'data_history' }]
  assert.ok(temCodigo(bp, 'duplicate_key'))
})

test('key com maiúscula, espaço ou acento é recusada', () => {
  for (const key of ['Marina', 'marina silva', 'atenção', '', '-comeca-com-hifen']) {
    const bp = base()
    bp.organization.agents = [agente({ key })]
    assert.ok(temCodigo(bp, 'invalid_key'), `"${key}" deveria ser recusada`)
  }
})

test('reuse/update/archive sem resourceId é erro: dizem apontar e não apontam', () => {
  for (const action of ['reuse', 'update', 'archive']) {
    const bp = base()
    bp.organization.agents = [agente({ action })]
    assert.ok(temCodigo(bp, 'missing_resource_id'), `${action} sem resourceId`)
  }
})

// --- referências -------------------------------------------------------------------------

test('uma referência para uma key que não existe é erro', () => {
  const bp = base()
  bp.organization.agents = [agente({ floorKey: 'andar-que-nao-existe' })]
  assert.ok(temCodigo(bp, 'unknown_reference'))
})

test('o canal precisa de agente de entrada — uma porta que não leva a ninguém é uma porta fechada', () => {
  const bp = base()
  bp.operations.channels = [
    { key: 'canal-whatsapp', action: 'create', layer: 'essential', rationale: 'porta', dependsOn: [], appKey: 'whatsapp', entryAgentKey: '', direction: 'both' },
  ]
  assert.ok(temCodigo(bp, 'missing_field'))
})

test('o monitor precisa dizer o que observa', () => {
  const bp = base()
  bp.operations.monitors = [
    { key: 'rsi-baixo', action: 'create', layer: 'essential', rationale: 'vigia', dependsOn: [], name: 'RSI baixo', observes: { kind: 'outra-coisa' }, condition: {}, triggerMode: 'enter', debounceMs: 0, cooldownMs: 0, onStale: 'degrade' },
  ]
  assert.ok(temCodigo(bp, 'monitor_without_target'))
})

test('um acesso sem capacidade não concede nada', () => {
  const bp = base()
  bp.access = [{ key: 'acesso-1', action: 'create', layer: 'essential', rationale: 'x', dependsOn: [], resourceRef: 'agent:marina', subjectType: 'agent', subjectKey: 'marina', capabilities: [], effect: 'allow' }]
  assert.ok(temCodigo(bp, 'grant_without_capability'))
})

// --- o agente nunca fica sem responsabilidade -----------------------------------------------

test('agente sem responsabilidade, gatilho ou contrato é ERRO — não aviso', () => {
  for (const [campo, code] of [
    ['role', 'agent_without_role'],
    ['trigger', 'agent_without_trigger'],
    ['inputContract', 'agent_without_input'],
    ['outputContract', 'agent_without_output'],
  ]) {
    const bp = base()
    bp.organization.agents = [agente({ [campo]: '' })]
    assert.ok(temCodigo(bp, code), `${campo} vazio precisa ser erro`)
  }
})

test('setor orquestrado sem coordenador, e pipeline sem etapas, são erros', () => {
  const semCoordenador = base()
  semCoordenador.organization.sectors = [
    { key: 'recepcao', action: 'create', layer: 'essential', rationale: 'x', dependsOn: [], floorKey: 'atendimento', name: 'Recepção', mode: 'orchestrated', memberAgentKeys: ['marina'] },
  ]
  assert.ok(temCodigo(semCoordenador, 'missing_coordinator'))

  const semEtapas = base()
  semEtapas.organization.sectors = [
    { key: 'linha', action: 'create', layer: 'essential', rationale: 'x', dependsOn: [], floorKey: 'atendimento', name: 'Linha', mode: 'pipeline', memberAgentKeys: ['marina'], stages: [] },
  ]
  assert.ok(temCodigo(semEtapas, 'pipeline_without_stages'))
})

// --- App com ações exatas ---------------------------------------------------------------------

test('um App obrigatório sem ação nenhuma é erro: o grant resolveria para zero ferramentas', () => {
  const bp = base()
  bp.resources.appRequirements = [
    { key: 'app-whatsapp', action: 'create', layer: 'essential', rationale: 'x', dependsOn: [], appKey: 'whatsapp', agentKeys: ['marina'], actionKeys: [], autonomousWriteActionKeys: [], resourceConfig: {}, required: true },
  ]
  assert.ok(temCodigo(bp, 'app_without_action'))
})

test('escrita autônoma precisa estar entre as ações pedidas', () => {
  const bp = base()
  bp.resources.appRequirements = [
    { key: 'app-cal', action: 'create', layer: 'essential', rationale: 'x', dependsOn: [], appKey: 'google_calendar', agentKeys: ['marina'], actionKeys: ['list_events'], autonomousWriteActionKeys: ['create_event'], resourceConfig: {}, required: true },
  ]
  assert.ok(temCodigo(bp, 'autonomous_write_not_requested'))
})

// --- dependências --------------------------------------------------------------------------

test('uma dependência circular é recusada, e a mensagem diz qual é o ciclo', () => {
  const bp = base()
  bp.organization.agents = [agente({ key: 'a', dependsOn: ['b'] }), agente({ key: 'b', name: 'B', dependsOn: ['a'] })]
  const ciclo = erros(bp).find((i) => i.code === 'dependency_cycle')
  assert.ok(ciclo, 'o ciclo precisa ser detectado')
  assert.match(ciclo.message, /a → b → a|b → a → b/)
})

test('a ordem de aplicação põe o dependido antes do dependente', () => {
  const bp = base()
  bp.resources.databases = [{ key: 'base-cotacoes', action: 'create', layer: 'essential', rationale: 'x', dependsOn: [], name: 'Cotações', owner: { ownerType: 'account' }, adapterKind: 'data_history' }]
  bp.resources.datasets = [{ key: 'candles', action: 'create', layer: 'essential', rationale: 'x', dependsOn: ['base-cotacoes'], databaseKey: 'base-cotacoes', datasetKey: 'candles', name: 'Candles', schema: {}, mutability: 'append_only' }]
  bp.operations.monitors = [
    { key: 'rsi-baixo', action: 'create', layer: 'essential', rationale: 'x', dependsOn: ['candles'], name: 'RSI baixo', observes: { kind: 'dataset', datasetKey: 'candles' }, condition: {}, triggerMode: 'enter', debounceMs: 0, cooldownMs: 0, onStale: 'degrade' },
  ]
  const ordem = v2.applyOrder(bp)
  assert.ok(ordem.indexOf('base-cotacoes') < ordem.indexOf('candles'))
  assert.ok(ordem.indexOf('candles') < ordem.indexOf('rsi-baixo'))
})

test('depender de uma key que não está no plano é erro', () => {
  const bp = base()
  bp.organization.agents = [agente({ dependsOn: ['coisa-que-nao-existe'] })]
  assert.ok(temCodigo(bp, 'unknown_reference'))
})

// --- segredo ------------------------------------------------------------------------------

test('AMEAÇA: um campo de credencial em qualquer profundidade é recusado', () => {
  for (const campo of ['token', 'apiKey', 'api_key', 'password', 'senha', 'secret', 'authorization', 'accessToken']) {
    const bp = base()
    bp.operations.sources = [
      {
        key: 'fonte-b3', action: 'create', layer: 'essential', rationale: 'x', dependsOn: [],
        name: 'Cotações', kind: 'api_polling',
        config: { url: 'https://api.exemplo.test/cotacoes', headers: { [campo]: 'nao-pode-estar-aqui' } },
        mapping: { version: 1, fields: [] }, cadence: { mode: 'interval', intervalMs: 60000 },
      },
    ]
    assert.ok(temCodigo(bp, 'secret_in_blueprint'), `${campo} deveria ser recusado`)
  }
})

test('um nome de campo parecido mas legítimo passa: `headerNames` não é segredo', () => {
  const bp = base()
  bp.operations.sources = [
    {
      key: 'fonte-b3', action: 'create', layer: 'essential', rationale: 'x', dependsOn: [],
      name: 'Cotações', kind: 'api_polling',
      // O NOME do cabeçalho é público; o valor mora no cofre. É assim que a Central faz.
      config: { url: 'https://api.exemplo.test/cotacoes', headerNames: ['Authorization'] },
      mapping: { version: 1, fields: [] }, cadence: { mode: 'interval', intervalMs: 60000 },
    },
  ]
  assert.equal(temCodigo(bp, 'secret_in_blueprint'), false, JSON.stringify(erros(bp)))
})

// --- tetos ---------------------------------------------------------------------------------

test('acima do teto por lista e do teto total, o plano é recusado', () => {
  const muitos = base()
  muitos.organization.agents = Array.from({ length: t.V2_LIMITS.itemsPerList + 1 }, (_, n) => agente({ key: `agente-${n}`, name: `A${n}` }))
  assert.ok(temCodigo(muitos, 'limit_exceeded'))
})

// --- hash e diff -----------------------------------------------------------------------------

test('o hash não depende da ordem das chaves, e muda quando o conteúdo muda', () => {
  const a = base()
  const b = base()
  b.organization.agents = [{ ...agente() }]
  assert.equal(v2.computeBlueprintV2Hash(a), v2.computeBlueprintV2Hash(b))

  b.organization.agents[0].role = 'Outra responsabilidade'
  assert.notEqual(v2.computeBlueprintV2Hash(a), v2.computeBlueprintV2Hash(b))
})

test('o diff compara por KEY, não por posição', () => {
  const antes = base()
  antes.organization.agents = [agente({ key: 'a', name: 'A' }), agente({ key: 'b', name: 'B' })]
  const depois = base()
  // A mesma dupla, na ordem trocada: reordenar não é mudar.
  depois.organization.agents = [agente({ key: 'b', name: 'B' }), agente({ key: 'a', name: 'A' })]
  assert.deepEqual(v2.diffBlueprintsV2(antes, depois), [])

  depois.organization.agents[0].role = 'Novo papel'
  const mudou = v2.diffBlueprintsV2(antes, depois)
  assert.equal(mudou.length, 1)
  assert.equal(mudou[0].key, 'b')
  assert.equal(mudou[0].kind, 'changed')
  assert.deepEqual(mudou[0].fields, ['role'])
})

test('o diff diz o que entrou e o que saiu', () => {
  const antes = base()
  const depois = base()
  depois.organization.agents = [agente(), agente({ key: 'rafael', name: 'Rafael' })]
  const m = v2.diffBlueprintsV2(antes, depois)
  assert.deepEqual(m.map((x) => [x.key, x.kind]), [['rafael', 'added']])

  const removeu = v2.diffBlueprintsV2(depois, antes)
  assert.deepEqual(removeu.map((x) => [x.key, x.kind]), [['rafael', 'removed']])
})

// --- conversão V1 → V2 -------------------------------------------------------------------------

test('a conversão preserva key e resourceId, e marca o que o V1 não dizia', () => {
  const v1 = {
    version: 1,
    title: 'Atendimento',
    objective: 'Atender',
    floors: [{ key: 'operacao', action: 'create', name: 'Operação', workMode: 'organization' }],
    agents: [{ key: 'marina', action: 'reuse', resourceId: '000000000000000000000a11', floorKey: 'operacao', name: 'Marina', objective: 'Atende' }],
    sectors: [],
    routines: [],
    appRequirements: [{ key: 'app-zap', appKey: 'whatsapp', reason: 'canal', required: true, actionKeys: [], agentKeys: ['marina'] }],
    knowledgeRequirements: [],
    assumptions: [],
    warnings: [],
    checklist: [],
  }
  const { blueprint, unresolved } = v2.convertV1ToV2(v1)

  assert.equal(blueprint.version, 2)
  assert.equal(blueprint.organization.agents[0].key, 'marina', 'a key é o que liga a proposta ao recurso aplicado')
  assert.equal(blueprint.organization.agents[0].resourceId, '000000000000000000000a11')
  assert.equal(blueprint.organization.agents[0].action, 'reuse')

  // O que o V1 não tinha fica VAZIO e declarado — preencher com o objetivo seria mentira.
  assert.equal(blueprint.organization.agents[0].role, '')
  const doAgente = unresolved.find((u) => u.key === 'marina')
  assert.ok(doAgente)
  assert.match(doAgente.missing, /role/)

  // E o App sem ação vira pendência, porque um grant sem ação não concede nada.
  assert.ok(unresolved.some((u) => u.key === 'app-zap' && u.missing === 'actionKeys'))
})

test('a conversão NUNCA produz `archive`: o V1 não tem essa intenção', () => {
  const v1 = {
    version: 1, title: 'x', objective: 'y',
    floors: [{ key: 'f', action: 'create', name: 'F', workMode: 'organization' }],
    agents: [], sectors: [], routines: [], appRequirements: [], knowledgeRequirements: [],
    assumptions: [], warnings: [], checklist: [],
  }
  const { blueprint } = v2.convertV1ToV2(v1)
  const acoes = v2 && t.V2_ITEM_PATHS.flatMap((p) => t.itemsAt(blueprint, p).map((i) => i.action))
  assert.equal(acoes.includes('archive'), false)
})

test('escrita autônoma NUNCA é herdada na conversão', () => {
  const v1 = {
    version: 1, title: 'x', objective: 'y',
    floors: [{ key: 'f', action: 'create', name: 'F', workMode: 'organization' }],
    agents: [], sectors: [], routines: [],
    appRequirements: [{ key: 'app-cal', appKey: 'google_calendar', reason: 'agenda', required: true, actionKeys: ['create_event'], agentKeys: [] }],
    knowledgeRequirements: [], assumptions: [], warnings: [], checklist: [],
  }
  const { blueprint } = v2.convertV1ToV2(v1)
  // Escrever no calendário é uma aprovação por ação, e o V1 não tinha onde registrá-la.
  assert.deepEqual(blueprint.resources.appRequirements[0].autonomousWriteActionKeys, [])
  assert.deepEqual(blueprint.resources.appRequirements[0].actionKeys, ['create_event'])
})

test('asV2 aceita os dois formatos: um V2 passa direto', () => {
  const bp = base()
  const r = v2.asV2(bp)
  assert.equal(r.blueprint, bp, 'o mesmo objeto, sem cópia nem conversão')
  assert.deepEqual(r.unresolved, [])
})
