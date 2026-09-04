import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// “Montar operação”, nas telas.
//
// A jornada é a do restaurante, de ponta a ponta: descrever, responder, receber a
// proposta, revisar, confirmar e chegar na checklist com o que ficou pendente. Mais os
// caminhos que importam quando algo dá errado — sem chave de provedor, limite estourado
// e aplicação interrompida — e o celular, onde tudo isso mora numa coluna só.
const NOW = new Date(0).toISOString()
const PROJETO_ID = 'proj-1'
const HASH = 'hash-da-proposta-revisada'

const BLUEPRINT = {
  title: 'Atendimento do Restaurante',
  objective: 'atender dúvidas e registrar pedidos',
  floors: [{ key: 'atendimento', name: 'Atendimento do Restaurante', workMode: 'organization' }],
  agents: [
    {
      key: 'gerente',
      name: 'Marina',
      preset: 'manager',
      floorKey: 'atendimento',
      role: 'Recebe toda mensagem e decide quem resolve',
      objective: 'Distribuir a conversa para quem sabe responder.',
      instructions: 'Nunca prometa prazo.',
      constraints: 'Não responde preço nem prazo por conta própria.',
      executorKind: 'llm',
      inputContract: 'a mensagem da pessoa',
      outputContract: 'a resposta consolidada',
      activationModes: ['mention'],
      delegationPolicy: 'floor',
      handoffEnabled: true,
      layer: 'essential',
      layerReason: 'é quem recebe e responde: sem ele a operação não existe',
    },
    {
      key: 'duvidas',
      name: 'Rafael',
      preset: 'researcher',
      floorKey: 'atendimento',
      role: 'Quando a pergunta for sobre cardápio ou horário',
      objective: 'Responder horários, endereço e cardápio.',
      instructions: '',
      executorKind: 'llm',
      handoffEnabled: false,
      layer: 'recommended',
      layerReason: 'divide um trabalho que o primeiro agente faria sozinho',
    },
  ],
  sectors: [{ key: 'setor', name: 'Mesa de Atendimento', floorKey: 'atendimento', mode: 'orchestrated', memberAgentKeys: ['gerente', 'duvidas'], coordinatorAgentKey: 'gerente' }],
  routines: [],
  appRequirements: [{ key: 'canal', appKey: 'web_chat', reason: 'Receber as conversas do site.', required: true, agentKeys: ['gerente'], layer: 'essential' }],
  knowledgeRequirements: [
    { key: 'cardapio', title: 'Enviar o cardápio com preços', description: 'Sem ele, o agente não responde preço.', required: true, state: 'missing', scope: 'agent', targetKey: 'duvidas', layer: 'essential' },
  ],
  assumptions: [{ key: 'horario', text: 'Assumi atendimento em horário comercial.' }],
  warnings: [],
}

const CHECKLIST = [
  { id: 'structure:floor-atendimento', category: 'structure', title: 'Andar “Atendimento do Restaurante”', description: 'Será criado.', required: true, status: 'ready', completionMode: 'resource_state', target: { kind: 'floor', key: 'atendimento' }, dependsOn: [] },
  { id: 'structure:agent-gerente', category: 'structure', title: 'Agente “Marina”', description: 'Recebe a conversa.', required: true, status: 'blocked', completionMode: 'resource_state', target: { kind: 'agent', key: 'gerente' }, dependsOn: ['structure:floor-atendimento'] },
  { id: 'knowledge:cardapio', category: 'knowledge', title: 'Enviar o cardápio com preços', description: 'Sem ele, o agente não responde preço.', required: true, status: 'ready', completionMode: 'resource_state', target: { kind: 'knowledge', key: 'cardapio' }, linkTarget: { kind: 'agent', key: 'gerente' }, dependsOn: [] },
  { id: 'app:canal', category: 'app', title: 'Conectar web_chat', description: 'Receber as conversas do site.', required: true, status: 'ready', completionMode: 'connection_state', target: { kind: 'app', key: 'web_chat' }, actionPath: '/apps', dependsOn: [] },
  { id: 'test:conversa-de-teste', category: 'test', title: 'Testar a operação com uma conversa real', description: 'Converse com o agente de entrada.', required: true, status: 'blocked', completionMode: 'manual', dependsOn: ['structure:floor-atendimento'] },
]

/** O ENTENDIMENTO de onde a proposta foi compilada. */
const BRIEF = {
  version: 3,
  businessGoal: 'atender quem chega pelo site do restaurante',
  audience: 'clientes do site',
  channels: ['web'],
  jobs: [
    {
      id: 'duvidas',
      name: 'Responder dúvidas de horário, endereço e cardápio',
      trigger: 'alguém manda mensagem no site',
      input: 'a pergunta da pessoa',
      decision: 'qual resposta cabe',
      action: 'responder',
      output: 'a resposta para a pessoa',
    },
  ],
  knowledgeNeeds: [{ subject: 'Cardápio com preços', required: true }],
  integrations: [],
  constraints: [],
  assumptions: [{ id: 'horario', text: 'Assumi atendimento em horário comercial.', status: 'open' }],
  openQuestions: ['Quem responde fora do horário comercial?'],
}

const CONTAGENS = {
  essential: { agents: 1, sectors: 0, routines: 0, apps: 1 },
  recommended: { agents: 2, sectors: 1, routines: 0, apps: 1 },
  complete: { agents: 2, sectors: 1, routines: 1, apps: 1 },
}

const READINESS = { requiredDone: 0, requiredTotal: 4, optionalDone: 0, optionalTotal: 0, ready: false, blockers: [] }

const PREVIA = {
  blueprintHash: HASH,
  valid: true,
  issues: [{ path: 'appRequirements[0]', code: 'app_not_connected', message: 'web_chat ainda não está conectado nesta conta', severity: 'warning', suggestedAction: 'conecte o App' }],
  items: [
    { kind: 'floor', key: 'atendimento', label: 'Atendimento do Restaurante', action: 'create', detail: 'Andar novo.', rationale: 'Onde a operação de atendimento mora.', dependsOn: [], usesLlm: false, requiresApproval: false, issues: [] },
    { kind: 'agent', key: 'gerente', label: 'Marina', action: 'create', detail: 'Agente novo.', rationale: 'Recebe a conversa e decide quem responde.', dependsOn: ['floor:atendimento'], usesLlm: false, requiresApproval: false, issues: [] },
    { kind: 'agent', key: 'duvidas', label: 'Rafael', action: 'create', detail: 'Agente novo.', rationale: 'Responde o que mais perguntam.', dependsOn: ['floor:atendimento'], usesLlm: false, requiresApproval: false, issues: [] },
    { kind: 'sector', key: 'setor', label: 'Mesa de Atendimento', action: 'create', detail: 'Um gerente coordena: um coordenador recebe o pedido, aciona quem precisa e junta a resposta. 2 agentes.', rationale: 'Uma porta de entrada só.', dependsOn: [], usesLlm: false, requiresApproval: false, issues: [] },
    { kind: 'app', key: 'canal', label: 'web_chat', action: 'wait_user', detail: 'Receber as conversas do site. Conecte o App para os agentes poderem usá-lo.', rationale: '', dependsOn: [], usesLlm: false, requiresApproval: false, issues: [] },
    { kind: 'knowledge', key: 'cardapio', label: 'Enviar o cardápio com preços', action: 'wait_user', detail: 'Fica pendente até você enviar o conteúdo. Nada é inventado.', rationale: 'Sem ele, o agente não responde preço.', dependsOn: [], usesLlm: false, requiresApproval: false, issues: [] },
  ],
  checklist: CHECKLIST,
  readiness: READINESS,
  counts: { create: 4, reuse: 0, update: 0, waitUser: 2 },
  layer: 'complete',
  layerCounts: CONTAGENS,
  critique: {
    clean: false,
    findings: [
      {
        source: 'responsibility',
        code: 'manager_without_team',
        agentKey: 'gerente',
        message: '"Marina" coordena, mas não alcança ninguém',
        fix: 'dê a ela delegação por andar, ou liste quem ela pode acionar',
        severity: 'error',
        evidence: ['agente "Marina"'],
      },
      {
        source: 'architecture',
        code: 'orphan_agent',
        agentKey: 'duvidas',
        message: 'nada aciona "Rafael"',
        fix: 'coloque-o num setor, ligue-o a um canal, ou dê a ele uma rotina',
        severity: 'warning',
        evidence: ['fora de setor', 'sem canal'],
      },
    ],
    score: {
      coverage: 100,
      cohesion: 100,
      executorFit: 100,
      permissionSafety: 50,
      setupCompleteness: 0,
      handoffSimplicity: 100,
      facts: {
        coverage: ['2 de 2 agentes dizem o que entregam'],
        cohesion: ['2 de 2 agentes ficam em até dois domínios'],
        executorFit: ['2 de 2 agentes têm executor coerente com o papel'],
        permissionSafety: ['1 de 2 agentes preveem passar para uma pessoa'],
        setupCompleteness: ['2 pendências antes de a operação rodar sozinha'],
        handoffSimplicity: ['0 repasses declarados entre agentes'],
      },
    },
    mergeSplit: [
      { agentKey: 'gerente', agentName: 'Marina', jobs: ['Distribuir a conversa'], rationale: 'cuida de atendimento; perfil manager' },
      { agentKey: 'duvidas', agentName: 'Rafael', jobs: ['Responder horários'], rationale: 'separado de "Marina" porque o papel é outro' },
    ],
    llmStatus: 'stale',
  },
  simulation: {
    version: 1,
    cases: [
      { id: 'job:duvida', input: 'pergunta do cliente', trigger: 'mensagem', expectedRoute: ['Responder dúvida'], expectsApproval: false },
      { id: 'fora-do-previsto', input: 'uma pergunta que não se encaixa', trigger: 'mensagem', expectedRoute: [], expectsApproval: false },
      { id: 'aprovacao', input: 'um pedido que deveria exigir aprovação', trigger: 'mensagem', expectedRoute: [], expectsApproval: true },
    ],
    results: [
      { caseId: 'job:duvida', observedRoute: ['Marina', 'Rafael'], steps: [{ kind: 'tool', ref: 'web_chat.reply', detail: 'dublê: a chamada foi registrada, não executada' }], problems: [], sideEffectsAvoided: ['web_chat.reply'], matchedExpected: true },
      { caseId: 'fora-do-previsto', observedRoute: ['Marina'], steps: [], problems: [], sideEffectsAvoided: [], matchedExpected: true },
      { caseId: 'aprovacao', observedRoute: ['Marina'], steps: [], problems: [{ code: 'missing_approval', message: 'o cenário exige aprovação e o caminho não para em ninguém', fix: 'ligue a passagem para humano' }], sideEffectsAvoided: [], matchedExpected: false },
    ],
    passed: 2,
  },
}

