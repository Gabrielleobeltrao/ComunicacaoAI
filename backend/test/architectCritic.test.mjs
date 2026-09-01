// O CRÍTICO: o que separa "a proposta é válida" de "a proposta é boa".
//
// A validação estrutural já dizia que as referências fecham e os campos existem. Ela
// não diz nada sobre o gerente sem equipe, o operador sem ferramenta, o agente que
// ninguém aciona ou o cálculo entregue a um modelo de linguagem. Todos passam pelo
// `apply` e falham depois — na conta de quem aprovou.
//
// Tudo aqui é puro e determinístico de propósito: o crítico precisa dar a MESMA
// resposta para a mesma proposta, senão a revisão vira loteria.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { runCritic, normalizeLlmFindings } = await import('../dist/architect/critic.js')
const { detectArchitecture, mergeSplitRationale, scoreArchitecture } = await import('../dist/architect/architecture.js')
const { validateResponsibility, specOf } = await import('../dist/architect/responsibility.js')
const { validateExecutors } = await import('../dist/architect/executorContract.js')
const { emptyBlueprint } = await import('../dist/architect/blueprint.js')

const manifesto = {
  presets: [
    { preset: 'manager', label: 'Gerente', description: '', capabilities: ['orchestrates'], delegationPolicy: 'all', activationModes: [], requiresTool: false },
    { preset: 'communicator', label: 'Comunicador', description: '', capabilities: ['externalTools'], delegationPolicy: 'none', activationModes: [], requiresTool: true },
    { preset: 'researcher', label: 'Pesquisador', description: '', capabilities: ['knowledge'], delegationPolicy: 'none', activationModes: [], requiresTool: false },
    { preset: 'analyst', label: 'Analista', description: '', capabilities: [], delegationPolicy: 'none', activationModes: [], requiresTool: false },
    { preset: 'operator', label: 'Operador', description: '', capabilities: ['externalTools'], delegationPolicy: 'none', activationModes: [], requiresTool: true },
    { preset: 'monitor', label: 'Monitor', description: '', capabilities: [], delegationPolicy: 'none', activationModes: [], requiresTool: false },
    { preset: 'secretary', label: 'Secretário', description: '', capabilities: [], delegationPolicy: 'none', activationModes: [], requiresTool: false },
    { preset: 'custom', label: 'Personalizado', description: '', capabilities: [], delegationPolicy: 'none', activationModes: [], requiresTool: false },
  ],
  functions: [{ functionName: 'math.serie', description: '', capabilities: [], version: '1', hasConfig: false }],
  apps: [
    { key: 'web_chat', name: 'Chat Web', connected: true, actions: [{ key: 'reply', name: 'Responder', risk: 'write' }] },
    { key: 'stripe', name: 'Stripe', connected: true, actions: [{ key: 'refund', name: 'Reembolsar', risk: 'high_risk' }] },
  ],
  executorKinds: [],
  sectorModes: [],
  activationModes: [],
  tools: [],
  knowledgeScopes: [],
  channels: [],
  version: 1,
}

const bp = (over = {}) => ({
  ...emptyBlueprint('Op', 'objetivo'),
  floors: [{ key: 'andar', action: 'create', name: 'Atendimento', workMode: 'organization' }],
  ...over,
})

const agente = (over = {}) => ({
  key: 'a1',
  action: 'create',
  floorKey: 'andar',
  name: 'Marina',
  preset: 'communicator',
  objective: 'Responder o cliente sobre o cardápio',
  role: 'Quando chegar uma dúvida',
  constraints: 'Não fala de preço sem base',
  rationale: 'porta de entrada',
  ...over,
})

// --- a função como contrato (7.7) -----------------------------------------------------------

test('gerente sem ninguém para coordenar é ERRO — não um aviso', () => {
  const b = bp({ agents: [agente({ preset: 'manager', name: 'Bruno', objective: 'Coordenar o atendimento' })] })
  const f = validateResponsibility(b, manifesto).find((x) => x.code === 'manager_without_team')
  assert.ok(f, 'um gerente sozinho não é operação: é um agente esperando')
  assert.equal(f.severity, 'error')
  assert.match(f.fix, /delegação por andar/)
})

