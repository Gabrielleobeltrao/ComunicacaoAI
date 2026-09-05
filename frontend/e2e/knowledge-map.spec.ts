import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// O MAPA DE CONHECIMENTO, no andar.
//
// A jornada: alternar entre Escritório e Conhecimento sem sair da página, ver o que cada
// agente alcança, abrir um documento pelo nó, editar e salvar. Mais os casos que separam
// um mapa honesto de um bonito: erro que não vira "vazio", "ver como agente" que REMOVE
// em vez de esconder, e o inspector que não confunde quem pode ler com quem leu.
const NOW = new Date(0).toISOString()
const FLOOR_ID = '000000000000000000000f11'
const MARINA = '000000000000000000000a11'
const RAFAEL = '000000000000000000000a22'
const DOC_MARINA = '000000000000000000000d11'
const DOC_ANDAR = '000000000000000000000d22'

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = { id: FLOOR_ID, buildingId: 'b1', name: 'Atendimento', mission: 'atender', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', workMode: 'organization', coordinatorAgentId: null, instruction: '', createdAt: NOW, updatedAt: NOW }

const NO = (id: string, kind: string, label: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind,
  label,
  position: null,
  ...extra,
})

const GRAFO_COMPLETO = {
  viewKey: `floor:${FLOOR_ID}`,
  documentTotal: 2,
  documentLimit: 200,
  truncated: false,
  nodes: [
    NO('building:b1', 'building', 'Prédio QA', { ownerType: 'building', ownerId: 'b1' }),
    NO(`floor:${FLOOR_ID}`, 'floor', 'Atendimento', { ownerType: 'floor', ownerId: FLOOR_ID }),
    NO('sector:s1', 'sector', 'Mesa', { ownerType: 'sector', ownerId: 's1', color: '#4466aa' }),
    NO(`agent:${MARINA}`, 'agent', 'Marina', { ownerType: 'agent', ownerId: MARINA, portraitKey: MARINA }),
    NO(`agent:${RAFAEL}`, 'agent', 'Rafael', { ownerType: 'agent', ownerId: RAFAEL, portraitKey: RAFAEL }),
    NO(`document:${DOC_MARINA}`, 'document', 'Política de troca', { ownerType: 'agent', ownerId: MARINA, indexStatus: 'indexed', source: 'manual', counts: { connections: 0, accessibleByAgents: 1 } }),
    NO(`document:${DOC_ANDAR}`, 'document', 'Aviso vencido', { ownerType: 'floor', ownerId: FLOOR_ID, indexStatus: 'error', source: 'manual', flags: ['expired'] }),
  ],
  edges: [
    { id: 'e1', source: 'building:b1', target: `floor:${FLOOR_ID}`, kind: 'contains' },
    { id: 'e2', source: `floor:${FLOOR_ID}`, target: 'sector:s1', kind: 'contains' },
    { id: 'e3', source: 'sector:s1', target: `agent:${MARINA}`, kind: 'contains' },
    { id: 'e4', source: `floor:${FLOOR_ID}`, target: `agent:${RAFAEL}`, kind: 'contains' },
    { id: 'e5', source: `agent:${MARINA}`, target: `document:${DOC_MARINA}`, kind: 'contains' },
    { id: 'e6', source: `floor:${FLOOR_ID}`, target: `document:${DOC_ANDAR}`, kind: 'contains' },
    { id: 'e7', source: `agent:${MARINA}`, target: `floor:${FLOOR_ID}`, kind: 'can_access' },
  ],
}

/** "Ver como Marina": o servidor REMOVE o que ela não alcança — aqui, o Rafael. */
const GRAFO_COMO_MARINA = {
  ...GRAFO_COMPLETO,
  documentTotal: 2,
  nodes: GRAFO_COMPLETO.nodes.filter((n) => n.id !== `agent:${RAFAEL}`),
  edges: GRAFO_COMPLETO.edges.filter((e) => !e.id.includes('e4')),
}

