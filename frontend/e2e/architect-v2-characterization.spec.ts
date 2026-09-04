import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// LACUNA 12 CORRIGIDA — o Arquiteto passou a ser um chat global.
//
// Estes casos eram de caracterização: eles travavam a ausência do chat. Agora afirmam a
// presença dele, e é nesta linha que a correção fica visível no histórico.
const NOW = new Date(0).toISOString()

let enviado: unknown = null

async function stub(page: Page, opts: { turno?: unknown } = {}) {
  enviado = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  // O curinga vem PRIMEIRO, e a sessão depois.
  //
  // No Playwright a rota registrada por último ganha. Com o curinga de API registrado antes da
  // rota de sessão, a sessão respondia `[]` — um array, que é verdadeiro em JS. As telas abriam
  // (o `ProtectedRoute` só testa se há algo) e qualquer leitura de `user` saía `undefined`.
  // Um stub que mente assim faz o teste medir outra coisa.
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/building', (r) =>
    r.fulfill({ json: { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW } }),
  )
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/floors**', (r) =>
    r.fulfill({ json: [{ id: '000000000000000000000f11', name: 'Atendimento', status: 'active', buildingId: 'b1', workMode: 'organization', createdAt: NOW, updatedAt: NOW }] }),
  )
  await page.route('**/api/architect/assistant/turn', (r) => {
    enviado = r.request().postDataJSON()
    return r.fulfill({
      json:
        opts.turno ?? {
          intent: { mode: 'answer', query: 'x', freshness: 'static' },
          phase: 'done',
          text: 'entendi',
          question: null,
          projectId: null,
          context: { pathname: '/', rejected: [] },
        },
    })
  })
}

test('CORRIGIDA: o botão do Arquiteto existe em toda rota autenticada', async ({ page }) => {
  await stub(page)
  for (const rota of ['/dashboard', '/apps', '/agents']) {
    await page.goto(rota)
    await expect(page.getByTestId('architect-launcher'), `sumiu em ${rota}`).toBeVisible()
  }
})

test('CORRIGIDA: abrir, escrever e NAVEGAR — o rascunho sobrevive', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('adicione reservas pelo WhatsApp')

  // A navegação DE APP é o teste: `page.goto` recarregaria tudo, e nenhum chat sobrevive a
  // um reload sem persistência. O que o plano pede é sobreviver à troca de rota.
  await page.getByRole('link', { name: 'Apps' }).first().click()
  await expect(page).toHaveURL(/\/apps/)
  await expect(page.getByTestId('architect-panel')).toBeVisible()
  await expect(page.getByTestId('architect-input')).toHaveValue('adicione reservas pelo WhatsApp')
})

test('minimizar guarda a conversa; fechar e reabrir também', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('um rascunho')

  await page.getByTestId('architect-minimize').click()
  await expect(page.getByTestId('architect-input')).toHaveCount(0)
  await page.getByTestId('architect-minimize').click()
  await expect(page.getByTestId('architect-input')).toHaveValue('um rascunho')

  await page.getByTestId('architect-close').click()
  await expect(page.getByTestId('architect-panel')).toHaveCount(0)
  await page.getByTestId('architect-launcher').click()
  await expect(page.getByTestId('architect-input')).toHaveValue('um rascunho')
})

test('o botão some enquanto o painel está aberto — dois alvos para a mesma coisa confundem', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await expect(page.getByTestId('architect-launcher')).toHaveCount(0)
  await page.getByTestId('architect-minimize').click()
  // Minimizado, o painel vira uma barra: o botão volta a fazer sentido.
  await expect(page.getByTestId('architect-launcher')).toBeVisible()
})

test('uma PERGUNTA não cria projeto, e a resposta diz por que não deu', async ({ page }) => {
  await stub(page, {
    turno: {
      intent: { mode: 'answer', query: 'valor do dólar', freshness: 'current' },
      phase: 'failed',
      text: 'não tenho uma fonte conectada para "valor do dólar" agora. Conecte um App ou uma fonte de dados que traga esse número, e eu respondo com a origem e o horário.',
      question: null,
      projectId: null,
      context: { pathname: '/dashboard', rejected: [] },
    },
  })
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('Qual o valor do dólar hoje?')
  await page.getByTestId('architect-enviar').click()

  await expect(page.getByTestId('architect-msg-arquiteto')).toContainText('Conecte um App ou uma fonte')
  await expect(page.getByTestId('architect-abrir-projeto')).toHaveCount(0)
})