const projeto = (extra: Record<string, unknown> = {}) => ({
  id: PROJETO_ID,
  title: 'Atendimento do Restaurante',
  objective: 'Quero automatizar o atendimento do meu restaurante',
  status: 'discovery',
  locale: 'pt',
  readiness: READINESS,
  hasBlueprint: false,
  createdAt: NOW,
  updatedAt: NOW,
  appliedAt: null,
  provider: 'anthropic',
  model: null,
  answers: {},
  pendingQuestion: null,
  assumptions: [],
  blueprint: null,
  blueprintHash: null,
  checklist: [],
  applyState: null,
  ...extra,
})

const PERGUNTA = {
  key: 'canais-de-atendimento',
  text: 'Por onde as pessoas falam com você hoje?',
  why: 'O canal decide quem recebe a conversa.',
  choices: [
    { value: 'web', label: 'Site' },
    { value: 'whatsapp', label: 'WhatsApp' },
  ],
  allowUnknown: true,
}

const COM_PROPOSTA = projeto({
  status: 'draft',
  hasBlueprint: true,
  blueprint: BLUEPRINT,
  plan: BLUEPRINT,
  layer: 'complete',
  layerCounts: CONTAGENS,
  brief: BRIEF,
  canUndoBrief: true,
  blueprintHash: HASH,
  checklist: CHECKLIST,
  assumptions: BLUEPRINT.assumptions,
})

let aplicado: Record<string, unknown> | null = null
let mensagensEnviadas: string[] = []
/** Quais conversas o servidor recebeu ordem de apagar. */
let apagados: string[] = []
let ligacoes: Record<string, unknown> | null = null
let salvoNoProjeto: Record<string, unknown> | null = null
let rodadasAutomaticas = 0
/** O que a tela mandou corrigir na proposta — e a prévia que o servidor devolveria depois. */
let edicoesEnviadas: { kind: string; key: string; fields?: Record<string, string>; remove?: boolean }[] = []
/** A camada que a tela pediu para aplicar, e a correção do entendimento que ela mandou. */
let camadaPedida: string | null = null
let briefEnviado: Record<string, unknown> | null = null
let previaCorrente = PREVIA

// A FORMA REAL de `/api/providers`: `models` é uma lista de objetos, não de textos.
// O stub antigo dizia `string[]` — a mesma suposição errada do código —, e por isso
// nenhum teste pegou a tela caindo ao renderizar um objeto dentro de <option>.
const PROVEDORES = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    models: [
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
    defaultModel: 'claude-sonnet-5',
    configured: true,
  },
  { id: 'openai', label: 'OpenAI (GPT)', models: [{ id: 'gpt-5.1', label: 'GPT-5.1' }], defaultModel: 'gpt-5.1', configured: false },
]

async function stub(
  page: Page,
  opts: {
    projects?: unknown[]
    project?: Record<string, unknown>
    messages?: unknown[]
    turn?: { status?: number; json: unknown }
    preview?: unknown
    apply?: { status?: number; json: unknown }
    resume?: { status?: number; json: unknown }
    targets?: unknown
    providers?: unknown
  } = {},
) {
  aplicado = null
  mensagensEnviadas = []
  apagados = []
  ligacoes = null
  salvoNoProjeto = null
  rodadasAutomaticas = 0
  edicoesEnviadas = []
  camadaPedida = null
  briefEnviado = null
  previaCorrente = (opts.preview as typeof PREVIA) ?? PREVIA
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))

  const proj = opts.project ?? projeto()
  await page.route('**/api/architect/projects', (r) => {
    if (r.request().method() === 'POST') return r.fulfill({ status: 201, json: proj })
    return r.fulfill({ json: opts.projects ?? [] })
  })
  await page.route('**/api/architect/projects/*/messages', (r) => {
    if (r.request().method() === 'POST') {
      mensagensEnviadas.push((r.request().postDataJSON() as { content: string }).content)
      const t = opts.turn ?? { json: { ...proj, assistantText: 'Por onde as pessoas falam com você hoje?', question: PERGUNTA } }
      return r.fulfill({ status: t.status ?? 200, json: t.json })
    }
    return r.fulfill({ json: opts.messages ?? [] })
  })
  await page.route('**/api/architect/targets', (r) => r.fulfill({ json: opts.targets ?? { floors: [], agents: [], sectors: [], routines: [] } }))
  await page.route('**/api/architect/projects/*/links', (r) => {
    ligacoes = r.request().postDataJSON() as Record<string, unknown>
    return r.fulfill({ json: { ...COM_PROPOSTA, status: 'draft' } })
  })
  await page.route('**/api/architect/projects/*/turn', (r) => {
    rodadasAutomaticas += 1
    const t = opts.turn ?? { json: { ...proj, assistantText: 'Por onde as pessoas falam com você hoje?', question: PERGUNTA } }
    return r.fulfill({ status: t.status ?? 200, json: t.json })
  })
  await page.route('**/api/architect/projects/*/rollback', (r) =>
    r.fulfill({ json: { ...COM_PROPOSTA, status: 'draft', removed: ['agent:gerente', 'agent:duvidas'], kept: [{ key: 'atendimento', reason: 'é o único andar do prédio' }] } }),
  )
  await page.route('**/api/architect/projects/*/archive', (r) => r.fulfill({ json: { ...COM_PROPOSTA, status: 'archived' } }))
  await page.route('**/api/providers', (r) => r.fulfill({ json: opts.providers ?? PROVEDORES }))
  await page.route('**/api/architect/projects/*/generate', (r) =>
    r.fulfill({ json: { ...COM_PROPOSTA, assistantText: 'Montei uma primeira proposta.', question: null } }),
  )
  await page.route('**/api/architect/projects/*/validate', (r) => r.fulfill({ json: { valid: true, issues: PREVIA.issues } }))
  await page.route('**/api/architect/projects/*/preview', (r) => r.fulfill({ json: previaCorrente }))
  // Corrigir a proposta à mão: o servidor devolve o projeto com o que mudou, e a
  // prévia seguinte já vem com o item corrigido — é assim que a tela real se comporta.
  await page.route('**/api/architect/projects/*/blueprint', (r) => {
    const body = r.request().postDataJSON() as { edits: typeof edicoesEnviadas }
    edicoesEnviadas.push(...body.edits)
    const mudancas: { kind: string; key: string; label: string; change: string; fields: string[] }[] = []
    for (const e of body.edits) {
      const anterior = previaCorrente.items.find((i) => i.kind === e.kind && i.key === e.key)
      if (e.remove) {
        mudancas.push({ kind: e.kind, key: e.key, label: anterior?.label ?? e.key, change: 'removed', fields: [] })
        previaCorrente = { ...previaCorrente, items: previaCorrente.items.filter((i) => !(i.kind === e.kind && i.key === e.key)) }
        continue
      }
      const nome = e.fields?.name ?? e.fields?.title ?? anterior?.label ?? e.key
      mudancas.push({ kind: e.kind, key: e.key, label: nome, change: 'changed', fields: Object.keys(e.fields ?? {}) })
      previaCorrente = { ...previaCorrente, items: previaCorrente.items.map((i) => (i.kind === e.kind && i.key === e.key ? { ...i, label: nome } : i)) }
    }
    // O servidor devolve o blueprint JÁ com a edição aplicada — é o que faz o desenho
    // do escritório e o fluxo acompanharem sem recarregar. Um stub que devolvesse o
    // blueprint antigo esconderia justamente isso.
    const blueprint = {
      ...BLUEPRINT,
      agents: BLUEPRINT.agents.map((a) => {
        const edit = body.edits.find((e) => e.kind === 'agent' && e.key === a.key)
        return edit?.fields ? { ...a, ...edit.fields } : a
      }),
    }
    return r.fulfill({ json: { ...COM_PROPOSTA, blueprint, changes: mudancas } })
  })
  // Trocar a camada é uma revisão: o servidor devolve o projeto recortado, em rascunho.
  await page.route('**/api/architect/projects/*/layer', (r) => {
    camadaPedida = (r.request().postDataJSON() as { layer: string }).layer
    const essencial = camadaPedida === 'essential'
    previaCorrente = {
      ...previaCorrente,
      blueprintHash: `${HASH}-${camadaPedida}`,
      layer: camadaPedida as 'essential',
      items: essencial ? previaCorrente.items.filter((i) => i.key !== 'duvidas' && i.kind !== 'sector') : PREVIA.items,
    }
    return r.fulfill({
      json: {
        ...COM_PROPOSTA,
        layer: camadaPedida,
        blueprintHash: `${HASH}-${camadaPedida}`,
        blueprint: essencial ? { ...BLUEPRINT, agents: [BLUEPRINT.agents[0]], sectors: [] } : BLUEPRINT,
      },
    })
  })
  await page.route('**/api/architect/projects/*/brief', (r) => {
    const body = r.request().postDataJSON() as { patch?: Record<string, unknown>; undo?: boolean }
    briefEnviado = body
    if (body.undo) return r.fulfill({ json: { ...COM_PROPOSTA, canUndoBrief: false } })
    return r.fulfill({ json: { ...COM_PROPOSTA, brief: { ...BRIEF, ...body.patch } } })
  })
  await page.route('**/api/architect/projects/*/apply', (r) => {
    aplicado = r.request().postDataJSON() as Record<string, unknown>
    const a = opts.apply ?? {
      json: {
        ...COM_PROPOSTA,
        status: 'applied',
        appliedAt: NOW,
        checklist: CHECKLIST.map((i) => (i.category === 'structure' ? { ...i, status: 'done' } : i)),
        readiness: { ...READINESS, requiredDone: 2 },
        operation: { id: 'op-1', status: 'completed', steps: [], error: null },
        links: [
          { kind: 'floor', key: 'atendimento', id: 'f1', path: '/floors/f1' },
          { kind: 'agent', key: 'gerente', id: 'a1', path: '/agents/a1' },
        ],
      },
    }
    return r.fulfill({ status: a.status ?? 200, json: a.json })
  })
  await page.route('**/api/architect/projects/*/resume', (r) => {
    const a = opts.resume ?? { json: { ...COM_PROPOSTA, status: 'applied', operation: null, links: [] } }
    return r.fulfill({ status: a.status ?? 200, json: a.json })
  })
  await page.route('**/api/architect/projects/*/recheck', (r) =>
    r.fulfill({ json: { ...COM_PROPOSTA, checklist: CHECKLIST.map((i) => (i.id === 'app:canal' ? { ...i, status: 'done' } : i)), links: [] } }),
  )
  await page.route('**/api/architect/projects/*/checklist/*', (r) => {
    const body = r.request().postDataJSON() as { done: boolean }
    return r.fulfill({ json: { ...COM_PROPOSTA, checklist: CHECKLIST.map((i) => (i.completionMode === 'manual' ? { ...i, status: body.done ? 'done' : 'ready' } : i)) } })
  })
  await page.route('**/api/architect/projects/*', (r) => {
    if (r.request().method() === 'DELETE') {
      apagados.push(r.request().url().split('/').pop() as string)
      return r.fulfill({ status: 204, body: '' })
    }
    if (r.request().method() === 'PATCH') {
      salvoNoProjeto = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ json: { ...proj, ...salvoNoProjeto } })
    }
    return r.fulfill({ json: proj })
  })

  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW } }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) => r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }))
}