const DOCUMENTO = {
  id: DOC_MARINA,
  scopeType: 'agent',
  scopeId: MARINA,
  title: 'Política de troca',
  format: 'markdown',
  lifecycleStatus: 'approved',
  authority: 'official_policy',
  validFrom: null,
  validUntil: null,
  verifiedAt: null,
  verifiedBy: null,
  reviewIntervalDays: null,
  confidence: null,
  links: [{ target: 'Documento inexistente', resolvedDocumentId: null }],
  source: 'manual',
  sourceRef: null,
  indexStatus: 'indexed',
  indexError: null,
  chunkCount: 3,
  createdAt: NOW,
  updatedAt: NOW,
  content: 'A troca vale por **sete dias**.',
}

const IMPACTO = {
  documentId: DOC_MARINA,
  title: 'Política de troca',
  scopeType: 'agent',
  scopeId: MARINA,
  accessibleBy: [{ agentId: MARINA, name: 'Marina' }, { agentId: RAFAEL, name: 'Rafael' }],
  actuallyUsedBy: [{ executionId: 'exec-1', executionKind: 'playground', agentId: MARINA, at: NOW }],
  usedCount: 1,
  resolvedGaps: [],
  linkedFrom: [],
  proposals: [],
  openConflicts: [],
  recommendation: 'prefer_archive',
}

let layoutSalvo: { viewKey: string; positions: { nodeId: string; x: number; y: number }[] } | null = null
let salvo: Record<string, unknown> | null = null

async function stub(page: Page, opts: { graphStatus?: number } = {}) {
  layoutSalvo = null
  salvo = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))

  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  await page.route('**/api/executions**', (r) => r.fulfill({ json: [] }))
  await page.route(`**/api/floors/${FLOOR_ID}/activity`, (r) => r.fulfill({ json: { agentCount: 2, sectorCount: 1 } }))
  await page.route(`**/api/floors/${FLOOR_ID}/metrics**`, (r) =>
    r.fulfill({ json: { automationsActive: 0, runsToday: 0, running: 0, failures24h: 0, succeeded24h: 0, successRate: null, recentArtifacts: 0 } }),
  )
  await page.route(`**/api/floors/${FLOOR_ID}/agent-states**`, (r) => r.fulfill({ json: {} }))
  await page.route(`**/api/floors/${FLOOR_ID}`, (r) => r.fulfill({ json: FLOOR }))
  await page.route('**/api/agents**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agent-events**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/runs**', (r) => r.fulfill({ json: { items: [], total: 0 } }))
  await page.route('**/api/widgets**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agent-states**', (r) => r.fulfill({ json: {} }))
  await page.route('**/executions/analytics**', (r) =>
    r.fulfill({
      json: {
        scope: 'floor',
        period: '30d',
        telemetrySince: null,
        executions: 0,
        succeeded: 0,
        failed: 0,
        canceled: 0,
        running: 0,
        successRate: null,
        avgDurationMs: null,
        p95DurationMs: null,
        avgQueueMs: null,
        activeTimeMs: 0,
        totalTokens: 0,
      },
    }),
  )
  await page.route('**/executions/breakdown**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))

  await page.route('**/api/knowledge/graph?**', (r) => {
    if (opts.graphStatus && opts.graphStatus >= 400) return r.fulfill({ status: opts.graphStatus, json: { message: 'o mapa não pôde ser carregado' } })
    const url = new URL(r.request().url())
    const comoAgente = url.searchParams.get('viewAs')
    const busca = url.searchParams.get('q')
    let grafo = comoAgente ? GRAFO_COMO_MARINA : GRAFO_COMPLETO
    if (busca) {
      const docs = grafo.nodes.filter((n) => n.kind !== 'document' || n.label.toLowerCase().includes(busca.toLowerCase()))
      grafo = { ...grafo, nodes: docs }
    }
    if (layoutSalvo) {
      grafo = {
        ...grafo,
        nodes: grafo.nodes.map((n) => {
          const p = layoutSalvo!.positions.find((x) => x.nodeId === n.id)
          return p ? { ...n, position: { x: p.x, y: p.y } } : n
        }),
      }
    }
    return r.fulfill({ json: grafo })
  })
  await page.route('**/api/knowledge/graph/layout', (r) => {
    if (r.request().method() === 'PUT') {
      layoutSalvo = r.request().postDataJSON() as typeof layoutSalvo
      return r.fulfill({ json: { saved: layoutSalvo!.positions.length } })
    }
    layoutSalvo = null
    return r.fulfill({ json: { cleared: 1 } })
  })
  await page.route(`**/api/knowledge/documents/${DOC_MARINA}/impact`, (r) => r.fulfill({ json: IMPACTO }))
  await page.route(`**/api/knowledge/documents/${DOC_MARINA}`, (r) => {
    if (r.request().method() === 'PATCH') {
      salvo = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ json: { ...DOCUMENTO, ...salvo, chunkCount: 4 } })
    }
    return r.fulfill({ json: DOCUMENTO })
  })
  await page.route('**/api/knowledge/documents', (r) => {
    salvo = r.request().postDataJSON() as Record<string, unknown>
    return r.fulfill({ status: 201, json: { ...DOCUMENTO, ...salvo, id: 'novo' } })
  })
  await page.route('**/api/agents/*/knowledge-access/resolved', (r) =>
    r.fulfill({
      json: {
        policy: { own: true, building: false, floor: true, sectorMode: 'execution_context', selectedSectorIds: [], version: 1, configured: true },
        owners: [
          { ownerType: 'agent', ownerId: MARINA, reason: 'own', name: 'Marina' },
          { ownerType: 'floor', ownerId: FLOOR_ID, reason: 'floor', name: 'Atendimento' },
        ],
      },
    }),
  )
}

