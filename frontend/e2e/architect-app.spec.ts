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
    { key: 'gerente', name: 'Gerente de atendimento', floorKey: 'atendimento', objective: 'Distribuir a conversa para quem sabe responder.', instructions: 'Nunca prometa prazo.' },
    { key: 'duvidas', name: 'Atendente de dúvidas', floorKey: 'atendimento', objective: 'Responder horários, endereço e cardápio.', instructions: '' },
  ],
  sectors: [{ key: 'setor', name: 'Atendimento', mode: 'orchestrated', memberAgentKeys: ['gerente', 'duvidas'], coordinatorAgentKey: 'gerente' }],
  routines: [],
  appRequirements: [{ key: 'canal', appKey: 'web_chat', reason: 'Receber as conversas do site.', required: true }],
  knowledgeRequirements: [{ key: 'cardapio', title: 'Enviar o cardápio com preços', description: 'Sem ele, o agente não responde preço.', required: true, state: 'missing' }],
  assumptions: [{ key: 'horario', text: 'Assumi atendimento em horário comercial.' }],
  warnings: [],
}

const CHECKLIST = [
  { id: 'structure:floor-atendimento', category: 'structure', title: 'Andar “Atendimento do Restaurante”', description: 'Será criado.', required: true, status: 'ready', completionMode: 'resource_state', target: { kind: 'floor', key: 'atendimento' }, dependsOn: [] },
  { id: 'structure:agent-gerente', category: 'structure', title: 'Agente “Gerente de atendimento”', description: 'Recebe a conversa.', required: true, status: 'blocked', completionMode: 'resource_state', target: { kind: 'agent', key: 'gerente' }, dependsOn: ['structure:floor-atendimento'] },
  { id: 'knowledge:cardapio', category: 'knowledge', title: 'Enviar o cardápio com preços', description: 'Sem ele, o agente não responde preço.', required: true, status: 'ready', completionMode: 'resource_state', target: { kind: 'knowledge', key: 'cardapio' }, linkTarget: { kind: 'agent', key: 'gerente' }, dependsOn: [] },
  { id: 'app:canal', category: 'app', title: 'Conectar web_chat', description: 'Receber as conversas do site.', required: true, status: 'ready', completionMode: 'connection_state', target: { kind: 'app', key: 'web_chat' }, actionPath: '/apps', dependsOn: [] },
  { id: 'test:conversa-de-teste', category: 'test', title: 'Testar a operação com uma conversa real', description: 'Converse com o agente de entrada.', required: true, status: 'blocked', completionMode: 'manual', dependsOn: ['structure:floor-atendimento'] },
]

const READINESS = { requiredDone: 0, requiredTotal: 4, optionalDone: 0, optionalTotal: 0, ready: false, blockers: [] }

const PREVIA = {
  blueprintHash: HASH,
  valid: true,
  issues: [{ path: 'appRequirements[0]', code: 'app_not_connected', message: 'web_chat ainda não está conectado nesta conta', severity: 'warning', suggestedAction: 'conecte o App' }],
  items: [
    { kind: 'floor', key: 'atendimento', label: 'Atendimento do Restaurante', action: 'create', detail: 'Andar novo.', rationale: 'Onde a operação de atendimento mora.', dependsOn: [], usesLlm: false, requiresApproval: false, issues: [] },
    { kind: 'agent', key: 'gerente', label: 'Gerente de atendimento', action: 'create', detail: 'Agente novo.', rationale: 'Recebe a conversa e decide quem responde.', dependsOn: ['floor:atendimento'], usesLlm: false, requiresApproval: false, issues: [] },
    { kind: 'agent', key: 'duvidas', label: 'Atendente de dúvidas', action: 'create', detail: 'Agente novo.', rationale: 'Responde o que mais perguntam.', dependsOn: ['floor:atendimento'], usesLlm: false, requiresApproval: false, issues: [] },
    { kind: 'sector', key: 'setor', label: 'Atendimento', action: 'create', detail: 'Setor no modo orchestrated.', rationale: 'Uma porta de entrada só.', dependsOn: [], usesLlm: false, requiresApproval: false, issues: [] },
    { kind: 'app', key: 'canal', label: 'web_chat', action: 'wait_user', detail: 'Receber as conversas do site. Conecte o App para os agentes poderem usá-lo.', rationale: '', dependsOn: [], usesLlm: false, requiresApproval: false, issues: [] },
    { kind: 'knowledge', key: 'cardapio', label: 'Enviar o cardápio com preços', action: 'wait_user', detail: 'Fica pendente até você enviar o conteúdo. Nada é inventado.', rationale: 'Sem ele, o agente não responde preço.', dependsOn: [], usesLlm: false, requiresApproval: false, issues: [] },
  ],
  checklist: CHECKLIST,
  readiness: READINESS,
  counts: { create: 4, reuse: 0, update: 0, waitUser: 2 },
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

const COM_PROPOSTA = projeto({ status: 'draft', hasBlueprint: true, blueprint: BLUEPRINT, blueprintHash: HASH, checklist: CHECKLIST, assumptions: BLUEPRINT.assumptions })

let aplicado: Record<string, unknown> | null = null
let mensagensEnviadas: string[] = []
/** Quais conversas o servidor recebeu ordem de apagar. */
let apagados: string[] = []
let ligacoes: Record<string, unknown> | null = null
let salvoNoProjeto: Record<string, unknown> | null = null
let rodadasAutomaticas = 0
/** O que a tela mandou corrigir na proposta — e a prévia que o servidor devolveria depois. */
let edicoesEnviadas: { kind: string; key: string; fields?: Record<string, string>; remove?: boolean }[] = []
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
    return r.fulfill({ json: { ...COM_PROPOSTA, changes: mudancas } })
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
  await expect(page.getByTestId('architect-item-agent-gerente')).toContainText('Gerente de atendimento')
  await expect(page.getByTestId('architect-item-knowledge-cardapio')).toContainText('Nada é inventado')
  await expect(page.getByTestId('architect-item-app-canal')).toContainText('Depende de você')
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
  await expect(bloco.getByTestId('architect-edit-field-name')).toHaveValue('Gerente de atendimento')
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
  await expect(page.getByTestId('architect-item-agent-duvidas')).toContainText('Atendente de dúvidas')
})