test('uma PROPOSTA oferece abrir o projeto, e o estado é dito em português', async ({ page }) => {
  await stub(page, {
    turno: {
      intent: { mode: 'propose', changeKind: 'expand', objective: 'reservas' },
      phase: 'preparing_proposal',
      text: 'Vou montar isso. Comecei um projeto — nada é aplicado sem a sua aprovação.',
      question: null,
      projectId: '000000000000000000000abc',
      context: { pathname: '/dashboard', rejected: [] },
    },
  })
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('adicione reservas ao meu restaurante')
  await page.getByTestId('architect-enviar').click()

  await expect(page.getByTestId('architect-msg-arquiteto')).toContainText('nada é aplicado sem a sua aprovação')
  await expect(page.getByTestId('architect-abrir-projeto')).toBeVisible()
  await expect(page.getByTestId('architect-phase')).toHaveText('preparando a proposta')
})

test('o contexto da tela vai como REFERÊNCIA — nunca o conteúdo dela', async ({ page }) => {
  await stub(page)
  await page.goto('/floors/000000000000000000000f11')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('o que é isto?')
  await page.getByTestId('architect-enviar').click()

  await expect.poll(() => enviado).not.toBeNull()
  expect(enviado).toMatchObject({ uiContext: { pathname: '/floors/000000000000000000000f11', floorId: '000000000000000000000f11' } })
  // Nada do CONTEÚDO da tela viaja: só os ids que a URL já carrega.
  expect(Object.keys((enviado as { uiContext: object }).uiContext).sort()).toEqual(['floorId', 'pathname'])
})

test('teclado: Enter envia, Shift+Enter quebra linha, Esc fecha', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()

  const campo = page.getByTestId('architect-input')
  await campo.fill('primeira linha')
  await campo.press('Shift+Enter')
  await campo.type('segunda linha')
  await expect(campo).toHaveValue('primeira linha\nsegunda linha')

  await campo.press('Enter')
  await expect(page.getByTestId('architect-msg-pessoa')).toContainText('primeira linha')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('architect-panel')).toHaveCount(0)
})

test('em 320 px o painel ocupa a tela e não empurra a página', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await expect(page.getByTestId('architect-panel')).toBeVisible()
  const largura = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(largura).toBeLessThanOrEqual(321)
})

test('o alvo de toque do botão alcança o mínimo', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  const caixa = await page.getByTestId('architect-launcher').boundingBox()
  expect(caixa!.height).toBeGreaterThanOrEqual(44)
})

test('o botão fica NO CANTO — e não flutuando no meio do nada', async ({ page }) => {
  /**
   * Ele ficou 76 px acima da base por causa de uma barra de navegação inferior no celular que
   * não existe mais: o menu virou gaveta. A folga sobreviveu ao motivo dela, e o resultado era
   * um botão longe do canto onde a mão o procura.
   *
   * O teto aqui é folgado de propósito — ele guarda "está no canto", não um número exato.
   */
  await stub(page)
  for (const [largura, altura] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width: largura, height: altura })
    await page.goto('/dashboard')
    const caixa = await page.getByTestId('architect-launcher').boundingBox()
    const daBase = altura - (caixa!.y + caixa!.height)
    expect(daBase, `em ${largura}px o botão está a ${Math.round(daBase)}px da base`).toBeLessThanOrEqual(40)
    expect(daBase, 'encostado na borda também é errado: ele precisa respirar').toBeGreaterThanOrEqual(8)
  }
})

test('na página de um PROJETO o chat global se retira — uma conversa por tela', async ({ page }) => {
  await stub(page)
  await page.route('**/api/architect/projects/*', (r) =>
    r.fulfill({
      json: {
        id: '000000000000000000000abc',
        title: 'Reservas',
        objective: 'x',
        status: 'discovery',
        locale: 'pt',
        answers: {},
        assumptions: [],
        blueprint: null,
        checklist: [],
        readiness: { requiredDone: 0, requiredTotal: 0, optionalDone: 0, optionalTotal: 0, ready: false, blockers: [] },
        createdAt: NOW,
        updatedAt: NOW,
      },
    }),
  )
  await page.goto('/architect/000000000000000000000abc')

  // Ali existe a conversa DO PROJETO: duas caixas na mesma tela é a pessoa escrevendo na
  // errada e não entendendo por que a outra não respondeu.
  await expect(page.getByTestId('architect-launcher')).toHaveCount(0)
  await expect(page.getByTestId('architect-panel')).toHaveCount(0)
})

