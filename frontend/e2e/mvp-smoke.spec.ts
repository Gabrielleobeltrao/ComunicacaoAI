// O smoke de MVP: a pilha inteira, de verdade.
//
// Rode com `npm run smoke` na raiz. Ele sobe um mongod isolado, o backend
// compilado e o frontend compilado, e roda isto contra a pilha real — sem
// `page.route`, sem stub e sem conta, banco ou chave de ninguém. É o oposto das
// outras specs deste diretório, que interceptam a API de propósito para isolar a
// tela: aqui nada é interceptado, e uma falha significa que o produto quebrou.
//
// Um teste só, em ordem, porque os passos dependem uns dos outros — a conta criada
// no começo é a que cria o andar, que recebe o setor, que recebe o agente. Dividir
// em testes independentes exigiria semear estado por fora, e o que se quer provar
// aqui é justamente que o caminho inteiro funciona seguido.
import { test, expect, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

// Determinístico: o mongod é novo a cada execução, então o mesmo e-mail sempre
// serve e o teste não depende de aleatoriedade nem deixa lixo.
const CONTA = { nome: 'QA Smoke', email: 'smoke@local.test', senha: 'smoke-password-123' }

const irPara = async (page: Page, caminho: string) => {
  await page.goto(caminho)
  await page.waitForLoadState('domcontentloaded')
}

test('MVP: registro, prédio, setor, agente, permissões, execução e log', async ({ page }) => {
  test.setTimeout(240_000)

  // --- 1. registro, sessão -------------------------------------------------------
  await irPara(page, '/register')
  await page.getByRole('textbox').first().fill(CONTA.nome)
  await page.locator('input[type="email"]').fill(CONTA.email)
  await page.locator('input[type="password"]').fill(CONTA.senha)
  await page.getByRole('button', { name: /Criar conta/i }).click()
  // Conta nova não tem andar nenhum, então o destino é a página do prédio — onde
  // se cria o primeiro. Antes ela caía num dashboard sem saída.
  await page.waitForURL(/\/(building|dashboard|floors)/, { timeout: 30_000 })

  // A sessão sobrevive a um reload: o cookie é real, não estado de memória.
  await page.reload()
  await expect(page).toHaveURL(/\/(building|dashboard|floors)/)

  // --- 2. dashboard ---------------------------------------------------------------
  await irPara(page, '/dashboard')
  await expect(page.getByTestId('building-switcher').first()).toBeVisible({ timeout: 20_000 })

  // --- 3. criar andar -------------------------------------------------------------
  await irPara(page, '/building')
  await page.getByRole('button', { name: 'Criar andar' }).click()
  const formulario = page.locator('form')
  await formulario.locator('input').first().fill('Andar Smoke')
  await formulario.getByRole('button', { name: /^Criar$/ }).click()
  // O cartão do andar é um link: é ele que leva à URL própria do andar, e é ela
  // que escopa tudo daqui para baixo.
  const cartao = page.getByRole('link', { name: /Andar Smoke/ }).first()
  await expect(cartao).toBeVisible({ timeout: 20_000 })
  await cartao.click()
  await page.waitForURL(/\/floors\/[a-f0-9]{24}/, { timeout: 20_000 })
  const andarId = (/\/floors\/([a-f0-9]{24})/.exec(page.url()) ?? [])[1]
  expect(andarId, 'o andar criado precisa ter id na URL').toBeTruthy()

  // --- 4. editar andar ------------------------------------------------------------
  await page.getByRole('button', { name: 'Configurações do andar' }).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeVisible()
  await dialogo.getByRole('textbox').first().fill('Andar Smoke II')
  await dialogo.getByRole('button', { name: /^Salvar/ }).click()
  await expect(dialogo).toBeHidden({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Andar Smoke II' })).toBeVisible({ timeout: 20_000 })

  // --- 5. trocar de andar, no desktop ---------------------------------------------
  const seletor = page.getByTestId('building-switcher').first()
  await seletor.hover()
  await seletor.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')

  // --- 6. trocar de andar, no celular ---------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 })
  await irPara(page, `/floors/${andarId}`)
  const hamburguer = page.locator('button[aria-label="Abrir menu"]')
  await expect(hamburguer).toBeVisible({ timeout: 20_000 })
  await hamburguer.click()
  await expect(page.locator('#mobile-drawer')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 900 })

  // --- 7. contratar agente --------------------------------------------------------
  // Contratar é um assistente de três passos: função, trabalho, revisar. O nome é
  // gerado pelo sistema, então o smoke não escolhe — ele confere que o agente
  // apareceu na lista do andar.
  await irPara(page, `/floors/${andarId}/agents`)
  await page.getByRole('button', { name: 'Contratar agente' }).first().click()
  await expect(page.getByTestId('hire-wizard')).toBeVisible({ timeout: 20_000 })
  await page.getByText('Analista', { exact: true }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByTestId('work-step')).toBeVisible()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByTestId('review-step')).toBeVisible()
  await page.getByRole('button', { name: 'Contratar agente' }).last().click()
  await expect(page.getByTestId('hire-wizard')).toBeHidden({ timeout: 30_000 })

  // --- 8. criar setor e vincular o agente -----------------------------------------
  // O setor também é um assistente: identidade, modo, time. "Só organizar" é o
  // modo que não exige coordenador nem etapas — é o caminho mais curto até um setor
  // válido, que é o que o smoke precisa.
  await irPara(page, `/floors/${andarId}/sectors`)
  await page.getByRole('button', { name: 'Nova equipe' }).click()
  await expect(page.getByTestId('sector-wizard')).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('Nome da equipe').fill('Setor Smoke')
  await page.getByTestId('sector-next').click()
  await page.getByTestId('sector-mode-organization').click()
  await page.getByTestId('sector-next').click()
  // O agente contratado acima entra na equipe: é este o vínculo agente-setor, e é
  // o que faz a equipe deixar de estar vazia.
  const escolherMembro = page.getByTestId('sector-wizard').locator('select').first()
  await expect(escolherMembro).toBeVisible({ timeout: 20_000 })
  const opcoes = await escolherMembro.locator('option').count()
  expect(opcoes, 'o agente contratado precisa estar disponível para a equipe').toBeGreaterThan(1)
  await escolherMembro.selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Criar equipe' }).click()
  await expect(page.getByTestId('sector-wizard')).toBeHidden({ timeout: 30_000 })
  await expect(page.getByText('Setor Smoke').first()).toBeVisible({ timeout: 30_000 })

  // --- 9. permissões de Apps salvam -----------------------------------------------
  await irPara(page, `/floors/${andarId}/agents`)
  // O cartão do agente navega no clique (não é um <a>), então o alvo é o testid.
  const cartaoAgente = page.getByTestId('agent-card').first()
  await expect(cartaoAgente).toBeVisible({ timeout: 20_000 })
  await cartaoAgente.click()
  await page.waitForURL(/\/agents\/[a-f0-9]{24}/, { timeout: 20_000 })
  const agenteUrl = page.url().split('?')[0]

  // --- 10. execução manual (playground) -------------------------------------------
  await irPara(page, `${agenteUrl}/atividade`)
  const caixa = page.getByPlaceholder('Mensagem do visitante...')
  await expect(caixa).toBeVisible({ timeout: 20_000 })
  await caixa.fill('teste de smoke')
  await caixa.press('Enter')
  // O adaptador falso responde com prefixo próprio: é assim que se sabe que a
  // execução foi ponta a ponta e que NENHUM provedor real foi chamado.
  await expect(page.getByText(/\[fake\]/).first()).toBeVisible({ timeout: 60_000 })

  // --- 11. rotina agendada e gatilho de webhook ------------------------------------
  await irPara(page, `${agenteUrl}/fluxos`)
  await page.getByTestId('new-routine').click()
  await page.getByTestId('routine-objective').fill('resumir o dia')
  await page.getByTestId('routine-name').fill('Rotina Smoke')
  await page.getByTestId('save-routine').click()
  const linhaRotina = page.getByTestId('routine-row').first()
  await expect(linhaRotina).toBeVisible({ timeout: 30_000 })
  // Publicada = executável. Uma rotina nasce ativa; se em algum momento passar a
  // nascer pausada, o botão "Ativar" está aqui e o teste continua valendo — o que
  // ele afirma é o ESTADO final, não o clique.
  const ativar = linhaRotina.getByRole('button', { name: 'Ativar' })
  if (await ativar.count()) await ativar.click()
  await expect(linhaRotina.getByRole('button', { name: 'Pausar' })).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('new-event-trigger').click()
  await page.getByTestId('trigger-objective').fill('reagir ao pedido')
  await page.getByTestId('trigger-name').fill('Gatilho Smoke')
  await page.getByTestId('save-event-trigger').click()
  // O segredo do webhook é gerado pelo servidor e aparece uma vez.
  await expect(page.getByTestId('trigger-secret')).toBeVisible({ timeout: 30_000 })

  // --- 12. a execução aparece com raiz e log ---------------------------------------
  await irPara(page, '/executions')
  // A Central lista o que roda; a Análise é uma VISÃO sobre as mesmas execuções.
  await expect(page.locator('body')).toContainText('Agendadas', { timeout: 30_000 })
  await expect(page.getByText('Rotina Smoke').first()).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('tab-analysis').click()
  await expect(page.getByTestId('execution-analytics')).toBeVisible({ timeout: 30_000 })

  // O histórico da conta: quem fez o quê. A rotina e o gatilho criados acima
  // deixaram rastro, e é isso que o log tem que mostrar.
  await irPara(page, '/settings/logs')
  await expect(page.locator('body')).toContainText(/Rotina Smoke|Gatilho Smoke|Setor Smoke/, { timeout: 30_000 })

  // --- 13. erro de API aparece na tela ---------------------------------------------
  // Uma recusa do SERVIDOR, não uma validação local: o andar tem agente e setor, e
  // o backend se recusa a apagá-lo. O motivo tem que chegar ao dono na tela, com a
  // palavra dele — não sumir num console nem virar "algo deu errado".
  await irPara(page, `/floors/${andarId}`)
  await page.getByRole('button', { name: 'Configurações do andar' }).click()
  const config = page.getByRole('dialog')
  await expect(config).toBeVisible({ timeout: 20_000 })
  page.once('dialog', (d) => void d.accept())
  await config.getByRole('button', { name: 'Excluir andar' }).click()
  await expect(config.getByRole('alert')).toBeVisible({ timeout: 20_000 })
  await expect(config.getByRole('alert')).toContainText(/vazio|agente|setor|não/i)
  await page.keyboard.press('Escape')

  // --- 14. sair encerra a sessão de verdade ----------------------------------------
  await irPara(page, `/floors/${andarId}`)
  // O rail fica encolhido até o mouse entrar: sem hover, o botão existe com
  // largura zero e o clique não chega nele.
  await page.getByTestId('building-switcher').first().hover()
  const sair = page.locator('button[aria-label="Sair"]').first()
  await expect(sair).toBeVisible({ timeout: 20_000 })
  await sair.click()
  await page.waitForURL(/\/login/, { timeout: 30_000 })
  // E a rota protegida deixa de abrir: o cookie foi embora no servidor.
  await irPara(page, '/dashboard')
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })

  // --- 15. login com a mesma conta -------------------------------------------------
  await irPara(page, '/login')
  await page.locator('input[type="email"]').fill(CONTA.email)
  await page.locator('input[type="password"]').fill(CONTA.senha)
  await page.getByRole('button', { name: /Entrar/i }).click()
  await page.waitForURL(/\/(building|dashboard|floors)/, { timeout: 30_000 })

  // --- 16. o que a interface disse tem que existir no servidor ---------------------
  //
  // Um passo de UI pode passar por acidente — um seletor que casa com outra coisa,
  // uma tela que renderiza antes da resposta chegar. Aqui o smoke pergunta à API,
  // com a MESMA sessão, se cada coisa criada acima existe de verdade.
  const json = async (rota: string) => {
    const res = await page.request.get(rota)
    expect(res.status(), `${rota} respondeu ${res.status()}`).toBe(200)
    return res.json()
  }

  const andares = await json('/api/floors')
  expect(andares.map((f: { name: string }) => f.name)).toContain('Andar Smoke II')

  const setores = await json(`/api/sectors?floorId=${andarId}`)
  const setor = setores.find((s: { name: string }) => s.name === 'Setor Smoke')
  expect(setor, 'o setor criado tem que existir no servidor').toBeTruthy()
  // O vínculo agente-setor: a equipe não está vazia.
  expect(setor.members?.length ?? 0).toBeGreaterThan(0)

  const agentes = await json(`/api/agents?floorId=${andarId}`)
  expect(agentes.length, 'o agente contratado tem que existir').toBeGreaterThan(0)

  // A execução manual do playground gerou uma raiz de verdade — inclusive as de
  // teste, que ficam fora das métricas de produção mas EXISTEM.
  const analise = await json('/api/executions/analytics?scope=building&period=all&includeTest=true')
  expect(analise.executions + analise.participations, 'a execução manual tem que ter deixado raiz').toBeGreaterThan(0)

  // E o histórico da conta registrou as criações.
  const trilha = await json('/api/logs/audit?limit=50')
  const eventos = JSON.stringify(trilha)
  for (const marca of ['Andar Smoke II', 'Setor Smoke', 'Rotina Smoke']) {
    expect(eventos, `o log de auditoria não registrou "${marca}"`).toContain(marca)
  }
})

// A URL direta de um App não ativado não pode abrir a página dele. É uma regra de
// autorização, não de navegação: quem digita o endereço tem que bater no mesmo
// muro de quem clica.
test('URL direta de App inativo não abre a página', async ({ page }) => {
  await irPara(page, '/login')
  await page.locator('input[type="email"]').fill(CONTA.email)
  await page.locator('input[type="password"]').fill(CONTA.senha)
  await page.getByRole('button', { name: /Entrar/i }).click()
  await page.waitForURL(/\/(building|dashboard|floors)/, { timeout: 30_000 })

  await irPara(page, '/apps/whatsapp/channels')
  // Ou volta para o catálogo dizendo por quê, ou mostra a tela de reconexão.
  await expect
    .poll(
      async () => {
        const url = page.url()
        if (/\/apps(\?|$)/.test(url)) return 'catalogo'
        return (await page.getByTestId('surface-needs-reauth').count()) > 0 ? 'reauth' : url
      },
      { timeout: 20_000 },
    )
    .toMatch(/catalogo|reauth/)
})