// --- a lista ---------------------------------------------------------------------------

test('a primeira tela não é uma folha em branco: traz exemplos clicáveis', async ({ page }) => {
  await stub(page)
  await page.goto('/architect')
  await expect(page.getByTestId('architect-projects')).toBeVisible()
  await page.getByTestId('architect-example').first().click()
  await expect(page.getByTestId('architect-objective')).toHaveValue(/restaurante/i)
})

test('a lista diz que nada é criado antes da confirmação', async ({ page }) => {
  await stub(page)
  await page.goto('/architect')
  await expect(page.getByText(/Nada é criado antes de você revisar e confirmar/i)).toBeVisible()
})

test('descrever a operação leva para a conversa', async ({ page }) => {
  await stub(page)
  await page.goto('/architect')
  await page.getByTestId('architect-objective').fill('Quero automatizar o atendimento do meu restaurante')
  await page.getByTestId('architect-start').click()
  await expect(page).toHaveURL(new RegExp(`/architect/${PROJETO_ID}$`))
  await expect(page.getByTestId('architect-conversation')).toBeVisible()
})

test('um projeto existente aparece na lista com o estado dele', async ({ page }) => {
  await stub(page, { projects: [{ ...projeto({ status: 'applied', readiness: { ...READINESS, requiredDone: 4 } }) }] })
  await page.goto('/architect')
  await expect(page.getByTestId(`architect-project-${PROJETO_ID}`)).toContainText('Aplicada')
  await expect(page.getByTestId(`architect-project-${PROJETO_ID}`)).toContainText('4/4 obrigatórios')
})

test('dá para apagar uma conversa, e a tela avisa que o que ela criou continua de pé', async ({ page }) => {
  let listaAtual: unknown[] = [projeto({ status: 'applied' })]
  await stub(page, { projects: listaAtual })
  // A recarga depois de apagar tem que trazer a lista NOVA: apagar só no estado local
  // mente quando a chamada falha no meio.
  await page.route('**/api/architect/projects', (r) => r.fulfill({ json: listaAtual }))

  await page.goto('/architect')
  await expect(page.getByTestId(`architect-project-${PROJETO_ID}`)).toBeVisible()

  await page.getByTestId(`architect-delete-${PROJETO_ID}`).click()
  // O aviso é a parte que importa: apagar a conversa não desfaz a operação.
  await expect(page.getByText(/O que ela já criou continua de pé/i)).toBeVisible()

  listaAtual = []
  await page.getByTestId('architect-delete-confirm').click()

  await expect.poll(() => apagados).toContain(PROJETO_ID)
  await expect(page.getByTestId(`architect-project-${PROJETO_ID}`)).toHaveCount(0)
  await expect(page.getByText('Nenhuma operação montada ainda')).toBeVisible()
})

test('uma conversa que está sendo aplicada não pode ser apagada', async ({ page }) => {
  // Ela escreve no escritório agora: sumir com o registro deixaria trabalho órfão.
  await stub(page, { projects: [projeto({ status: 'applying' })] })
  await page.goto('/architect')
  await expect(page.getByTestId(`architect-delete-${PROJETO_ID}`)).toBeDisabled()
})

// --- a conversa -------------------------------------------------------------------------------

test('o Arquiteto pergunta uma coisa por vez, com opções e “não sei ainda”', async ({ page }) => {
  await stub(page, { messages: [{ id: 'm1', role: 'user', content: 'quero automatizar o atendimento', createdAt: NOW }] })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-input').fill('quero automatizar')
  await page.getByTestId('architect-send').click()

  await expect(page.getByTestId('architect-question')).toBeVisible()
  await expect(page.getByText('O canal decide quem recebe a conversa.')).toBeVisible()
  await expect(page.getByTestId('architect-choice-web')).toBeVisible()
  await expect(page.getByTestId('architect-unknown')).toBeVisible()
})

test('responder por uma opção manda o rótulo, sem a pessoa digitar', async ({ page }) => {
  await stub(page)
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-input').fill('oi')
  await page.getByTestId('architect-send').click()
  await page.getByTestId('architect-choice-whatsapp').click()
  await expect.poll(() => mensagensEnviadas).toContain('WhatsApp')
})

test('“não sei ainda” é uma resposta aceita', async ({ page }) => {
  await stub(page)
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-input').fill('oi')
  await page.getByTestId('architect-send').click()
  await page.getByTestId('architect-unknown').click()
  await expect.poll(() => mensagensEnviadas).toContain('Não sei ainda')
})

test('dá para pedir uma primeira proposta agora', async ({ page }) => {
  await stub(page)
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-generate').click()
  await expect(page.getByTestId('architect-proposal')).toBeVisible()
})

test('a credencial colada some da tela e vira um aviso', async ({ page }) => {
  await stub(page, {
    turn: { json: { ...projeto(), assistantText: 'Prossigo sem a chave.', question: null, secretMasked: true } },
    messages: [
      { id: 'm1', role: 'user', content: 'minha chave é [credencial removida]', createdAt: NOW },
      { id: 'm2', role: 'system_notice', content: 'Removi o que parecia uma credencial da sua mensagem.', createdAt: NOW },
    ],
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-input').fill('minha chave é ghp_abcdefghijklmnopqrstuvwxyz0123')
  await page.getByTestId('architect-send').click()
  await expect(page.getByTestId('architect-message-system_notice')).toContainText(/credencial/i)
})

// --- a proposta ---------------------------------------------------------------------------------

test('a proposta mostra o que será criado e o que depende da pessoa', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-counts')).toContainText('4 a criar')
  await expect(page.getByTestId('architect-counts')).toContainText('2 dependem de você')
  await expect(page.getByTestId('architect-item-agent-gerente')).toContainText('Marina')
  await expect(page.getByTestId('architect-item-knowledge-cardapio')).toContainText('Nada é inventado')
  await expect(page.getByTestId('architect-item-app-canal')).toContainText('Depende de você')
})

test('a ficha do agente diz o que ele entrega, com o quê e o que NÃO faz', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)

  const ficha = page.getByTestId('architect-agent-card-gerente')
  await expect(ficha).toContainText('Coordena')
  await expect(page.getByTestId('architect-agent-objective-gerente')).toContainText('Distribuir a conversa')
  await expect(page.getByTestId('architect-agent-limits-gerente')).toContainText('Não responde preço nem prazo')
  await expect(page.getByTestId('architect-agent-executor-gerente')).toContainText('interpreta e responde')
  await expect(page.getByTestId('architect-agent-tools-gerente')).toContainText('web_chat')
  await expect(page.getByTestId('architect-agent-handoff-gerente')).toContainText('passa para uma pessoa')
  // Por que ele é um agente separado — a pergunta que decide se há gente demais.
  await expect(page.getByTestId('architect-agent-rationale-duvidas')).toContainText('o papel é outro')
  // O problema do agente aparece NO agente, e não só numa lista solta em cima.
  await expect(page.getByTestId('architect-agent-problems-gerente')).toContainText('1 ponto a resolver')
  await expect(ficha).toContainText('não alcança ninguém')
})

test('o que não foi declarado aparece como não declarado', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  // Rafael não tem "não faz" escrito. Preencher com um padrão bonito esconderia
  // justamente o campo que precisa ser corrigido antes de aplicar.
  await expect(page.getByTestId('architect-agent-limits-duvidas')).toContainText('não declarado')
  await expect(page.getByTestId('architect-agent-handoff-duvidas')).toContainText('não passa para ninguém')
})

// --- as camadas ---------------------------------------------------------------------------------

test('as três camadas são o mesmo plano em três tamanhos — e trocar é uma revisão', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)

  const essencial = page.getByTestId('architect-layer-essential')
  await expect(essencial).toContainText('Essencial')
  // A contagem é o que torna a escolha comparável.
  await expect(essencial).toContainText('1 agente')
  await expect(page.getByTestId('architect-layer-complete')).toContainText('2 agentes')
  await expect(page.getByTestId('architect-layer-complete')).toHaveAttribute('aria-checked', 'true')

  await essencial.click()
  expect(camadaPedida).toBe('essential')
  // O recorte novo vale para tudo: o agente que saiu some da proposta.
  await expect(page.getByTestId('architect-layer-essential')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('architect-item-agent-duvidas')).toHaveCount(0)
  await expect(page.getByTestId('architect-item-agent-gerente')).toBeVisible()
})

// --- o entendimento -----------------------------------------------------------------------------

test('"O que entendi" mostra os fatos de onde a proposta saiu', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)

  const brief = page.getByTestId('architect-brief')
  await expect(page.getByTestId('architect-brief-goal')).toContainText('atender quem chega pelo site')
  // O trabalho aparece como a frase inteira, na ordem em que ele acontece.
  await expect(page.getByTestId('architect-brief-job-duvidas')).toContainText('Quando alguém manda mensagem no site')
  await expect(page.getByTestId('architect-brief-job-duvidas')).toContainText('entrega a resposta para a pessoa')
  await expect(brief).toContainText('Cardápio com preços')
  // O que ainda não se sabe é dito — e não vira suposição escondida.
  await expect(brief).toContainText('Quem responde fora do horário comercial?')
})