test('gerente que também executa ação de App recebe aviso', () => {
  // Quem conduz não executa: com a ferramenta na mão, o caminho mais curto é fazer
  // sozinho, e o time deixa de existir.
  const b = bp({
    agents: [agente({ key: 'g', preset: 'manager', name: 'Bruno', delegationPolicy: 'floor' }), agente({ key: 'e', name: 'Marina' })],
    appRequirements: [{ key: 'r', appKey: 'web_chat', reason: 'canal', required: true, actionKeys: ['reply'], agentKeys: ['g'] }],
  })
  assert.ok(validateResponsibility(b, manifesto).some((x) => x.code === 'manager_executes'))
})

test('pesquisador sem fonte, analista sem entrada, operador sem ferramenta e monitor sem gatilho', () => {
  const casos = [
    [{ preset: 'researcher', name: 'Rafael' }, 'researcher_without_source'],
    [{ preset: 'analyst', name: 'Ana', inputContract: '' }, 'analyst_without_input'],
    [{ preset: 'operator', name: 'Téo' }, 'operator_without_tool'],
    [{ preset: 'monitor', name: 'Mia' }, 'monitor_without_trigger'],
  ]
  for (const [over, code] of casos) {
    const achados = validateResponsibility(bp({ agents: [agente(over)] }), manifesto)
    const f = achados.find((x) => x.code === code)
    assert.ok(f, `${code} não foi detectado`)
    assert.equal(f.severity, 'error')
    assert.ok(f.fix.length > 10, 'um aviso sem conserto é só um incômodo')
  }
})

test('personalizado sem justificativa é recusado — custom é exceção, não default', () => {
  const b = bp({ agents: [agente({ preset: 'custom', rationale: '' })] })
  assert.ok(validateResponsibility(b, manifesto).some((x) => x.code === 'custom_without_justification'))

  const comJustificativa = bp({ agents: [agente({ preset: 'custom', rationale: 'nenhum perfil cobre este fluxo específico' })] })
  assert.equal(validateResponsibility(comJustificativa, manifesto).some((x) => x.code === 'custom_without_justification'), false)
})

test('perfil que não existe na instalação é recusado', () => {
  const b = bp({ agents: [agente({ preset: 'superagente' })] })
  const f = validateResponsibility(b, manifesto).find((x) => x.code === 'unknown_preset')
  assert.ok(f)
  assert.equal(f.severity, 'error')
})

test('a ficha é derivada do que a proposta DIZ — não inventa o que falta', () => {
  const b = bp({
    agents: [agente({ delegationPolicy: 'floor' }), agente({ key: 'a2', name: 'Rafael', preset: 'researcher' })],
    sectors: [{ key: 's', action: 'create', floorKey: 'andar', name: 'Mesa', mode: 'orchestrated', memberAgentKeys: ['a1', 'a2'], coordinatorAgentKey: 'a1' }],
  })
  const spec = specOf(b.agents[0], b)
  assert.equal(spec.name, 'Marina')
  assert.equal(spec.primaryResponsibility, 'Responder o cliente sobre o cardápio')
  assert.deepEqual(spec.doesNotOwn, ['Não fala de preço sem base'])
  assert.deepEqual(spec.canCall, ['Rafael'], 'delegação por andar alcança quem está no andar')
  assert.equal(spec.successMetric, '', 'o que a proposta não diz sai vazio — e vazio é o que o validador cobra')
})

// --- o executor (7.8) -------------------------------------------------------------------------

test('function sem nome e sem schema é recusada', () => {
  const b = bp({ agents: [agente({ executorKind: 'function', inputContract: '', inputJsonSchema: null, outputJsonSchema: null })] })
  const codes = validateExecutors(b, manifesto).map((f) => f.code)
  assert.ok(codes.includes('function_without_name'))
  assert.ok(codes.includes('function_without_schema'))
})

test('function que não está no registro é recusada', () => {
  const b = bp({
    agents: [agente({ executorKind: 'function', inputContract: 'usa a função calculo.inventado', inputJsonSchema: { a: 1 }, outputJsonSchema: { b: 1 } })],
  })
  assert.ok(validateExecutors(b, manifesto).some((f) => f.code === 'function_not_in_registry'))
})

test('tool sem App e ação que não existe são recusadas', () => {
  const semApp = bp({ agents: [agente({ executorKind: 'tool' })] })
  assert.ok(validateExecutors(semApp, manifesto).some((f) => f.code === 'tool_without_reference'))

  const acaoFalsa = bp({
    agents: [agente({ executorKind: 'tool' })],
    appRequirements: [{ key: 'r', appKey: 'web_chat', reason: 'x', required: true, actionKeys: ['acao_inventada'], agentKeys: ['a1'] }],
  })
  assert.ok(validateExecutors(acaoFalsa, manifesto).some((f) => f.code === 'tool_action_not_found'))
})