const abrirConhecimento = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}`)
  await page.getByTestId('floor-view-knowledge').click()
  await expect(page.getByTestId('knowledge-svg')).toBeVisible()
}

// --- alternar ---------------------------------------------------------------------------

test('o andar alterna entre Escritório e Conhecimento, e a URL guarda a escolha', async ({ page }) => {
  await stub(page)
  await page.goto(`/floors/${FLOOR_ID}`)
  await expect(page.getByTestId('floor-view-office')).toHaveAttribute('aria-selected', 'true')

  await page.getByTestId('floor-view-knowledge').click()
  await expect(page.getByTestId('knowledge-map')).toBeVisible()
  // Na URL: um link compartilhado precisa abrir na mesma visão.
  await expect(page).toHaveURL(/view=knowledge/)

  // E recarregar mantém.
  await page.reload()
  await expect(page.getByTestId('knowledge-map')).toBeVisible()

  await page.getByTestId('floor-view-office').click()
  await expect(page.getByTestId('knowledge-map')).toHaveCount(0)
  await expect(page).toHaveURL(/view=office/)
})

test('o mapa desenha os nós com a identidade de cada tipo', async ({ page }) => {
  await stub(page)
  await abrirConhecimento(page)

  // Setor com a cor real; agente com o retrato que o sistema já usa. A conferência é
  // sobre o círculo BASE, e não sobre "o primeiro círculo": o sombreamento da esfera
  // passa por cima dele, e a cor de identidade tem de continuar sendo a do setor.
  const setor = page.getByTestId('knode-sector:s1')
  await expect(setor.getByTestId('knode-base')).toHaveAttribute('fill', '#4466aa')
  await expect(setor.locator('text').first()).toHaveText('M')
  await expect(page.getByTestId(`knode-agent:${MARINA}`).locator('image')).toHaveCount(1)

  // O documento com erro de indexação e vencimento mostra os dois sinais, discretos —
  // sem substituir a identidade do nó. (O `<title>` do próprio nó também casa com o
  // nome, por isso a conferência é sobre o conjunto dos textos.)
  const vencido = page.getByTestId(`knode-document:${DOC_ANDAR}`)
  const sinais = await vencido.locator('title').allTextContents()
  expect(sinais).toContain('vencido')
  expect(sinais).toContain('erro ao indexar')
})

test('ACEITAÇÃO: o mapa tem profundidade — o que está atrás é desenhado menor e mais fraco', async ({ page }) => {
  await stub(page)
  await abrirConhecimento(page)

  const escalaDe = async (testId: string) => {
    const t = await page.getByTestId(testId).getAttribute('transform')
    return Number(/scale\(([\d.]+)\)/.exec(t ?? '')?.[1] ?? 0)
  }
  const opacidadeDe = (testId: string) => page.getByTestId(testId).getAttribute('opacity')

  const fundo = await escalaDe(`knode-floor:${FLOOR_ID}`)
  const frente = await escalaDe(`knode-document:${DOC_MARINA}`)
  expect(fundo).toBeGreaterThan(0)
  expect(fundo).toBeLessThan(frente)
  expect(Number(await opacidadeDe(`knode-floor:${FLOOR_ID}`))).toBeLessThan(Number(await opacidadeDe(`knode-document:${DOC_MARINA}`)))
})

test('a esfera tem luz, terminação e contato — e a cor de identidade continua por baixo', async ({ page }) => {
  await stub(page)
  await abrirConhecimento(page)
  const setor = page.getByTestId('knode-sector:s1')

  // A cor do setor está no círculo base; o volume vem por cima, sem cor própria.
  await expect(setor.getByTestId('knode-base')).toHaveAttribute('fill', '#4466aa')
  await expect(setor.locator('circle[fill="url(#k-lustre)"]')).toHaveCount(1)
  await expect(setor.locator('circle[fill="url(#k-terminacao)"]')).toHaveCount(1)
  await expect(setor.locator('ellipse[fill="url(#k-contato)"]')).toHaveCount(1)
})

test('AMEAÇA: o que está à FRENTE cobre o que está atrás, e não o contrário', async ({ page }) => {
  await stub(page)
  await abrirConhecimento(page)

  /**
   * A ordem do pintor. Se um documento sair por baixo do setor que está atrás dele, a
   * perspectiva se desmonta justamente no cruzamento — que é onde o olho procura a prova
   * de que existe profundidade.
   */
  const ordem = await page.evaluate(() => {
    const nos = [...document.querySelectorAll('[data-profundidade]')]
    return nos.map((n) => Number(n.getAttribute('data-profundidade')))
  })
  expect(ordem.length).toBeGreaterThan(1)
  expect([...ordem].sort((a, b) => a - b)).toEqual(ordem)
})

// --- ver como agente --------------------------------------------------------------------

test('"ver como agente" REMOVE o que ele não alcança', async ({ page }) => {
  await stub(page)
  await abrirConhecimento(page)
  await expect(page.getByTestId(`knode-agent:${RAFAEL}`)).toBeVisible()

  await page.getByTestId('knowledge-toggle-filters').click()
  await page.getByTestId('knowledge-view-as').selectOption(MARINA)
  // Removido do resultado, e não escondido por CSS: o nó não existe mais no documento.
  await expect(page.getByTestId(`knode-agent:${RAFAEL}`)).toHaveCount(0)
  await expect(page.getByTestId(`knode-agent:${MARINA}`)).toBeVisible()
})

test('a busca por título filtra os documentos', async ({ page }) => {
  await stub(page)
  await abrirConhecimento(page)
  await page.getByTestId('knowledge-toggle-filters').click()
  await page.getByTestId('knowledge-search').fill('Política')
  await expect(page.getByTestId(`knode-document:${DOC_MARINA}`)).toBeVisible()
  await expect(page.getByTestId(`knode-document:${DOC_ANDAR}`)).toHaveCount(0)
})

// --- inspector ---------------------------------------------------------------------------

test('o inspector separa quem PODE ler de quem LEU', async ({ page }) => {
  await stub(page)
  await abrirConhecimento(page)
  await page.getByTestId(`knode-document:${DOC_MARINA}`).click()

  const inspector = page.getByTestId('knowledge-inspector')
  await expect(inspector).toBeVisible()
  await expect(page.getByTestId('knowledge-accessible-by')).toContainText('Marina')
  await expect(page.getByTestId('knowledge-accessible-by')).toContainText('Rafael')
  // Os dois PODEM. Só uma execução USOU — e a diferença precisa estar escrita.
  await expect(page.getByTestId('knowledge-used-by')).toContainText('1 execução')
  // As conexões também como lista: para leitor de tela a linha do grafo não existe.
  await expect(page.getByTestId('knowledge-connections')).toBeVisible()
})

test('o inspector do agente mostra o que ele pode ler, e por quê', async ({ page }) => {
  await stub(page)
  await abrirConhecimento(page)
  await page.getByTestId(`knode-agent:${MARINA}`).click()
  const acesso = page.getByTestId('knowledge-agent-access')
  await expect(acesso).toContainText('base própria')
  await expect(acesso).toContainText('Atendimento')
})

// --- editor ------------------------------------------------------------------------------

test('abrir o documento pelo nó, editar o Markdown e salvar', async ({ page }) => {
  await stub(page)
  await abrirConhecimento(page)
  await page.getByTestId(`knode-document:${DOC_MARINA}`).click()
  await page.getByTestId('knowledge-open-editor').click()

  const editor = page.getByTestId('knowledge-editor')
  await expect(editor).toBeVisible()
  await expect(page.getByTestId('knowledge-editor-content')).toHaveValue(/sete dias/)

  // A prévia usa o renderizador seguro: o negrito vira <strong>, e não texto com asteriscos.
  await page.getByTestId('knowledge-editor-tab-previa').click()
  await expect(page.getByTestId('knowledge-editor-preview').locator('strong')).toHaveText('sete dias')

  await page.getByTestId('knowledge-editor-tab-escrever').click()
  await page.getByTestId('knowledge-editor-content').fill('A troca vale por **trinta dias**.')
  await page.getByTestId('knowledge-editor-save').click()
  await expect.poll(() => (salvo as { content?: string } | null)?.content).toBe('A troca vale por **trinta dias**.')
  // O estado de indexação aparece depois de salvar.
  await expect(page.getByTestId('knowledge-editor-state')).toContainText('trecho')
})

test('a ligação não resolvida aparece como pendência, sem inventar destino', async ({ page }) => {
  await stub(page)
  await abrirConhecimento(page)
  await page.getByTestId(`knode-document:${DOC_MARINA}`).click()
  await page.getByTestId('knowledge-open-editor').click()
  await expect(page.getByTestId('knowledge-editor')).toContainText('não encontrado nesta base')
})

// --- layout ---------------------------------------------------------------------------------

test('arrastar um nó guarda a posição, e ela volta ao recarregar', async ({ page }) => {
  await stub(page)
  await abrirConhecimento(page)
  const no = page.getByTestId(`knode-agent:${MARINA}`)
  const antes = await no.boundingBox()
  await no.hover()
  await page.mouse.down()
  await page.mouse.move((antes?.x ?? 0) + 120, (antes?.y ?? 0) + 60, { steps: 6 })
  await page.mouse.up()

  await expect.poll(() => layoutSalvo?.positions?.length ?? 0, { timeout: 5000 }).toBeGreaterThan(0)
  await page.reload()
  await expect(page.getByTestId('knowledge-svg')).toBeVisible()
  const depois = await page.getByTestId(`knode-agent:${MARINA}`).boundingBox()
  expect(Math.abs((depois?.x ?? 0) - (antes?.x ?? 0)) + Math.abs((depois?.y ?? 0) - (antes?.y ?? 0))).toBeGreaterThan(10)
})

// --- estados ----------------------------------------------------------------------------------

test('erro de API NÃO vira mapa vazio', async ({ page }) => {
  await stub(page, { graphStatus: 500 })
  await page.goto(`/floors/${FLOOR_ID}?view=knowledge`)
  const erro = page.getByTestId('knowledge-error')
  await expect(erro).toBeVisible()
  await expect(page.getByTestId('knowledge-empty')).toHaveCount(0)
  await expect(erro).toContainText('Tentar de novo')
})

// --- acessibilidade e telas pequenas -----------------------------------------------------------

test('os nós são alcançáveis por teclado e anunciam tipo e nome', async ({ page }) => {
  await stub(page)
  await abrirConhecimento(page)
  const no = page.getByTestId(`knode-document:${DOC_MARINA}`)
  await expect(no).toHaveAttribute('aria-label', /Documento: Política de troca/)
  await no.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('knowledge-inspector')).toBeVisible()
})

test('em 320 px nada estoura para os lados', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await stub(page)
  await abrirConhecimento(page)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  // E o inspector abre sem quebrar a navegação.
  await page.getByTestId(`knode-document:${DOC_MARINA}`).click()
  await expect(page.getByTestId('knowledge-inspector')).toBeVisible()
  const depois = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(depois).toBeLessThanOrEqual(1)
})