// --- quem não enxerga a tela ---------------------------------------------------------------
//
// O chat global é a porta principal do produto. Uma porta que só funciona para quem vê a cor
// e usa o mouse não é a porta principal de ninguém.

test('o leitor de tela sabe o que é o botão e o que é o painel', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')

  const botao = page.getByTestId('architect-launcher')
  // Um botão só com ícone é um botão mudo: sem nome acessível, o leitor anuncia "botão".
  const nome = (await botao.getAttribute('aria-label')) ?? (await botao.innerText())
  expect(nome.trim().length, 'o lançador precisa de um nome acessível').toBeGreaterThan(3)

  await botao.click()
  const painel = page.getByTestId('architect-panel')
  await expect(painel).toBeVisible()
  await expect(painel).toHaveAttribute('role', 'dialog')
  const rotulo = (await painel.getAttribute('aria-label')) ?? (await painel.getAttribute('aria-labelledby'))
  expect(rotulo, 'um diálogo sem rótulo é anunciado como "diálogo"').toBeTruthy()
})

test('o foco vai para o campo ao abrir, e a resposta é anunciada', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()

  // Abrir e ter que caçar o campo com Tab é o que faz alguém desistir da porta principal.
  await expect(page.getByTestId('architect-input')).toBeFocused()

  await page.getByTestId('architect-input').fill('qual o valor do dólar hoje?')
  await page.getByTestId('architect-input').press('Enter')
  await expect(page.getByTestId('architect-mensagens')).toContainText('entendi')

  // A resposta chega sem mudar de página: sem região viva, quem usa leitor de tela não
  // recebe aviso nenhum de que ela chegou.
  const viva = page.locator('[data-testid="architect-mensagens"][aria-live], [data-testid="architect-mensagens"] [aria-live]')
  await expect(viva.first()).toHaveCount(1)
})