test('corrigir o entendimento refaz a proposta, e dá para desfazer', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)

  await page.getByTestId('architect-brief-job-duvidas').click()
  await page.getByTestId('architect-brief-field-output').fill('a resposta e o link do cardápio')
  await page.getByTestId('architect-brief-save').click()

  await expect.poll(() => (briefEnviado?.patch as { jobs?: { output: string }[] })?.jobs?.[0]?.output).toBe('a resposta e o link do cardápio')

  await page.getByTestId('architect-brief-undo').click()
  await expect.poll(() => briefEnviado?.undo).toBe(true)
  // Desfeito, não há mais o que desfazer — e o botão some em vez de mentir.
  await expect(page.getByTestId('architect-brief-undo')).toHaveCount(0)
})

test('a leitura obsoleta do modelo é dita como obsoleta, não mostrada como atual', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-llm-status')).toContainText('revisão anterior')
})

test('7) o porquê de cada item aparece — foi gerado e pago, não se joga fora', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-rationale-agent-gerente')).toContainText('Recebe a conversa e decide quem responde')
  // O que VAI ACONTECER e o PORQUÊ são coisas diferentes, e aparecem separados.
  await expect(page.getByTestId('architect-item-agent-gerente')).toContainText('Agente novo.')
  await expect(page.getByTestId('architect-rationale-floor-atendimento')).toContainText('Onde a operação de atendimento mora')
})

test('6) trocar o nome de um agente é edição na tela, sem pedir nada ao modelo', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-item-edit-agent-gerente').click()

  // O formulário abre com o que já está na proposta — corrigir não é redigitar.
  const bloco = page.getByTestId('architect-edit-agent-gerente')
  await expect(bloco.getByTestId('architect-edit-field-name')).toHaveValue('Marina')
  await expect(bloco.getByTestId('architect-edit-field-objective')).toHaveValue(/Distribuir a conversa/)

  await bloco.getByTestId('architect-edit-field-name').fill('Recepcionista')
  await bloco.getByTestId('architect-edit-save').click()

  await expect(page.getByTestId('architect-item-agent-gerente')).toContainText('Recepcionista')
  expect(edicoesEnviadas).toHaveLength(1)
  expect(edicoesEnviadas[0].kind).toBe('agent')
  expect(edicoesEnviadas[0].fields?.name).toBe('Recepcionista')
  // Nenhuma rodada de conversa foi disparada por causa de uma correção de texto.
  expect(mensagensEnviadas).toEqual([])
  expect(rodadasAutomaticas).toBe(0)
})

test('8) depois da correção, a tela diz o que mudou', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-changes')).toHaveCount(0, { timeout: 5000 })

  await page.getByTestId('architect-item-edit-agent-duvidas').click()
  await page.getByTestId('architect-edit-field-name').fill('Atendente do salão')
  await page.getByTestId('architect-edit-save').click()

  await expect(page.getByTestId('architect-changes')).toContainText('Atendente do salão')
  await expect(page.getByTestId('architect-changes')).toContainText('Mudou')
})

test('tirar um item da proposta é possível, e a recusa do servidor é dita por inteiro', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.route('**/api/architect/projects/*/blueprint', (r) =>
    r.fulfill({ status: 400, json: { code: 'validation_error', message: 'não dá para remover: o setor "Atendimento" depende deste item' } }),
  )
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-item-edit-agent-duvidas').click()
  await page.getByTestId('architect-edit-remove').click()
  // Quem depende do item é a única pista útil; trocar por "não foi possível" a apagaria.
  await expect(page.getByTestId('architect-edit-error')).toContainText('o setor "Atendimento" depende')
  // O formulário continua aberto com o erro ao lado, e o item não sumiu da proposta:
  // uma recusa do servidor não pode deixar a tela dizendo que a remoção aconteceu.
  await expect(page.getByTestId('architect-edit-agent-duvidas')).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByTestId('architect-item-agent-duvidas')).toContainText('Rafael')
})

test('proposta já aplicada não se edita na tela', async ({ page }) => {
  await stub(page, { project: { ...COM_PROPOSTA, status: 'applied', appliedAt: NOW } })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-item-agent-gerente')).toBeVisible()
  await expect(page.getByTestId('architect-item-edit-agent-gerente')).toHaveCount(0)
})

test('quatro telas, uma por vez — e a escolhida fica marcada', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)

  // Proposta é a primeira: é onde se decide.
  await expect(page.getByTestId('architect-tab-proposta')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('architect-proposal')).toBeVisible()
  await expect(page.getByTestId('architect-flow')).toHaveCount(0)

  for (const [aba, alvo] of [
    ['fluxo', 'architect-flow'],
    ['escritorio', 'architect-office-preview'],
    ['checklist', 'architect-checklist'],
    ['proposta', 'architect-proposal'],
  ] as const) {
    await page.getByTestId(`architect-tab-${aba}`).click()
    await expect(page.getByTestId(alvo)).toBeVisible()
    await expect(page.getByTestId(`architect-tab-${aba}`)).toHaveAttribute('aria-selected', 'true')
    // Uma por vez: as outras não ficam montadas atrás.
    const outras = ['architect-flow', 'architect-office-preview', 'architect-checklist', 'architect-proposal'].filter((t) => t !== alvo)
    for (const t of outras) await expect(page.getByTestId(t)).toHaveCount(0)
  }
})

test('sem proposta ainda, não há abas — a conversa é a tela', async ({ page }) => {
  await stub(page)
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-conversation')).toBeVisible()
  await expect(page.getByTestId('architect-tabs')).toHaveCount(0)
})

test('a conversa recolhe e volta por um botão — recolhida, ela não some', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)

  await page.getByTestId('architect-chat-collapse').click()
  await expect(page.getByTestId('architect-chat-panel')).toBeHidden()
  // O caminho para pedir mudança não pode sumir junto com o painel.
  const botao = page.getByTestId('architect-chat-open')
  await expect(botao).toBeVisible()
  await botao.click()
  await expect(page.getByTestId('architect-chat-panel')).toBeVisible()
  await expect(page.getByTestId('architect-input')).toBeVisible()
})

test('o fluxo mostra quem coordena e quem é acionado — não só a lista', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-tab-fluxo').click()

  const fluxo = page.getByTestId('architect-flow')
  await expect(fluxo).toBeVisible()
  // O andar, o setor e o MODO dele: um setor "organization" e um "orchestrated"
  // produzem a mesma lista de itens e operações completamente diferentes.
  await expect(page.getByTestId('architect-flow-floor-atendimento')).toContainText('Atendimento do Restaurante')
  await expect(page.getByTestId('architect-flow-sector-setor')).toContainText('Mesa de Atendimento')
  await expect(page.getByTestId('architect-flow-sector-setor')).toContainText('o coordenador decide quem responde')
  // Quem coordena, quem é acionado, e o papel de cada um.
  await expect(page.getByTestId('architect-flow-agent-gerente')).toContainText('Marina')
  await expect(page.getByTestId('architect-flow-agent-gerente')).toContainText('coordena')
  await expect(page.getByTestId('architect-flow-sector-setor')).toContainText('aciona')
  await expect(page.getByTestId('architect-flow-agent-duvidas')).toContainText('busca informação')
  // E o que depende da pessoa aparece junto do desenho.
  await expect(page.getByTestId('architect-flow-needs')).toContainText('web_chat')
})

test('depois de aplicar, a conversa continua aberta para pedir ajuste', async ({ page }) => {
  await stub(page, { project: { ...COM_PROPOSTA, status: 'applied', appliedAt: NOW } })
  await page.goto(`/architect/${PROJETO_ID}`)

  // O campo ficava desabilitado com "Este projeto já foi aplicado." — e trocar uma
  // instrução exigia começar outro projeto, que não sabia o que já existia.
  const campo = page.getByTestId('architect-input')
  await expect(campo).toBeEnabled()
  await campo.fill('troque o objetivo da Marina')
  await page.getByTestId('architect-send').click()
  await expect.poll(() => mensagensEnviadas).toContain('troque o objetivo da Marina')
})

test('o crítico aparece antes da lista, com o conserto ao lado', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)

  const critica = page.getByTestId('architect-critique')
  await expect(critica).toBeVisible()
  // O que trava vem marcado como trava; o que vale ver, como aviso.
  const gerente = page.getByTestId('architect-finding-manager_without_team')
  await expect(gerente).toContainText('coordena, mas não alcança ninguém')
  await expect(gerente).toContainText('O que fazer:')
  await expect(gerente).toContainText('Trava')
  await expect(page.getByTestId('architect-finding-orphan_agent')).toContainText('Vale ver')

  // A leitura da operação carrega o FATO de cada nota — nota sem fato é palpite com número.
  const score = page.getByTestId('architect-score')
  await expect(score).toContainText('entrega declarada')
  await expect(score).toContainText('2 de 2 agentes dizem o que entregam')
  // E não se chama confiança da IA em lugar nenhum.
  await expect(critica).not.toContainText(/confian/i)
})

test('o ensaio mostra o caminho e diz que nada foi executado', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)

  const ensaio = page.getByTestId('architect-simulation')
  await expect(ensaio).toContainText('2 de 3 cenários passaram')
  // A garantia que mais importa: nada sai daqui.
  await expect(ensaio).toContainText('sem executar nada')
  await expect(ensaio).toContainText('dublê')
  await expect(page.getByTestId('architect-scenario-job:duvida')).toContainText('Marina → Rafael')
  // O cenário que falhou aparece com o motivo e o conserto.
  const aprovacao = page.getByTestId('architect-scenario-aprovacao')
  await expect(aprovacao).toContainText('não para em ninguém')
  await expect(aprovacao).toContainText('ligue a passagem para humano')
})

test('o motivo de cada agente existir fica visível', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  const bloco = page.getByTestId('architect-mergesplit')
  await expect(bloco).toContainText('Marina')
  await expect(bloco).toContainText('perfil manager')
})

test('o que preocupa aparece como aviso, e não como erro', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-warnings')).toContainText('web_chat ainda não está conectado')
  await expect(page.getByTestId('architect-issues')).toHaveCount(0)
})