test('cálculo entregue a um modelo de linguagem NÃO passa em silêncio', () => {
  // A queda silenciosa vista de frente: o modelo acerta quase sempre e erra sem avisar.
  const b = bp({ agents: [agente({ name: 'Contador', objective: 'Calcular o total do pedido com frete', role: '', executorKind: 'llm' })] })
  const f = validateExecutors(b, manifesto).find((x) => x.code === 'silent_llm_fallback')
  assert.ok(f)
  assert.equal(f.severity, 'error')
  assert.match(f.fix, /função determinística/)
})

test('ação sensível sem aprovação vira aviso com o nome da ação', () => {
  const b = bp({
    agents: [agente({ preset: 'operator' })],
    appRequirements: [{ key: 'r', appKey: 'stripe', reason: 'reembolso', required: true, actionKeys: ['refund'], agentKeys: ['a1'] }],
  })
  const f = validateExecutors(b, manifesto).find((x) => x.code === 'sensitive_action_without_approval')
  assert.ok(f)
  assert.match(f.message, /refund/)
})

// --- a forma (7.9 e 7.10) ----------------------------------------------------------------------

test('superagente: três domínios incompatíveis num agente só', () => {
  const b = bp({
    agents: [agente({ objective: 'Responder o cliente, cuidar do financeiro e disparar campanhas de marketing' })],
  })
  const f = detectArchitecture(b).find((x) => x.code === 'super_agent')
  assert.ok(f)
  assert.equal(f.severity, 'error')
  assert.ok(f.evidence.length >= 3, 'o achado precisa listar os domínios que o formaram')
})

test('microagente: sem decisão própria, criado para uma chamada', () => {
  const b = bp({ agents: [agente({ name: 'Repassador', objective: 'Encaminhar a mensagem para o próximo', role: '' })] })
  const f = detectArchitecture(b).find((x) => x.code === 'micro_agent')
  assert.ok(f)
  assert.match(f.fix, /ferramenta ou função/)
})

test('agente órfão: existe e nunca acontece', () => {
  // O cenário que importa: um agente atende o canal, o outro não é alcançado por
  // ninguém. Ele existe na proposta e nunca roda — e isso só apareceria em produção.
  const b = bp({
    agents: [agente({ key: 'a1' }), agente({ key: 'a2', name: 'Esquecido', preset: 'analyst', inputContract: 'dados' })],
    appRequirements: [{ key: 'r', appKey: 'web_chat', reason: 'canal', required: true, actionKeys: ['reply'], agentKeys: ['a1'] }],
  })
  const orfaos = detectArchitecture(b).filter((x) => x.code === 'orphan_agent')
  assert.equal(orfaos.length, 1, 'quem atende o canal não é órfão')
  assert.equal(orfaos[0].agentKey, 'a2')
  assert.match(orfaos[0].fix, /setor|canal|rotina/)
})

test('responsabilidade duplicada: dois agentes com o mesmo perfil e domínio', () => {
  const b = bp({
    agents: [
      agente({ key: 'a1', name: 'Marina', objective: 'Atender o cliente' }),
      agente({ key: 'a2', name: 'Bruna', objective: 'Atender o cliente' }),
    ],
  })
  assert.ok(detectArchitecture(b).some((x) => x.code === 'duplicate_responsibility'))
})

test('executor e permissão incompatíveis com o papel', () => {
  const executor = bp({ agents: [agente({ preset: 'manager', executorKind: 'function', delegationPolicy: 'floor' }), agente({ key: 'a2', name: 'Outro' })] })
  assert.ok(detectArchitecture(executor).some((x) => x.code === 'executor_mismatch'))

  const permissao = bp({
    floors: [
      { key: 'andar', action: 'create', name: 'A', workMode: 'organization' },
      { key: 'outro', action: 'create', name: 'B', workMode: 'organization' },
    ],
    agents: [agente({ callableAgentKeys: ['a2'] }), agente({ key: 'a2', name: 'Distante', floorKey: 'outro' })],
  })
  assert.ok(detectArchitecture(permissao).some((x) => x.code === 'permission_mismatch'))
})

test('orçamento: mais agentes que o teto, sem justificativa individual', () => {
  const agents = Array.from({ length: 6 }, (_, i) => agente({ key: `a${i}`, name: `Agente ${i}`, rationale: '' }))
  const f = detectArchitecture(bp({ agents })).find((x) => x.code === 'over_budget')
  assert.ok(f)
  assert.match(f.message, /o teto é 4/)
  assert.equal(f.evidence.length, 6)
})