test('o texto de ERRO do painel é legível — o token de perigo não pinta texto', async ({ page }) => {
  await stub(page)
  // A rodada falha no transporte: é este caminho que pinta a linha vermelha.
  await page.route('**/api/architect/assistant/turn', (r) => r.fulfill({ status: 500, json: { message: 'deu ruim' } }))
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('qualquer coisa')
  await page.getByTestId('architect-input').press('Enter')
  await expect(page.getByTestId('architect-erro')).toBeVisible()

  const razao = await page.evaluate(() => {
    const alvo = document.querySelector('[data-testid="architect-erro"]') as HTMLElement
    const lum = (p: number[]) => {
      const c = p.slice(0, 3).map((v) => {
        const x = v / 255
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    let fundo: number[] | null = null
    for (let el: HTMLElement | null = alvo; el; el = el.parentElement) {
      const partes = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number)
      if (partes.length >= 3 && (partes.length < 4 || partes[3] > 0)) {
        fundo = partes
        break
      }
    }
    const a = lum((getComputedStyle(alvo).color.match(/[\d.]+/g) ?? []).map(Number)) + 0.05
    const b = lum(fundo ?? [255, 255, 255]) + 0.05
    return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100
  })
  // `--intent-danger` é uma cor de preenchimento: 2,81:1 como texto. O token de texto dá 5,98.
  expect(razao, 'o vermelho de preenchimento não pode virar cor de texto').toBeGreaterThanOrEqual(4.5)
})

test('o texto do painel alcança o contraste mínimo, inclusive o de erro', async ({ page }) => {
  await stub(page, {
    turno: {
      intent: { mode: 'answer', query: 'dólar', freshness: 'current' },
      phase: 'failed',
      text: 'não tenho uma fonte conectada para "dólar" agora. Conecte um App ou uma fonte de dados que traga esse número.',
      question: null,
      projectId: null,
      context: { pathname: '/', rejected: [] },
    },
  })
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('qual o valor do dólar hoje?')
  await page.getByTestId('architect-input').press('Enter')
  await expect(page.getByTestId('architect-mensagens')).toContainText('fonte conectada')

  // A razão WCAG é calculada das cores COMPUTADAS, subindo até o primeiro ancestral que
  // pinta o fundo de verdade — um fundo transparente herda o de trás, e medir contra ele
  // daria um número que a tela não tem.
  const razao = await page.evaluate(() => {
    const alvo = document.querySelector('[data-testid="architect-mensagens"]') as HTMLElement
    const ultimo = (alvo.querySelectorAll('p, div, span')[alvo.querySelectorAll('p, div, span').length - 1] as HTMLElement) ?? alvo
    const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const lum = ([r, g, b]: number[]) => {
      const c = [r, g, b].map((v) => {
        const x = v / 255
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    let fundo: number[] | null = null
    for (let el: HTMLElement | null = ultimo; el; el = el.parentElement) {
      const cor = getComputedStyle(el).backgroundColor
      const partes = (cor.match(/[\d.]+/g) ?? []).map(Number)
      if (partes.length >= 3 && (partes.length < 4 || partes[3] > 0)) {
        fundo = partes.slice(0, 3)
        break
      }
    }
    const texto = rgb(getComputedStyle(ultimo).color)
    const a = lum(texto) + 0.05
    const b = lum(fundo ?? [255, 255, 255]) + 0.05
    return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100
  })
  expect(razao, 'texto abaixo de 4,5:1 é o que ninguém consegue ler às três da manhã').toBeGreaterThanOrEqual(4.5)
})

// --- a fronteira do cliente ---------------------------------------------------------------
//
// O modo era escolhido pelo corpo da requisição. Quem manda o corpo é o navegador.

test('o cliente NÃO manda classificação — quem decide o modo é o servidor', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('pause tudo')
  await page.getByTestId('architect-input').press('Enter')

  await expect.poll(() => enviado).not.toBeNull()
  const corpo = enviado as Record<string, unknown>
  // Mandar a classificação deixaria o cliente escolher o caminho que executa.
  expect(Object.keys(corpo).sort()).toEqual(['message', 'uiContext'])
})

test('uma fase INESPERADA do servidor não bloqueia o campo para sempre', async ({ page }) => {
  await stub(page, {
    turno: {
      intent: { mode: 'answer', query: 'x', freshness: 'static' },
      // Uma fase intermediária: antes, ela travava o campo sem nada dizer por quê.
      phase: 'consulting',
      text: 'consultando',
      question: null,
      projectId: null,
      context: { pathname: '/', rejected: [] },
    },
  })
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('primeira')
  await page.getByTestId('architect-input').press('Enter')
  await expect(page.getByTestId('architect-mensagens')).toContainText('consultando')

  // O campo continua utilizável: a segunda mensagem sai.
  await page.getByTestId('architect-input').fill('segunda')
  await page.getByTestId('architect-input').press('Enter')
  await expect(page.getByTestId('architect-msg-pessoa').last()).toContainText('segunda')
})

test('a escrita mostra o IMPACTO e espera o clique — nada acontece antes', async ({ page }) => {
  let confirmado: unknown = null
  await stub(page, {
    turno: {
      intent: { mode: 'operate', action: 'pausar a fonte', risk: 'write' },
      phase: 'awaiting_approval',
      text: 'pausar a fonte "Cotações". Confirme para eu fazer.',
      question: null,
      projectId: null,
      context: { pathname: '/', rejected: [] },
      pendingOperation: {
        id: 'op-1',
        operationHash: 'abc123',
        summary: 'pausar a fonte "Cotações"',
        impact: ['A fonte "Cotações" para de coletar até você reativar.'],
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
    },
  })
  await page.route('**/api/architect/assistant/confirm', (r) => {
    confirmado = r.request().postDataJSON()
    return r.fulfill({ json: { ok: true, text: 'A fonte "Cotações" foi pausada.' } })
  })

  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('pause a fonte de cotações')
  await page.getByTestId('architect-input').press('Enter')

  // O impacto aparece ANTES do botão: confirmar sem ler o que vai acontecer é o que a
  // prévia existe para evitar.
  await expect(page.getByTestId('architect-confirmar-operacao')).toContainText('para de coletar')
  expect(confirmado).toBeNull()

  await page.getByTestId('architect-confirmar').click()
  await expect.poll(() => confirmado).not.toBeNull()
  // O que viaja é o id e o hash que o SERVIDOR montou — nunca o texto do modelo.
  expect(confirmado).toEqual({ id: 'op-1', operationHash: 'abc123' })
  await expect(page.getByTestId('architect-desfecho')).toContainText('foi pausada')
})

test('a recusa da confirmação fica NA MENSAGEM, e o botão continua lá', async ({ page }) => {
  await stub(page, {
    turno: {
      intent: { mode: 'operate', action: 'pausar', risk: 'write' },
      phase: 'awaiting_approval',
      text: 'confirme',
      question: null,
      projectId: null,
      context: { pathname: '/', rejected: [] },
      pendingOperation: { id: 'op-2', operationHash: 'velho', summary: 'pausar', impact: ['x'], expiresAt: new Date(Date.now() + 600000).toISOString() },
    },
  })
  await page.route('**/api/architect/assistant/confirm', (r) =>
    r.fulfill({ status: 409, json: { code: 'hash_changed', message: 'o escritório mudou desde a prévia — revise e peça de novo' } }),
  )

  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('pause a fonte')
  await page.getByTestId('architect-input').press('Enter')
  await page.getByTestId('architect-confirmar').click()

  // Um alerta que some deixaria a pessoa sem saber por que nada aconteceu.
  await expect(page.getByTestId('architect-desfecho')).toContainText('mudou desde a prévia')
})

// --- alto risco: o nome é a confirmação ---------------------------------------------------

/** Uma operação de alto risco: o servidor pede o nome digitado. */
const pendenteComNome = (over: Record<string, unknown> = {}) => ({
  intent: { mode: 'operate', action: 'apagar o andar', risk: 'high_risk' },
  phase: 'awaiting_approval',
  text: 'apagar o andar "Operação". Confirme para eu fazer.',
  question: null,
  projectId: null,
  context: { pathname: '/', rejected: [] },
  pendingOperation: {
    id: 'op-risco',
    operationHash: 'h1',
    summary: 'apagar o andar "Operação"',
    impact: ['3 agentes deixam de existir.', 'As conexões da empresa continuam.'],
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    requiresName: 'Operação',
    ...over,
  },
})

const abrirRisco = async (page: import('@playwright/test').Page) => {
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('apague o andar Operação')
  await page.getByTestId('architect-input').press('Enter')
}

test('ALTO RISCO: sem o nome digitado o botão não confirma — e a instrução diz qual nome', async ({ page }) => {
  let chamou = 0
  await stub(page, { turno: pendenteComNome() })
  await page.route('**/api/architect/assistant/confirm', (r) => {
    chamou += 1
    return r.fulfill({ json: { ok: true, text: 'pronto' } })
  })

  await abrirRisco(page)

  // A instrução é o nome EXATO: "confirme" sozinho manda a pessoa adivinhar.
  await expect(page.getByTestId('architect-confirmar-operacao')).toContainText('Operação')
  const campo = page.getByTestId('architect-confirmar-nome')
  await expect(campo).toBeVisible()
  await expect(page.getByTestId('architect-confirmar')).toBeDisabled()

  // Espaço em branco não é nome.
  await campo.fill('   ')
  await expect(page.getByTestId('architect-confirmar')).toBeDisabled()

  // Nome PARECIDO também não: "Operacao" sem acento é outro andar.
  await campo.fill('Operacao')
  await expect(page.getByTestId('architect-confirmar')).toBeDisabled()
  expect(chamou).toBe(0)

  // Com o nome exato, ele libera.
  await campo.fill('Operação')
  await expect(page.getByTestId('architect-confirmar')).toBeEnabled()
})

test('ALTO RISCO: com o nome certo, ele VIAJA na confirmação', async ({ page }) => {
  let enviado: unknown = null
  await stub(page, { turno: pendenteComNome() })
  await page.route('**/api/architect/assistant/confirm', (r) => {
    enviado = r.request().postDataJSON()
    return r.fulfill({ json: { ok: true, text: 'O andar "Operação" foi apagado.' } })
  })

  await abrirRisco(page)
  await page.getByTestId('architect-confirmar-nome').fill('Operação')
  await page.getByTestId('architect-confirmar').click()

  await expect.poll(() => enviado).not.toBeNull()
  expect(enviado).toEqual({ id: 'op-risco', operationHash: 'h1', confirmationName: 'Operação' })
  await expect(page.getByTestId('architect-desfecho')).toContainText('foi apagado')
  // Confirmada, a operação some: um botão que continua ali convida a apagar duas vezes.
  await expect(page.getByTestId('architect-confirmar-operacao')).toHaveCount(0)
})

test('ALTO RISCO: nome recusado pelo SERVIDOR — e o campo fica para corrigir', async ({ page }) => {
  await stub(page, { turno: pendenteComNome() })
  await page.route('**/api/architect/assistant/confirm', (r) =>
    r.fulfill({ status: 409, json: { ok: false, code: 'name_mismatch', message: 'digite o nome "Operação renomeada" para confirmar' } }),
  )

  await abrirRisco(page)
  /**
   * O SERVIDOR é a autoridade — e ele pode discordar do que a tela mostra.
   *
   * O caso real: o andar foi renomeado entre a prévia e o clique. A pessoa digita o nome que
   * está na tela dela, que é o certo do ponto de vista dela, e o servidor recusa porque o
   * recurso já não se chama assim. O `disabled` do lado de cá é conveniência: ele evita a ida
   * e volta óbvia, e não substitui a conferência contra o que o servidor guardou.
   */
  await page.getByTestId('architect-confirmar-nome').fill('Operação')
  await page.getByTestId('architect-confirmar').click()

  // A MENSAGEM DO SERVIDOR, como veio: ela diz qual nome digitar.
  await expect(page.getByTestId('architect-desfecho')).toContainText('digite o nome')
  // E o campo continua: recomeçar a conversa para corrigir um acento é o caminho errado.
  await expect(page.getByTestId('architect-confirmar-nome')).toBeVisible()
})

test('ALTO RISCO: a janela vencida diz que venceu — e não vira sucesso silencioso', async ({ page }) => {
  await stub(page, { turno: pendenteComNome() })
  await page.route('**/api/architect/assistant/confirm', (r) =>
    r.fulfill({ status: 409, json: { ok: false, code: 'expired', message: 'a confirmação venceu: peça de novo para eu preparar outra' } }),
  )

  await abrirRisco(page)
  await page.getByTestId('architect-confirmar-nome').fill('Operação')
  await page.getByTestId('architect-confirmar').click()

  await expect(page.getByTestId('architect-desfecho')).toContainText('venceu')
  await expect(page.getByTestId('architect-confirmar-operacao')).toBeVisible()
})

test('ALTO RISCO: clique duplo manda UMA confirmação só', async ({ page }) => {
  let chamadas = 0
  await stub(page, { turno: pendenteComNome() })
  await page.route('**/api/architect/assistant/confirm', async (r) => {
    chamadas += 1
    // A resposta demora: é exatamente a janela em que o segundo clique acontece.
    await new Promise((ok) => setTimeout(ok, 400))
    return r.fulfill({ json: { ok: true, text: 'apagado' } })
  })

  await abrirRisco(page)
  await page.getByTestId('architect-confirmar-nome').fill('Operação')
  const botao = page.getByTestId('architect-confirmar')
  await botao.click()
  await botao.click({ force: true, timeout: 2000 }).catch(() => undefined)

  await expect(page.getByTestId('architect-desfecho')).toContainText('apagado')
  // Uma operação é de uso único: a segunda chamada leria "não existe mais" como falha.
  expect(chamadas).toBe(1)
})

// --- onde o assistente PODE aparecer -----------------------------------------------------

test('AMEAÇA: o assistente não aparece para quem não entrou', async ({ page }) => {
  /**
   * O botão é fixo na janela, acima de tudo, e não perguntava quem estava do outro lado.
   *
   * Nas páginas públicas — a inicial, o login, o cadastro e o widget que roda no site de
   * outra pessoa — ele aparecia igual. Clicar ali abre um painel que chama uma rota
   * autenticada: a pessoa recebe um erro em vez de resposta, e no widget o botão de outro
   * produto aparece dentro do site de um cliente.
   */
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  // O curinga primeiro e a sessão por último — a última rota registrada é a que vale.
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }))
  // Sem sessão: é `null` que a rota devolve para quem não entrou, e não um objeto vazio.
  await page.route('**/api/auth/**', (r) => r.fulfill({ json: null }))

  for (const caminho of ['/login', '/register', '/']) {
    await page.goto(caminho)
    await expect(page.getByTestId('architect-launcher'), `o Arquiteto apareceu em ${caminho}`).toHaveCount(0)
  }
})

test('e continua aparecendo em página autenticada', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  await expect(page.getByTestId('architect-launcher')).toBeVisible()
})

// --- a porta para a montagem, dentro do chat ---------------------------------------------

/**
 * "Montar operação" é um MODO do Arquiteto, e a porta fica onde a conversa está.
 *
 * Ela saiu da navegação porque, listada ao lado de Agentes e Setores, parecia um módulo irmão
 * deles — e "Arquiteto", "Blueprint" e "Montar operação" viravam três produtos que a pessoa
 * precisava descobrir sozinha que eram a mesma coisa.
 */
test('MONTAR: sem projeto, o botão abre a montagem levando o RASCUNHO junto', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()

  const botao = page.getByTestId('architect-montar-operacao')
  await expect(botao).toBeVisible()
  await expect(botao).toHaveText(/Montar operação/)

  // O que já foi digitado não pode sumir na travessia: pedir para redigitar é a forma mais
  // barata de fazer alguém desistir.
  await page.getByTestId('architect-input').fill('quero avisar quando o estoque acabar')
  await botao.click()

  await page.waitForURL(/\/architect\?objetivo=/, { timeout: 20_000 })
  await expect(page.getByTestId('architect-objective')).toHaveValue('quero avisar quando o estoque acabar')
})