test('o que bloqueia aparece com o que fazer, e o botão de aplicar fica travado', async ({ page }) => {
  await stub(page, {
    project: COM_PROPOSTA,
    preview: { ...PREVIA, valid: false, issues: [{ path: 'sectors[0]', code: 'coordinator_alone', message: 'um setor orquestrado precisa de pelo menos um especialista', severity: 'error', suggestedAction: 'inclua outro agente' }] },
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-issues')).toContainText('precisa de pelo menos um especialista')
  await expect(page.getByTestId('architect-issues')).toContainText('inclua outro agente')
  await expect(page.getByTestId('architect-apply')).toBeDisabled()
})

test('as suposições ficam visíveis, e não escondidas na proposta', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-assumptions')).toContainText('horário comercial')
})

test('o JSON existe, mas fica em “Avançado”', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-proposal')).not.toContainText('blueprintPatch')
  await page.getByTestId('architect-advanced').getByText('Avançado').click()
  await expect(page.getByTestId('architect-advanced')).toContainText('knowledgeRequirements')
})

test('1) o reaproveitamento proposto já vem apontado para o recurso de mesmo nome', async ({ page }) => {
  // O modelo propõe "reuse" identificando pelo NOME — ele não escreve id. Sem a ponte,
  // a pessoa recebia o select em "Criar novo" e um erro mandando escolher o recurso.
  const comReuso = {
    ...COM_PROPOSTA,
    blueprint: { ...BLUEPRINT, floors: [{ ...BLUEPRINT.floors[0], action: 'reuse' }] },
  }
  await stub(page, {
    project: comReuso,
    targets: { floors: [{ id: 'f9', name: 'Atendimento do Restaurante' }], agents: [], sectors: [], routines: [] },
  })
  await page.goto(`/architect/${PROJETO_ID}`)

  await expect(page.getByTestId('architect-link-suggested-floor-atendimento')).toContainText('Atendimento do Restaurante')
  await expect(page.getByTestId('architect-link-floor-atendimento')).toHaveValue('reuse|f9')

  await page.getByTestId('architect-links-save').click()
  await expect.poll(() => ligacoes).toMatchObject({ links: [{ kind: 'floor', key: 'atendimento', action: 'reuse', resourceId: 'f9' }] })
})

test('sem um nome igual, nada é adivinhado', async ({ page }) => {
  const comReuso = {
    ...COM_PROPOSTA,
    blueprint: { ...BLUEPRINT, floors: [{ ...BLUEPRINT.floors[0], action: 'reuse' }] },
  }
  await stub(page, {
    project: comReuso,
    // Dois com o mesmo nome: ligar ao errado seria pior que não sugerir.
    targets: { floors: [{ id: 'f1', name: 'Atendimento do Restaurante' }, { id: 'f2', name: 'atendimento do restaurante' }], agents: [], sectors: [], routines: [] },
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-link-suggested-floor-atendimento')).toHaveCount(0)
  await expect(page.getByTestId('architect-link-floor-atendimento')).toHaveValue('')
})

// --- 3) o conteúdo do conhecimento ---------------------------------------------------

test('3) dá para colar o conteúdo do conhecimento na própria proposta', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-item-edit-knowledge-cardapio').click()

  await expect(page.getByText(/nada é inventado/i)).toBeVisible()
  await page.getByTestId('architect-edit-field-content').fill('Pizza margherita 40. Refrigerante 8.')
  await page.getByTestId('architect-edit-save').click()

  await expect.poll(() => edicoesEnviadas).toMatchObject([{ kind: 'knowledge', key: 'cardapio', fields: { content: 'Pizza margherita 40. Refrigerante 8.' } }])
})

// --- 4 e 5) a espera e o aviso que já passou -----------------------------------------

test('4) a espera é anunciada, e não parece uma tela travada', async ({ page }) => {
  await stub(page)
  // Uma rodada lenta de propósito: é onde o "Pensando…" precisa se explicar.
  await page.route('**/api/architect/projects/*/messages', async (r) => {
    if (r.request().method() !== 'POST') return r.fulfill({ json: [] })
    await new Promise((resolve) => setTimeout(resolve, 4500))
    return r.fulfill({ json: { ...projeto(), assistantText: 'Pronto.', question: null } })
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-input').fill('oi')
  await page.getByTestId('architect-send').click()

  const espera = page.getByTestId('architect-thinking')
  await expect(espera).toHaveAttribute('role', 'status')
  await expect(espera).toContainText(/Pensando… \ds/)
})

test('5) a falha já resolvida sai do alarme, mas fica no histórico', async ({ page }) => {
  await stub(page, {
    messages: [
      { id: 'm1', role: 'user', content: 'quero automatizar', createdAt: NOW },
      { id: 'm2', role: 'system_notice', content: 'A chave do provedor foi recusada.', failure: true, resolved: true, createdAt: NOW },
      { id: 'm3', role: 'assistant', content: 'Por onde falam com você?', createdAt: NOW },
    ],
    project: COM_PROPOSTA,
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  const aviso = page.getByTestId('architect-message-system_notice')
  await expect(aviso).toContainText('A chave do provedor foi recusada')
  await expect(aviso).toContainText('já resolvido')
  await expect(aviso).toHaveAttribute('data-resolved', 'sim')
})


// --- o chat flutuante ------------------------------------------------------------------------

test('no desktop o chat FLUTUA: ele não toma largura de nada', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)

  const painel = page.getByTestId('architect-chat-panel')
  expect(await painel.evaluate((el) => getComputedStyle(el).position)).toBe('fixed')

  // A largura da área de trabalho é a MESMA com o chat aberto e fechado. Era isso que a
  // coluna lateral fazia: ela comia 400px da proposta o tempo todo.
  const comChat = (await page.getByTestId('architect-workspace').boundingBox())!.width
  await page.getByTestId('architect-chat-collapse').click()
  await expect(painel).toBeHidden()
  const semChat = (await page.getByTestId('architect-workspace').boundingBox())!.width
  expect(semChat).toBe(comChat)

  // Fechado, ele vira botão — o caminho para pedir mudança não some.
  await expect(page.getByTestId('architect-chat-open')).toBeVisible()
})

test('fechar e reabrir preserva a conversa e o que estava digitado', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await stub(page, {
    project: COM_PROPOSTA,
    messages: [{ id: 'm1', role: 'assistant', content: 'Montei a proposta.', createdAt: NOW }],
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-message-assistant')).toContainText('Montei a proposta.')

  await page.getByTestId('architect-input').fill('quero trocar o nome da Marina')
  await page.getByTestId('architect-chat-collapse').click()
  await page.getByTestId('architect-chat-open').click()

  // O texto continua lá: fechar é esconder, não desmontar. Perder o que a pessoa
  // escreveu ao clicar em "fechar" seria um jeito eficiente de ensinar a nunca fechar.
  await expect(page.getByTestId('architect-input')).toHaveValue('quero trocar o nome da Marina')
  await expect(page.getByTestId('architect-message-assistant')).toContainText('Montei a proposta.')
})

test('trocar de tela não mexe na conversa — e existe UMA conversa só', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)

  await page.getByTestId('architect-input').fill('rascunho de pergunta')
  await page.getByTestId('architect-tab-escritorio').click()
  await page.getByTestId('architect-tab-checklist').click()
  await expect(page.getByTestId('architect-input')).toHaveValue('rascunho de pergunta')
  // Duas instâncias montadas (uma do desktop, outra do celular) fariam o que você
  // digitou numa não estar na outra.
  await expect(page.getByTestId('architect-conversation')).toHaveCount(1)
})

// --- a prévia do escritório --------------------------------------------------------------------

test('o escritório mostra os agentes e setores da proposta', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-tab-escritorio').click()

  await expect(page.getByTestId('architect-office-totals')).toContainText('2 agentes')
  await expect(page.getByTestId('architect-office-totals')).toContainText('1 setor')
  await expect(page.getByTestId('architect-office-totals')).toContainText('1 andar')

  // O mesmo mapa da página inicial, com a descrição em texto ao lado dele.
  await expect(page.getByTestId('architect-office-map')).toBeVisible()
  const descricao = page.getByTestId('architect-office-description')
  await expect(descricao).toContainText('Atendimento do Restaurante')
  await expect(descricao).toContainText('2 agentes')
  await expect(descricao).toContainText('Mesa de Atendimento (Marina, Rafael)')
  // E fica dito que é rascunho: um mapa idêntico ao do escritório real precisa avisar
  // que nada ali existe ainda.
  await expect(page.getByTestId('architect-office-notice')).toContainText('nada aqui existe ainda')
})

test('a prévia acompanha a proposta: editar um nome redesenha o escritório', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)

  await page.getByTestId('architect-item-edit-agent-gerente').click()
  await page.getByTestId('architect-edit-field-name').fill('Bruna')
  await page.getByTestId('architect-edit-save').click()

  await page.getByTestId('architect-tab-escritorio').click()
  // Sem recarregar nada: o desenho vem do blueprint que acabou de mudar.
  await expect(page.getByTestId('architect-office-description')).toContainText('Bruna')
})

test('agente fora de setor aparece na área comum', async ({ page }) => {
  const comSolto = {
    ...COM_PROPOSTA,
    blueprint: {
      ...BLUEPRINT,
      agents: [...BLUEPRINT.agents, { key: 'solto', name: 'Tereza', floorKey: 'atendimento', preset: 'operator' }],
    },
  }
  await stub(page, { project: comSolto })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-tab-escritorio').click()

  // Quem não está em setor é acionado à mão. Isso precisa ser visível ANTES de aplicar.
  await expect(page.getByTestId('architect-office-description')).toContainText('área comum')
  await expect(page.getByTestId('architect-office-description')).toContainText('Tereza')
})

test('com vários andares, dá para escolher qual olhar', async ({ page }) => {
  const doisAndares = {
    ...COM_PROPOSTA,
    blueprint: {
      ...BLUEPRINT,
      floors: [
        BLUEPRINT.floors[0],
        { key: 'mesa-analise', name: 'Mesa de Análise', workMode: 'organization' },
      ],
      agents: [...BLUEPRINT.agents, { key: 'bruno', name: 'Bruno', floorKey: 'mesa-analise', preset: 'analyst' }],
    },
  }
  await stub(page, { project: doisAndares })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-tab-escritorio').click()

  await expect(page.getByTestId('architect-office-totals')).toContainText('2 andares')
  await page.getByTestId('architect-office-floor-select').selectOption('mesa-analise')
  await expect(page.getByTestId('architect-office-description')).toContainText('Mesa de Análise')
  await expect(page.getByTestId('architect-office-description')).toContainText('Bruno')
})