test('proposta já aplicada não se edita na tela', async ({ page }) => {
  await stub(page, { project: { ...COM_PROPOSTA, status: 'applied', appliedAt: NOW } })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-item-agent-gerente')).toBeVisible()
  await expect(page.getByTestId('architect-item-edit-agent-gerente')).toHaveCount(0)
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

test('sem nada para reaproveitar, a tela diz isso em vez de um seletor vazio', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-no-targets')).toBeVisible()
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
  await expect(page.getByTestId('architect-required-progress')).toHaveText('0/4')
  await expect(page.getByTestId('architect-ready')).toContainText('Ainda faltam pendências obrigatórias')
})

test('o item automático não tem botão de marcar; o manual tem', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-check-auto-app:canal')).toContainText('conferido pelo sistema')
  await expect(page.getByTestId('architect-check-toggle-app:canal')).toHaveCount(0)
  await expect(page.getByTestId('architect-check-toggle-test:conversa-de-teste')).toBeVisible()
})

test('a pendência leva direto ao lugar de resolver', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await expect(page.getByTestId('architect-check-link-app:canal')).toHaveAttribute('href', '/apps')
})

test('2) a pendência de conhecimento leva ao agente que vai receber o documento', async ({ page }) => {
  // Depois de aplicar: é quando o agente existe e tem tela. Antes, não há para onde ir.
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-apply').click()
  await page.getByTestId('architect-apply-confirm').click()

  // Sem isto, "Enviar o cardápio" ficava obrigatório e sem nenhum caminho.
  await expect(page.getByTestId('architect-check-link-knowledge:cardapio')).toHaveAttribute('href', '/agents/a1')
})

test('reconferir apura de novo contra o estado real', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.goto(`/architect/${PROJETO_ID}`)
  await page.getByTestId('architect-recheck').click()
  await expect(page.getByTestId('architect-check-app:canal')).toContainText('Conectar web_chat')
  await expect(page.getByTestId('architect-check-auto-app:canal')).toBeVisible()
})

// --- navegação -------------------------------------------------------------------------------------------------------

/**
 * Onde fica a porta de entrada — e ela depende do modo de navegação.
 *
 * Com o prédio ligado, "Montar operação" mora no menu de ANDARES, logo abaixo de criar
 * um à mão: é lá que ela pertence, porque é isso que ela faz. Sem o prédio não existe
 * menu de andares, e ela continua sendo uma linha da barra lateral — tirá-la ali
 * deixaria a tela sem caminho nenhum.
 *
 * O teste confere o modo do build em que está rodando em vez de presumir um: o `dist`
 * do CI não tem `.env` e sobe em V1, e o de quem desenvolve sobe em V2.
 */
test('“Montar operação” tem entrada no menu, no modo que o build usa', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/architect')

  const menuDeAndares = page.getByTestId('building-switcher')
  const naBarraLateral = page.locator('aside').getByRole('link', { name: 'Montar operação' })
  // Esperar a barra lateral existir ANTES de decidir o modo. Contar logo depois do
  // `goto` lia a tela antes de ela montar: dava zero nos dois, o teste caía no ramo V1
  // e falhava de vez em quando por tempo, não por comportamento.
  await expect.poll(async () => (await menuDeAndares.count()) + (await naBarraLateral.count())).toBeGreaterThan(0)
  if (await menuDeAndares.count()) {
    await menuDeAndares.first().click()
    await expect(page.getByTestId('open-architect')).toBeVisible()
    // E não está mais duplicada na barra lateral.
    await expect(naBarraLateral).toHaveCount(0)
  } else {
    await expect(naBarraLateral).toBeVisible()
  }
})

// --- celular -----------------------------------------------------------------------------------------------------------

test('no celular, conversa, proposta e checklist são abas de uma coluna só', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto(`/architect/${PROJETO_ID}`)

  await expect(page.getByTestId('architect-tabs')).toBeVisible()
  await expect(page.getByTestId('architect-conversation')).toBeVisible()

  await page.getByTestId('architect-tab-proposta').click()
  await expect(page.getByTestId('architect-counts')).toBeVisible()

  await page.getByTestId('architect-tab-checklist').click()
  await expect(page.getByTestId('architect-required-progress')).toBeVisible()
})

test('em 320 px nada estoura para os lados', async ({ page }) => {
  await stub(page, { project: COM_PROPOSTA })
  await page.setViewportSize({ width: 320, height: 720 })
  for (const rota of ['/architect', `/architect/${PROJETO_ID}`]) {
    await page.goto(rota)
    await expect(page.getByTestId(rota === '/architect' ? 'architect-projects' : 'architect-conversation')).toBeVisible()
    const folga = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(folga, `${rota} estourou ${folga}px`).toBeLessThanOrEqual(0)
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