test('o motivo de cada junção/separação fica registrado', () => {
  const b = bp({
    agents: [
      agente({ key: 'a1', name: 'Marina', objective: 'Atender o cliente' }),
      agente({ key: 'a2', name: 'Ana', preset: 'analyst', objective: 'Analisar as reclamações do atendimento' }),
    ],
  })
  const decisoes = mergeSplitRationale(b)
  assert.equal(decisoes.length, 2)
  assert.match(decisoes[0].rationale, /atendimento/)
  // "Por que estes dois não foram juntados?" precisa ter resposta antes do apply.
  assert.match(decisoes[0].rationale, /separado de "Ana"/)
  assert.match(decisoes[0].rationale, /o papel é outro/)
})

test('o score é contagem verificável, e cada nota carrega os fatos', () => {
  const b = bp({
    agents: [agente(), agente({ key: 'a2', name: 'Rafael', preset: 'researcher', objective: '' })],
    appRequirements: [{ key: 'r', appKey: 'web_chat', reason: 'canal', required: true, actionKeys: [], agentKeys: ['a1'] }],
  })
  const s = scoreArchitecture(b)
  assert.equal(s.coverage, 50, 'um de dois agentes diz o que entrega')
  assert.match(s.facts.coverage[0], /1 de 2/)
  for (const nota of ['cohesion', 'executorFit', 'permissionSafety', 'setupCompleteness', 'handoffSimplicity']) {
    assert.ok(Array.isArray(s.facts[nota]) && s.facts[nota].length > 0, `${nota} sem fato é palpite com número`)
    assert.ok(s[nota] >= 0 && s[nota] <= 100)
  }
  // Determinístico: a mesma proposta dá a mesma leitura.
  assert.deepEqual(scoreArchitecture(b), s)
})

// --- o crítico inteiro (7.11) -------------------------------------------------------------------

test('o crítico junta as três camadas, ordena erro antes de aviso e diz se trava', () => {
  const ruim = bp({ agents: [agente({ preset: 'manager', name: 'Bruno', objective: 'Coordenar tudo' })] })
  const r = runCritic(ruim, manifesto)
  assert.equal(r.clean, false)
  assert.equal(r.findings[0].severity, 'error')
  assert.ok(new Set(r.findings.map((f) => f.source)).size >= 1)
  assert.ok(r.mergeSplit.length === 1 && r.score.coverage >= 0)

  const bom = bp({
    agents: [agente({ delegationPolicy: 'floor' }), agente({ key: 'a2', name: 'Rafael', preset: 'analyst', inputContract: 'as dúvidas recebidas' })],
    sectors: [{ key: 's', action: 'create', floorKey: 'andar', name: 'Mesa', mode: 'orchestrated', memberAgentKeys: ['a1', 'a2'], coordinatorAgentKey: 'a1' }],
    appRequirements: [{ key: 'r', appKey: 'web_chat', reason: 'canal', required: true, actionKeys: ['reply'], agentKeys: ['a1'] }],
  })
  assert.equal(runCritic(bom, manifesto).clean, true, JSON.stringify(runCritic(bom, manifesto).findings, null, 1))
})

test('o crítico é determinístico: mesma proposta, mesma resposta', () => {
  const b = bp({ agents: [agente({ preset: 'manager', name: 'Bruno' })] })
  assert.deepEqual(runCritic(b, manifesto), runCritic(b, manifesto))
})

test('o crítico LLM só produz findings — e nunca erro', () => {
  const b = bp({ agents: [agente()] })
  const achados = normalizeLlmFindings(
    [
      { code: 'overlap', agentKey: 'a1', message: 'parece sobreposto com outro', fix: 'junte os dois', evidence: ['ambos atendem'] },
      { code: 'sem-agente', message: 'algo vago', fix: 'revise' },
      { code: 'fantasma', agentKey: 'nao-existe', message: 'x', fix: 'y' },
      { code: '', message: 'sem código', fix: 'z' },
      { blueprintPatch: { agents: [] } },
    ],
    b,
  )
  assert.equal(achados.length, 2, 'achado sobre agente inexistente e achado sem código são descartados')
  // Bloquear a aplicação com opinião de modelo seria dar a ele a palavra final.
  assert.ok(achados.every((f) => f.severity === 'warning' && f.source === 'llm'))
  // E ele não edita nada: o que volta é achado, nunca patch.
  assert.equal(JSON.stringify(achados).includes('blueprintPatch'), false)
})