test('a prévia é SÓ desenho: não pergunta nada ao servidor sobre ela', async ({ page }) => {
  const chamadas: string[] = []
  await stub(page, { project: COM_PROPOSTA })
  page.on('request', (r) => chamadas.push(r.url()))

  await page.goto(`/architect/${PROJETO_ID}`)
  // A régua começa com a PÁGINA já assentada: o prédio e a lista de andares da barra
  // lateral são carga normal da aplicação, e contá-los aqui mediria a coisa errada. O
  // que se afirma é sobre abrir a tela Escritório, não sobre a aplicação existir.
  await expect(page.getByTestId('architect-proposal')).toBeVisible()
  await page.waitForTimeout(800)
  const antes = chamadas.length

  await page.getByTestId('architect-tab-escritorio').click()
  await expect(page.getByTestId('architect-office-map')).toBeVisible()
  await page.waitForTimeout(2500) // a sondagem de estado ao vivo roda a cada 2s

  const depois = chamadas.slice(antes)
  // Não há execução de um agente que não existe: perguntar por ela seria inventar
  // trabalho para o servidor e prometer uma bolha que nunca vem.
  expect(depois.filter((u) => u.includes('/agent-states'))).toEqual([])
  // E nem a DESCOBERTA do andar acontece: o mapa desligado buscava `/api/floors` a cada
  // montagem para escolher um andar que ninguém ia consultar — e a prévia não tem andar
  // no banco para descobrir.
  expect(depois.filter((u) => /\/api\/floors(\?|$)/.test(u))).toEqual([])
})

test('no rascunho, os agentes não são botões nem param o teclado', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-tab-escritorio').click()
  const mapa = page.getByTestId('architect-office-map')
  await expect(mapa).toBeVisible()

  // Os agentes ESTÃO desenhados — é o que impede esta asserção de passar por um mapa
  // vazio, que é o jeito mais fácil de "não ter botão de agente".
  expect(await mapa.locator('[data-office-agent]').count()).toBeGreaterThan(0)

  // E nenhum deles é botão ou link: um botão que não faz nada é pior que nenhum botão,
  // porque para o Tab e promete um clique.
  await expect(mapa.locator('button[data-office-agent]')).toHaveCount(0)
  await expect(mapa.locator('a[data-office-agent]')).toHaveCount(0)
  // Os controles do MAPA continuam sendo botões — quem sai do caminho é só o agente.
  expect(await mapa.getByRole('button').count()).toBeGreaterThan(0)
  await expect(mapa.getByRole('button', { name: /Pausar a simulação/ })).toBeVisible()

  // E o Tab não para em cima de nenhum deles.
  await page.getByTestId('architect-tab-escritorio').focus()
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab')
    const emAgente = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.hasAttribute('data-office-agent') ?? false)
    expect(emAgente, `o Tab parou num agente na ${i + 1}ª parada`).toBe(false)
  }

  // E clicar em cima do desenho não navega: o id é temporário.
  await mapa.click({ position: { x: 60, y: 60 } })
  await page.waitForTimeout(300)
  expect(page.url()).toContain(`/architect/${PROJETO_ID}`)
})

test('o mapa da prévia é uma seção com nome e descrição — não uma figura com botões dentro', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-tab-escritorio').click()

  const mapa = page.getByTestId('architect-office-map')
  // `role="img"` sobre um contêiner com controles esconderia os controles de quem usa
  // leitor de tela: uma imagem não contém botões.
  await expect(mapa).not.toHaveAttribute('role', 'img')
  await expect(mapa).toHaveAttribute('aria-label', /Mapa do escritório/)
  const descrito = await mapa.getAttribute('aria-describedby')
  expect(descrito).toBeTruthy()
  await expect(page.locator(`#${descrito}`)).toContainText('Atendimento do Restaurante')
})

test('uma revisão não arrasta a pessoa para outra tela', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-tab-escritorio').click()
  await expect(page.getByTestId('architect-office-map')).toBeVisible()

  await page.getByTestId('architect-input').fill('troque o nome da Marina')
  await page.getByTestId('architect-send').click()
  await expect.poll(() => mensagensEnviadas).toContain('troque o nome da Marina')

  // Quem pediu a mudança está olhando o desenho: é ali que ela precisa aparecer.
  await expect(page.getByTestId('architect-office-map')).toBeVisible()
  await expect(page.getByTestId('architect-tab-escritorio')).toHaveAttribute('aria-selected', 'true')
})

// --- a rodada corretiva -----------------------------------------------------------------------------

test('a conversa começa sozinha: a descrição já recebe a primeira pergunta', async ({ page }) => {
  await stub(page, { messages: [{ id: 'm1', role: 'user', content: 'quero automatizar o atendimento', createdAt: NOW }] })
  await page.goto(`/architect/${PROJETO_ID}`)
  // Ninguém digitou nada, e a pergunta já está na tela.
  await expect(page.getByTestId('architect-question')).toBeVisible()
  await expect.poll(() => rodadasAutomaticas).toBe(1)
  await expect(page.getByTestId('architect-choice-web')).toBeVisible()
})

test('a rodada automática não repete quando a conversa já andou', async ({ page }) => {
  await stub(page, {
    project: COM_PROPOSTA,
    messages: [
      { id: 'm1', role: 'user', content: 'quero automatizar', createdAt: NOW },
      { id: 'm2', role: 'assistant', content: 'Por onde falam?', createdAt: NOW },
    ],
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-proposal')).toBeVisible()
  expect(rodadasAutomaticas).toBe(0)
})

test('só provedor configurado é oferecido', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-advanced').getByText('Avançado').click()
  const seletor = page.getByTestId('architect-provider-select')
  await expect(seletor).toBeVisible()
  await expect(seletor.locator('option')).toHaveCount(1)
  await expect(seletor.locator('option')).toHaveText(['Anthropic (Claude)'])
})

test('o seletor de modelo mostra o RÓTULO e envia o id', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-advanced').getByText('Avançado').click()

  // A tela não pode cair aqui: `models` são objetos, e renderizar o objeto derruba a
  // árvore inteira do React — foi exatamente o que aconteceu em produção.
  const modelo = page.getByTestId('architect-model-select')
  await expect(modelo).toBeVisible()
  await expect(modelo.locator('option')).toContainText(['Padrão', 'Claude Sonnet 5', 'Claude Haiku 4.5'])

  await modelo.selectOption('claude-haiku-4-5')
  await expect.poll(() => salvoNoProjeto?.model).toBe('claude-haiku-4-5')
})

test('sem provedor nenhum configurado, a tela manda para Configurações', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA, providers: PROVEDORES.map((p) => ({ ...p, configured: false })) })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-advanced').getByText('Avançado').click()
  await expect(page.getByTestId('architect-provider')).toContainText('Nenhum provedor configurado')
  await expect(page.getByTestId('architect-provider-select')).toHaveCount(0)
})