test('MONTAR: sem rascunho, ele abre a lista — onde se começa um e se retoma os antigos', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-montar-operacao').click()

  await page.waitForURL(/\/architect$/, { timeout: 20_000 })
  await expect(page.getByTestId('architect-projects')).toBeVisible()
})

test('MONTAR: com projeto em andamento, ele CONTINUA esse projeto — e o rótulo diz isso', async ({ page }) => {
  /**
   * Perguntar "qual projeto?" para quem acabou de conversar sobre um só é uma pergunta cuja
   * resposta o sistema já tem.
   */
  await stub(page, {
    turno: {
      intent: { mode: 'propose', action: 'montar', risk: 'read' },
      phase: 'proposal',
      text: 'Abri um projeto para isso.',
      question: null,
      projectId: '000000000000000000000abc',
      context: { pathname: '/', rejected: [] },
      pendingOperation: null,
    },
  })
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('quero montar o atendimento')
  await page.getByTestId('architect-input').press('Enter')

  const botao = page.getByTestId('architect-montar-operacao')
  await expect(botao).toHaveText(/Continuar a montagem/)
  await botao.click()
  await page.waitForURL(/\/architect\/000000000000000000000abc/, { timeout: 20_000 })
})

test('MONTAR: no celular o botão continua no chat, com alvo de toque acessível', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()

  const botao = page.getByTestId('architect-montar-operacao')
  await expect(botao).toBeVisible()
  const caixa = await botao.boundingBox()
  expect(caixa!.height, 'alvo de toque abaixo do mínimo').toBeGreaterThanOrEqual(44)
})

test('COMPATIBILIDADE: a rota antiga redireciona PRESERVANDO os parâmetros', async ({ page }) => {
  /**
   * `/architect/new` redirecionava com um destino fixo, o que descartava a query. Um favorito
   * com `?objetivo=…` — que é exatamente o que o botão do chat produz — chegava do outro lado
   * com o campo vazio, e a pessoa redigitava sem entender por quê.
   */
  await stub(page)
  await page.goto('/architect/new?objetivo=vindo%20de%20um%20favorito%20antigo')
  await page.waitForURL(/\/architect\?objetivo=/, { timeout: 20_000 })
  await expect(page.getByTestId('architect-objective')).toHaveValue('vindo de um favorito antigo')
})