test('a escolha de recurso só oferece o que é desta conta, e manda ação e id', async ({ page }) => {
  await stub(page, {
    project: COM_PROPOSTA,
    targets: { floors: [{ id: 'f-real', name: 'Andar existente' }], agents: [], sectors: [], routines: [] },
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  const seletor = page.getByTestId('architect-link-floor-atendimento')
  await expect(seletor).toBeVisible()
  await seletor.selectOption('reuse|f-real')
  await page.getByTestId('architect-links-save').click()

  await expect.poll(() => ligacoes?.links).toEqual([{ kind: 'floor', key: 'atendimento', action: 'reuse', resourceId: 'f-real' }])
})

test('sem nada para reaproveitar, o bloco não existe — e com algo, ele aparece', async ({ page }) => {
  // Ele ocupava a primeira linha da tela inteira para dizer "esta conta não tem nada
  // para reaproveitar": a informação menos acionável possível, no lugar mais nobre.
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-proposal')).toBeVisible()
  await expect(page.getByTestId('architect-links-editor')).toHaveCount(0)
  await expect(page.getByTestId('architect-no-targets')).toHaveCount(0)

  // E quando há o que escolher, ele está lá — que é a parte que importa.
  await stub(page, {
    project: COM_PROPOSTA,
    targets: { floors: [{ id: 'f9', name: 'Outro andar' }], agents: [], sectors: [], routines: [] },
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-links-editor')).toBeVisible()
})

test('a proposta travada por reaproveitamento tem saída na tela', async ({ page }) => {
  // O caso real: itens marcados como "reaproveitar" numa conta sem nada para apontar.
  // A aplicação ficava bloqueada e não havia, na tela inteira, o que escolher.
  const travada = {
    ...COM_PROPOSTA,
    blueprint: {
      ...BLUEPRINT,
      floors: [{ ...BLUEPRINT.floors[0], action: 'reuse' }],
      agents: BLUEPRINT.agents.map((a) => ({ ...a, action: 'reuse' })),
    },
  }
  await stub(page, { project: travada, targets: { floors: [], agents: [], sectors: [], routines: [] } })
  await page.goto(`/architect/${PROJETO_ID}`)

  const bloco = page.getByTestId('architect-links-pending')
  await expect(bloco).toContainText('travando a aplicação')
  await page.getByTestId('architect-links-create-pending').click()

  // Um clique resolve os três: eles passam a ser criados.
  await expect.poll(() => ligacoes).toMatchObject({
    links: [
      { kind: 'floor', key: 'atendimento', action: 'create' },
      { kind: 'agent', key: 'gerente', action: 'create' },
      { kind: 'agent', key: 'duvidas', action: 'create' },
    ],
  })
})

test('o que foi marcado na confirmação é o que vai no pedido', async ({ page }) => {
  await stub(page, {
    project: COM_PROPOSTA,
    preview: {
      ...PREVIA,
      items: [
        ...PREVIA.items.map((i) => (i.kind === 'app' ? { ...i, action: 'reuse' } : i)),
        { kind: 'agent', key: 'antigo', label: 'Agente que já existia', action: 'update', detail: 'Ganha uma competência.', dependsOn: [], usesLlm: false, requiresApproval: true, issues: [] },
      ],
    },
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()
  await page.getByText('Alterar Agente: Agente que já existia').click()
  await page.getByTestId('architect-approve-apps').getByText('web_chat').click()
  await page.getByTestId('architect-apply-confirm').click()

  await expect.poll(() => aplicado?.approvedUpdateKeys).toEqual(['antigo'])
  expect(aplicado?.approvedAppKeys).toEqual(['web_chat'])
})

test('um projeto travado em “aplicando” oferece retomar', async ({ page }) => {
  await stub(page, { project: { ...COM_PROPOSTA, status: 'applying' } })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-applying')).toBeVisible()
  await page.getByTestId('architect-resume').click()
  await expect(page.getByTestId('architect-status').first()).toContainText('Aplicada')
})

test('a falha mostra o motivo e quantos recursos ficaram de pé', async ({ page }) => {
  await stub(page, { project: { ...COM_PROPOSTA, status: 'failed', applyState: { operationId: 'op-1', status: 'failed', error: 'o andar do agente não foi criado' } } })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-failed')).toContainText('continua de pé')
  await expect(page.getByTestId('architect-failure-reason')).toContainText('o andar do agente não foi criado')
})

test('depois de aplicar, os passos ficam visíveis em “Avançado”', async ({ page }) => {
  // Aplicar leva para a checklist; o "Avançado" vive na tela da proposta.
  // (o clique na aba entra logo antes de abrir o "Avançado", abaixo)
  await stub(page, {
    project: COM_PROPOSTA,
    apply: {
      json: {
        ...COM_PROPOSTA,
        status: 'applied',
        operation: {
          id: 'op-1',
          status: 'completed',
          error: null,
          steps: [
            { kind: 'floor', key: 'atendimento', status: 'created' },
            { kind: 'grant', key: 'canal', status: 'skipped', message: 'web_chat não está conectado: fica na checklist' },
          ],
        },
        links: [],
      },
    },
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()
  await page.getByTestId('architect-apply-confirm').click()
  await page.getByTestId('architect-tab-proposta').click()
  await page.getByTestId('architect-advanced').getByText('Avançado').click()
  await expect(page.getByTestId('architect-steps')).toContainText('floor: atendimento')
  await expect(page.getByTestId('architect-steps')).toContainText('não está conectado')
})

test('recarregar um projeto aplicado reconstrói os links', async ({ page }) => {
  await stub(page, {
    project: {
      ...COM_PROPOSTA,
      status: 'applied',
      links: [
        { kind: 'floor', key: 'atendimento', id: 'f1', path: '/floors/f1' },
        { kind: 'agent', key: 'gerente', id: 'a1', path: '/agents/a1' },
      ],
    },
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-links')).toBeVisible()
  await expect(page.getByTestId('architect-link-agent')).toHaveAttribute('href', '/agents/a1')
})

test('arquivar avisa que nada é removido, e exige confirmar', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-advanced').getByText('Avançado').click()
  await page.getByTestId('architect-archive').click()
  await expect(page.getByTestId('architect-confirm-archive')).toContainText('Nada do que ele criou é removido')
  await page.getByTestId('architect-archive-confirm').click()
  await expect(page.getByTestId('architect-status').first()).toContainText('Arquivada')
})

test('desfazer diz o impacto antes, e o que sobrou depois', async ({ page }) => {
  await stub(page, {
    project: { ...COM_PROPOSTA, status: 'applied' },
    apply: { json: { ...COM_PROPOSTA, status: 'applied', operation: { id: 'op-1', status: 'completed', error: null, steps: [{ kind: 'agent', key: 'gerente', status: 'created' }] }, links: [] } },
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-advanced').getByText('Avançado').click()
  await page.getByTestId('architect-rollback').click()
  await expect(page.getByTestId('architect-confirm-rollback')).toContainText('o que já existia e o que foi criado por outra')

  await page.getByTestId('architect-rollback-confirm').click()
  await expect(page.getByTestId('architect-rollback-result')).toContainText('2 removidos')
  await expect(page.getByTestId('architect-rollback-result')).toContainText('único andar do prédio')
})

// --- confirmação e aplicação -----------------------------------------------------------------------------

test('aplicar exige revisar antes, e manda o hash da proposta revisada', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()

  const dialogo = page.getByTestId('architect-apply-dialog')
  await expect(dialogo).toBeVisible()
  await expect(dialogo).toContainText('Vou criar 4 itens')
  await expect(dialogo).toContainText('2 dependem de você')

  await page.getByTestId('architect-apply-confirm').click()
  await expect.poll(() => aplicado?.blueprintHash).toBe(HASH)
  expect(aplicado?.confirm).toBe(true)
  expect(aplicado?.idempotencyKey).toBeTruthy()
})

test('dar acesso a um App é uma decisão à parte, e vem desmarcada', async ({ page }) => {
  await stub(page, {
    project: COM_PROPOSTA,
    preview: { ...PREVIA, items: PREVIA.items.map((i) => (i.kind === 'app' ? { ...i, action: 'reuse' } : i)) },
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()
  await expect(page.getByTestId('architect-approve-apps')).toContainText('Sem marcar, os agentes são criados sem acesso')

  await page.getByTestId('architect-apply-confirm').click()
  await expect.poll(() => aplicado?.approvedAppKeys).toEqual([])
})

test('uma mudança em algo que já existe exige aprovação individual', async ({ page }) => {
  await stub(page, {
    project: COM_PROPOSTA,
    preview: {
      ...PREVIA,
      items: [...PREVIA.items, { kind: 'agent', key: 'antigo', label: 'Agente que já existia', action: 'update', detail: 'Ganha uma competência.', dependsOn: [], usesLlm: false, requiresApproval: true, issues: [] }],
    },
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()
  await expect(page.getByTestId('architect-approve-updates')).toContainText('Agente que já existia')
  // Desmarcada, a confirmação não sai.
  await expect(page.getByTestId('architect-apply-confirm')).toBeDisabled()
  await page.getByText('Alterar Agente: Agente que já existia').click()
  await expect(page.getByTestId('architect-apply-confirm')).toBeEnabled()
})

test('depois de aplicar, os links levam ao que foi criado', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()
  await page.getByTestId('architect-apply-confirm').click()

  await expect(page.getByTestId('architect-links')).toBeVisible()
  await expect(page.getByTestId('architect-link-agent')).toHaveAttribute('href', '/agents/a1')
  await expect(page.getByTestId('architect-status').first()).toContainText('Aplicada')
})

test('uma confirmação sobre prévia velha é recusada com o motivo', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA, apply: { status: 409, json: { code: 'not_editable', message: 'a proposta mudou desde a última revisão; revise de novo antes de aplicar' } } })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()
  await page.getByTestId('architect-apply-confirm').click()
  await expect(page.getByTestId('architect-apply-error')).toContainText('revise de novo')
})

// --- falhas que a pessoa precisa entender ----------------------------------------------------------------------

test('sem chave de provedor, a tela manda para Configurações', async ({ page }) => {
  await stub(page, { turn: { status: 400, json: { code: 'no_provider_key', message: 'Configure a chave do provedor em Configurações para o Arquiteto poder trabalhar.' } } })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-input').fill('oi')
  await page.getByTestId('architect-send').click()
  await expect(page.getByTestId('architect-error')).toContainText('Configure a chave do provedor')
  await expect(page.getByTestId('architect-settings-link')).toHaveAttribute('href', '/settings')
})

test('limite de tokens atingido é dito com todas as letras', async ({ page }) => {
  await stub(page, { turn: { status: 429, json: { code: 'budget_exceeded', message: 'O limite mensal de tokens desta conta foi atingido.' } } })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-input').fill('oi')
  await page.getByTestId('architect-send').click()
  await expect(page.getByTestId('architect-error')).toContainText('limite mensal de tokens')
})

test('uma aplicação interrompida é retomável, e a tela diz que o feito continua de pé', async ({ page }) => {
  await stub(page, { project: { ...COM_PROPOSTA, status: 'failed' } })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-failed')).toContainText('continua de pé')
  await page.getByTestId('architect-resume').click()
  await expect(page.getByTestId('architect-status').first()).toContainText('Aplicada')
})

// --- checklist -----------------------------------------------------------------------------------------------------

test('obrigatório e opcional são contados separados, e “pronto” não mente', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-tab-checklist').click()
  await expect(page.getByTestId('architect-required-progress')).toHaveText('0/4')
  await expect(page.getByTestId('architect-ready')).toContainText('Ainda faltam pendências obrigatórias')
})

test('o item automático não tem botão de marcar; o manual tem', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-tab-checklist').click()
  await expect(page.getByTestId('architect-check-auto-app:canal')).toContainText('conferido pelo sistema')
  await expect(page.getByTestId('architect-check-toggle-app:canal')).toHaveCount(0)
  await expect(page.getByTestId('architect-check-toggle-test:conversa-de-teste')).toBeVisible()
})

test('a pendência leva direto ao lugar de resolver', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-tab-checklist').click()
  await expect(page.getByTestId('architect-check-link-app:canal')).toHaveAttribute('href', '/apps')
})

test('2) a pendência de conhecimento leva ao agente que vai receber o documento', async ({ page }) => {
  // Depois de aplicar: é quando o agente existe e tem tela. Antes, não há para onde ir.
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()
  await page.getByTestId('architect-apply-confirm').click()
  await page.getByTestId('architect-tab-checklist').click()

  // Sem isto, "Enviar o cardápio" ficava obrigatório e sem nenhum caminho.
  await expect(page.getByTestId('architect-check-link-knowledge:cardapio')).toHaveAttribute('href', '/agents/a1')
})

test('reconferir apura de novo contra o estado real', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-tab-checklist').click()
  await page.getByTestId('architect-recheck').click()
  await expect(page.getByTestId('architect-check-app:canal')).toContainText('Conectar web_chat')
  await expect(page.getByTestId('architect-check-auto-app:canal')).toBeVisible()
})

// --- navegação -------------------------------------------------------------------------------------------------------

/**
 * Onde fica a porta de entrada — agora em mais de um lugar, de propósito.
 *
 * O desenho anterior tirava o Arquiteto da barra lateral e o deixava SÓ dentro do menu de
 * andares. Isso o transformava num caminho que a pessoa precisava aprender: ela só o
 * encontrava se soubesse abrir aquele menu.
 *
 * Ele agora é uma entrada de primeira classe na navegação — "Montar e ajustar escritório",
 * porque as duas coisas moram ali — e continua no menu de andares para quem já conhece o
 * caminho. Duas portas para a mesma sala não é duplicação: é a sala deixar de estar
 * escondida.
 */
test('“Montar e ajustar escritório” tem entrada de primeira classe na navegação', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/architect')

  /**
   * A barra lateral é um TRILHO recolhido: os rótulos ficam clipados por `overflow-hidden`
   * até o ponteiro entrar. Existir nela já é ser de primeira classe; o rótulo aparece no
   * hover, que é o desenho da barra e não uma limitação deste teste.
   */
  const naBarraLateral = page.locator('aside').getByRole('link', { name: 'Montar e ajustar escritório' })
  await expect(naBarraLateral).toHaveCount(1)
  await page.locator('aside').hover()
  await expect(naBarraLateral).toBeVisible()

  // E o menu de andares NÃO oferece o mesmo caminho: ele voltou a ser só escolher andar.
  const menuDeAndares = page.getByTestId('building-switcher')
  if (await menuDeAndares.count()) {
    await menuDeAndares.first().click()
    await expect(page.getByTestId('open-architect')).toHaveCount(0)
  }
})

// --- celular -----------------------------------------------------------------------------------------------------------

test('no celular é uma coluna só, com a conversa ABAIXO do conteúdo', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto(`/architect/${PROJETO_ID}`)

  await expect(page.getByTestId('architect-tabs')).toBeVisible()
  await page.getByTestId('architect-tab-proposta').click()
  await expect(page.getByTestId('architect-counts')).toBeVisible()
  await page.getByTestId('architect-tab-checklist').click()
  await expect(page.getByTestId('architect-required-progress')).toBeVisible()

  // No telefone a conversa NÃO flutua por cima: ela é o último bloco da coluna. Uma
  // janela fixa numa tela de 390px cobriria o conteúdo que ela serve para ajustar.
  const painel = page.getByTestId('architect-chat-panel')
  await expect(painel).toBeVisible()
  expect(await painel.evaluate((el) => getComputedStyle(el).position)).toBe('static')
  const area = await page.getByTestId('architect-workspace').boundingBox()
  const chat = await painel.boundingBox()
  expect(chat!.y).toBeGreaterThan(area!.y)
  // E o botão de fechar é exclusivo do desktop: no telefone não há para onde recolher.
  await expect(page.getByTestId('architect-chat-collapse')).toBeHidden()
})

test('em 320 px nada estoura para os lados — nas quatro telas', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.setViewportSize({ width: 320, height: 720 })
  const folga = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

  for (const rota of ['/architect', `/architect/${PROJETO_ID}`]) {
    await page.goto(rota)
    await expect(page.getByTestId(rota === '/architect' ? 'architect-projects' : 'architect-conversation')).toBeVisible()
    expect(await folga(), `${rota} estourou`).toBeLessThanOrEqual(0)
  }

  // O mapa do escritório é a tela mais larga que existe aqui — e é a mais nova. Um
  // desenho de 400px numa viewport de 320 empurraria a página inteira para o lado.
  for (const aba of ['fluxo', 'escritorio', 'checklist', 'proposta'] as const) {
    await page.getByTestId(`architect-tab-${aba}`).click()
    await page.waitForTimeout(400)
    expect(await folga(), `a tela "${aba}" estourou`).toBeLessThanOrEqual(0)
  }
})

test('o campo de resposta fica alcançável com o teclado', async ({ page }) => {
  await stub(page)
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-input').focus()
  await page.keyboard.type('respondendo pelo teclado')
  await page.keyboard.press('Enter')
  await expect.poll(() => mensagensEnviadas).toContain('respondendo pelo teclado')
})

test('cada campo tem rótulo, e o erro é anunciado', async ({ page }) => {
  await stub(page, { turn: { status: 400, json: { code: 'no_provider_key', message: 'Configure a chave do provedor em Configurações.' } } })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByLabel('Sua resposta')).toBeVisible()
  await page.getByTestId('architect-input').fill('oi')
  await page.getByTestId('architect-send').click()
  await expect(page.getByRole('alert')).toBeVisible()
})

// --- o que entra no ar -------------------------------------------------------------------------
//
// Criar um monitor não é o mesmo que ligá-lo. Sem esta seção, o servidor exigia a autorização
// de ativação e a tela não tinha como dar — então nada nunca entrava no ar pelo produto.

const LIGAVEIS = [
  { kind: 'source', key: 'fonte', label: 'Cotações CXSE3', expectation: 'a fonte responde e traz o RSI' },
  { kind: 'monitor', key: 'rsi', label: 'RSI abaixo de 30', expectation: 'a regra dispara na transição' },
]

test('a lista do que entra no ar nasce VAZIA, e o pedido vai sem ativação nenhuma', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA, preview: { ...PREVIA, activatable: LIGAVEIS } })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()

  const secao = page.getByTestId('architect-approve-activation')
  await expect(secao).toBeVisible()
  // Cada linha diz o que o teste vai observar: "entra no ar" sem critério é um checkbox que
  // a pessoa marca sem saber o que está sendo provado.
  await expect(secao).toContainText('a fonte responde e traz o RSI')
  await expect(secao).toContainText('só entra no ar se passar no teste')

  await page.getByTestId('architect-apply-confirm').click()
  await expect.poll(() => aplicado?.approvedActivationKeys).toEqual([])
})

test('marcar uma fonte manda a key dela — e só ela', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA, preview: { ...PREVIA, activatable: LIGAVEIS } })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()
  // O `<label>` embrulha o input e o texto: clicar no texto marca a caixa, que é o que a
  // pessoa faz. `getByRole` com nome não resolve aqui porque o input é `sr-only`.
  await page.getByTestId('architect-approve-activation').getByText('Fonte: Cotações CXSE3').click()
  await page.getByTestId('architect-apply-confirm').click()

  await expect.poll(() => aplicado?.approvedActivationKeys).toEqual(['fonte'])
})

test('sem nada ativável, a seção não existe — nenhuma pergunta sem resposta possível', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA, preview: { ...PREVIA, activatable: [] } })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()
  await expect(page.getByTestId('architect-apply-dialog')).toBeVisible()
  await expect(page.getByTestId('architect-approve-activation')).toHaveCount(0)
})

test('a proposta mostra o que o V2 acrescenta, agrupado e com nome de produto', async ({ page }) => {
  const comV2 = {
    ...PREVIA,
    items: [
      ...PREVIA.items,
      { kind: 'database', key: 'base', label: 'Cotações', action: 'create', detail: 'Onde este dado fica guardado.', rationale: '', dependsOn: [], usesLlm: false, requiresApproval: false, issues: [] },
      { kind: 'source', key: 'fonte', label: 'Cotações CXSE3', action: 'create', detail: 'De onde o dado chega. Nasce parada: ativa só depois de testar.', rationale: '', dependsOn: [], usesLlm: false, requiresApproval: false, issues: [] },
      { kind: 'monitor', key: 'rsi', label: 'RSI abaixo de 30', action: 'create', detail: 'A regra que reconhece a transição. Nasce rascunho.', rationale: '', dependsOn: [], usesLlm: false, requiresApproval: false, issues: [] },
    ],
  }
  await stub(page, { project: COM_PROPOSTA, preview: comV2 })
  await page.goto(`/architect/${PROJETO_ID}`)

  const proposta = page.getByTestId('architect-proposal')
  // Os grupos têm o nome que a pessoa usa, não o do código.
  await expect(proposta).toContainText('Onde o dado fica')
  await expect(proposta).toContainText('De onde o dado vem')
  await expect(proposta).toContainText('O que fica de olho')
  await expect(proposta).toContainText('Cotações CXSE3')
  await expect(proposta).toContainText('ativa só depois de testar')
})

test('a entrega pede uma CONEXÃO na hora de aplicar, e o padrão é não escolher', async ({ page }) => {
  await stub(page, {
    project: COM_PROPOSTA,
    preview: { ...PREVIA, pendingDeliveries: [{ key: 'entrega', label: 'meu e-mail', hint: 'Sai quando o Flow rodar.' }] },
    targets: { floors: [], agents: [], sectors: [], routines: [], connections: [{ id: 'c1', name: 'Meu e-mail', provider: 'email' }] },
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()

  const secao = page.getByTestId('architect-delivery-connection')
  await expect(secao).toBeVisible()
  await expect(secao).toContainText('meu e-mail')
  // O padrão é NÃO escolher: uma entrega ligada por engano manda mensagem para alguém que
  // não pediu.
  await expect(page.getByTestId('architect-delivery-entrega')).toHaveValue('')

  await page.getByTestId('architect-apply-confirm').click()
  await expect.poll(() => aplicado?.deliveryConnections).toEqual([])
})

test('escolher a conexão manda a referência — nunca o endereço', async ({ page }) => {
  await stub(page, {
    project: COM_PROPOSTA,
    preview: { ...PREVIA, pendingDeliveries: [{ key: 'entrega', label: 'meu e-mail', hint: '' }] },
    targets: { floors: [], agents: [], sectors: [], routines: [], connections: [{ id: 'c1', name: 'Meu e-mail', provider: 'email' }] },
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()
  await page.getByTestId('architect-delivery-entrega').selectOption('c1')
  await page.getByTestId('architect-apply-confirm').click()

  await expect.poll(() => aplicado?.deliveryConnections).toEqual([{ key: 'entrega', connectionId: 'c1' }])
  // O que viaja é o ID de uma conexão da conta. Nenhum endereço no corpo do pedido.
  expect(/@|\+\d{6}/.test(JSON.stringify(aplicado))).toBe(false)
})

test('sem conexão nenhuma, a tela diz o que fazer em vez de oferecer um vazio mudo', async ({ page }) => {
  await stub(page, {
    project: COM_PROPOSTA,
    preview: { ...PREVIA, pendingDeliveries: [{ key: 'entrega', label: 'meu e-mail', hint: '' }] },
    targets: { floors: [], agents: [], sectors: [], routines: [], connections: [] },
  })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()
  await expect(page.getByTestId('architect-delivery-connection')).toContainText('ainda não tem uma conexão de envio')
})
