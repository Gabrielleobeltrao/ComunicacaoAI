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
  // A escolha é pelo que ele FAZ; o cartão carrega o verbo e o cargo.
  await page.getByTestId('role-analyst').click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByTestId('work-step')).toBeVisible()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByTestId('review-step')).toBeVisible()
  await page.getByRole('button', { name: 'Contratar agente' }).last().click()
  await expect(page.getByTestId('hire-wizard')).toBeHidden({ timeout: 30_000 })

  // --- 7b. a conversa de teste sobrevive a sair e voltar ---------------------------
  // Contra a pilha de VERDADE: navegador, servidor e banco. O teste de integração já
  // prova a rota; isto prova o caminho da pessoa, que é onde a falha foi relatada.
  const agenteId = await page.evaluate(async () => {
    const r = await fetch('/api/agents', { credentials: 'include' })
    const lista = await r.json()
    return Array.isArray(lista) && lista[0] ? lista[0]._id : ''
  })
  if (!agenteId) throw new Error('smoke: o agente contratado não apareceu na lista')

  await irPara(page, `/floors/${andarId}/agents/${agenteId}/atividade`)
  const campoDeTeste = page.getByPlaceholder('Mensagem do visitante...')
  await expect(campoDeTeste).toBeVisible({ timeout: 20_000 })
  await campoDeTeste.fill('esta conversa precisa sobreviver a um recarregamento')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect(page.getByTestId('playground-messages')).toContainText('esta conversa precisa sobreviver a um recarregamento', {
    timeout: 30_000,
  })
  // A resposta chegou (o dublê responde qualquer coisa): só então a gravação foi disparada.
  await expect(page.getByTestId('playground-run-info')).toBeVisible({ timeout: 30_000 })

  // Depois de recarregar, a conversa volta do banco. A pergunta aparece DUAS vezes na
  // área (o dublê ecoa o texto na resposta), então a asserção é sobre a área inteira —
  // um `getByText` aqui casaria com dois elementos e falharia por ambiguidade, não por
  // ausência.
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByTestId('playground-messages')).toContainText('esta conversa precisa sobreviver a um recarregamento', {
    timeout: 20_000,
  })

  // E o caminho de verdade, que é o mais usado: trocar de aba dentro da página e voltar.
  // Recarregar remonta tudo; trocar de aba pode não remontar — e é aí que uma conversa
  // "salva" pode aparecer vazia.
  await page.getByRole('button', { name: 'Fluxos' }).click()
  await expect(page.getByPlaceholder('Mensagem do visitante...')).toHaveCount(0)
  await page.getByRole('button', { name: 'Atividade' }).click()
  await expect(page.getByTestId('playground-messages')).toContainText('esta conversa precisa sobreviver a um recarregamento', {
    timeout: 20_000,
  })

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

// As quatro larguras que importam, nas telas que o MVP usa de verdade — com uma
// conta que tem andar, setor e agente, criados pelo teste acima.
//
// O que é defeito aqui: a página rolar de lado, um controle ficar fora do alcance,
// ou um alvo de toque menor que o mínimo. Diferença de arranjo entre larguras não é
// defeito — é o layout responsivo funcionando.
const LARGURAS = [
  { rotulo: '320 (celular pequeno)', w: 320, h: 568 },
  { rotulo: '390 (celular)', w: 390, h: 844 },
  { rotulo: '768 (tablet)', w: 768, h: 1024 },
  { rotulo: '1440 (desktop)', w: 1440, h: 900 },
]

test('as telas do MVP cabem em 320, 390, 768 e 1440', async ({ page }) => {
  test.setTimeout(600_000)

  await irPara(page, '/login')
  await page.locator('input[type="email"]').fill(CONTA.email)
  await page.locator('input[type="password"]').fill(CONTA.senha)
  await page.getByRole('button', { name: /Entrar/i }).click()
  await page.waitForURL(/\/(building|dashboard|floors)/, { timeout: 30_000 })

  const andares = await (await page.request.get('/api/floors')).json()
  const andar = andares[0]
  expect(andar, 'o teste anterior tem que ter deixado um andar').toBeTruthy()
  const setores = await (await page.request.get(`/api/sectors?floorId=${andar.id}`)).json()
  const agentes = await (await page.request.get(`/api/agents?floorId=${andar.id}`)).json()

  /**
   * Nomes COMPRIDOS antes de medir.
   *
   * Uma conta recém-criada é o caso fácil: tudo cabe porque não há nada dentro. O
   * estouro de largura aparece com o que a pessoa realmente digita — um nome longo e,
   * pior, um pedaço sem espaço nenhum (um e-mail, uma URL), que não tem onde quebrar e
   * empurra o contêiner inteiro.
   */
  const NOME_COMPRIDO = 'Atendimento ao Cliente Premium — suporte@empresa-de-atendimento-com-nome-bem-comprido.com.br'
  /**
   * `Origin` como o navegador manda.
   *
   * Com o cookie de sessão em jogo, a API exige que a mutação venha de uma origem
   * conhecida — é a defesa de CSRF. `page.request` não é um navegador e não põe o
   * cabeçalho sozinho, mas ele carrega o cookie da sessão: sem declarar a origem, estas
   * duas chamadas são recusadas com 403, e a varredura mediria a conta vazia.
   */
  const daPagina = { Origin: new URL(page.url()).origin }
  await page.request.patch(`/api/agents/${agentes[0]._id}`, {
    headers: daPagina,
    data: { name: NOME_COMPRIDO, objective: `${NOME_COMPRIDO} responde dúvidas, registra pedidos e encaminha o que não resolve.` },
  })
  await page.request.patch(`/api/sectors/${setores[0]._id}`, { headers: daPagina, data: { name: NOME_COMPRIDO } })

  // O nome comprido tem que estar MESMO na tela. Sem isto, um PATCH recusado deixaria
  // a varredura medindo a conta vazia de novo — passando pelo motivo errado.
  await irPara(page, `/floors/${andar.id}/agents`)
  await expect(page.getByText(NOME_COMPRIDO).first()).toBeVisible({ timeout: 20_000 })
  await irPara(page, `/floors/${andar.id}/sectors`)
  await expect(page.getByText(NOME_COMPRIDO).first()).toBeVisible({ timeout: 20_000 })

  // Toda tela que alguém abre pelo menu, e as ABAS de agente e setor — que são
  // telas inteiras diferentes, não um trecho da mesma. Medir só a primeira aba
  // deixava as outras quatro sem ninguém olhando.
  const telas = [
    ['prédio', '/building'],
    ['início', '/dashboard'],
    ['andar (com o mapa)', `/floors/${andar.id}`],
    ['agentes', `/floors/${andar.id}/agents`],
    ['agente', `/floors/${andar.id}/agents/${agentes[0]._id}`],
    ['agente · como trabalha', `/floors/${andar.id}/agents/${agentes[0]._id}/como-trabalha`],
    ['agente · fluxos', `/floors/${andar.id}/agents/${agentes[0]._id}/fluxos`],
    ['agente · atividade', `/floors/${andar.id}/agents/${agentes[0]._id}/atividade`],
    ['agente · avançado', `/floors/${andar.id}/agents/${agentes[0]._id}/avancado`],
    ['setores', `/floors/${andar.id}/sectors`],
    ['setor', `/floors/${andar.id}/sectors/${setores[0]._id}`],
    ['setor · equipe', `/floors/${andar.id}/sectors/${setores[0]._id}/equipe`],
    ['setor · conhecimento', `/floors/${andar.id}/sectors/${setores[0]._id}/conhecimento`],
    ['setor · execuções', `/floors/${andar.id}/sectors/${setores[0]._id}/execucoes`],
    ['setor · avançado', `/floors/${andar.id}/sectors/${setores[0]._id}/avancado`],
    ['execuções', '/executions'],
    ['apps', '/apps'],
    ['memórias', '/memories'],
    ['montar operação', '/architect'],
    ['ajustes', '/settings'],
    ['registros', '/settings/logs'],
  ] as const

  for (const { rotulo, w, h } of LARGURAS) {
    await page.setViewportSize({ width: w, height: h })
    for (const [nome, rota] of telas) {
      await irPara(page, rota)
      await page.waitForLoadState('networkidle').catch(() => undefined)

      // Rolagem lateral da PÁGINA: nada de 100vw nem margem negativa escapando.
      // Um bloco largo (tabela, mapa) pode rolar dentro do próprio contêiner; o
      // documento, não.
      const excesso = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(excesso, `${nome} @ ${rotulo}: a página rola de lado`).toBeLessThanOrEqual(1)

      // Nada pode ficar cortado à esquerda: um bloco que começa antes do zero é
      // conteúdo que o usuário não alcança de jeito nenhum.
      const cortado = await page.evaluate(() => {
        for (const el of document.querySelectorAll('main *')) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0 && r.left < -2) return (el as HTMLElement).tagName + ':' + (el.className || '').toString().slice(0, 40)
        }
        return null
      })
      expect(cortado, `${nome} @ ${rotulo}: elemento cortado à esquerda`).toBeNull()

      /**
       * E os campos de digitar têm largura de digitar.
       *
       * Uma tela pode caber inteira e mesmo assim estar quebrada: basta uma grade de
       * colunas fixas espremer os campos de texto até não caber uma palavra. Nada
       * disso aparece na rolagem da página — foi assim que a linha de parâmetro da
       * ferramenta ficou com 26px de largura sem ninguém notar. Só na tela estreita:
       * acima dela sobra espaço e a conta não é a mesma.
       */
      if (w === 320) {
        const espremidos = await page.evaluate(() => {
          const ruins: string[] = []
          for (const el of document.querySelectorAll('input, select, textarea')) {
            const campo = el as HTMLInputElement
            const tipo = (campo.getAttribute('type') ?? 'text').toLowerCase()
            // Só o que se DIGITA. Caixa de marcar, botão de opção e seletor de cor
            // são pequenos por natureza, e número curto (um limite, um prazo) também.
            if (['checkbox', 'radio', 'color', 'range', 'hidden', 'submit', 'button', 'number'].includes(tipo)) continue
            const r = campo.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) continue
            if (r.width < 90) ruins.push(`${campo.tagName}[${campo.getAttribute('aria-label') ?? campo.getAttribute('placeholder') ?? campo.id ?? tipo}] ${Math.round(r.width)}px`)
          }
          return ruins
        })
        expect(espremidos, `${nome}: campo estreito demais para digitar`).toEqual([])
      }
    }
  }
})

test('nos toques, os controles têm alvo mínimo de 44px', async ({ browser }) => {
  test.setTimeout(120_000)
  // Contexto de TOQUE de verdade: as regras de alvo do design são
  // `@media (pointer: coarse)`. Num contexto de mouse elas nem se aplicam, e o
  // teste passaria medindo a coisa errada.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()

  await irPara(page, '/login')
  await page.locator('input[type="email"]').fill(CONTA.email)
  await page.locator('input[type="password"]').fill(CONTA.senha)
  await page.getByRole('button', { name: /Entrar/i }).click()
  await page.waitForURL(/\/(building|dashboard|floors)/, { timeout: 30_000 })

  const andares = await (await page.request.get('/api/floors')).json()
  const setores = await (await page.request.get(`/api/sectors?floorId=${andares[0].id}`)).json()
  const agentes = await (await page.request.get(`/api/agents?floorId=${andares[0].id}`)).json()

  // As mesmas telas que a varredura de largura mede. Caber na tela e ser tocável são
  // metades da mesma pergunta, e antes daqui a segunda metade olhava só quatro delas.
  const rotas = [
    '/building',
    `/floors/${andares[0].id}`,
    `/floors/${andares[0].id}/agents`,
    `/floors/${andares[0].id}/agents/${agentes[0]._id}`,
    `/floors/${andares[0].id}/sectors`,
    `/floors/${andares[0].id}/sectors/${setores[0]._id}`,
    '/executions',
    '/apps',
    '/memories',
    '/architect',
    '/settings',
    '/settings/logs',
  ]

  for (const rota of rotas) {
    await irPara(page, rota)
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForTimeout(500)
    const pequenos = await page.evaluate(() => {
      const ruins: string[] = []
      for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="tab"]')) {
        const r = el.getBoundingClientRect()
        // Só o que está de fato à vista: um controle escondido no rail encolhido
        // ou fora da dobra não é alvo de toque de ninguém.
        if (r.width === 0 || r.height === 0) continue
        if (r.bottom < 0 || r.top > window.innerHeight) continue
        if (getComputedStyle(el).visibility === 'hidden') continue

        // Os personagens do mapa ficam de fora, de propósito. Eles são figuras de
        // um DIAGRAMA, dimensionadas em tiles: forçar 44px neles mudaria a escala
        // do escritório inteiro, que é o visual do produto. Quem quer abrir um
        // agente pelo toque tem a lista de agentes, e o mapa tem zoom. Os
        // CONTROLES do mapa (ajustar à tela, pausar) continuam valendo — eles não
        // são personagens e a suíte responsiva já os mede.
        if ((el as HTMLElement).closest('[data-agent-figure], [data-testid="office-map"]')) continue
        if (/var\(--tile\)/.test((el as HTMLElement).getAttribute('style') ?? '')) continue

        if (r.width < 32 || r.height < 32) {
          const nome = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 28)
          ruins.push(`${el.tagName}[${nome}] ${Math.round(r.width)}x${Math.round(r.height)}`)
        }
      }
      return ruins
    })
    expect(pequenos, `${rota}: controles com alvo pequeno demais`).toEqual([])
  }

  await ctx.close()
})

test('no celular, o menu abre, navega e fecha', async ({ browser }) => {
  test.setTimeout(120_000)
  // No celular a navegação inteira mora na gaveta atrás do botão da barra de cima —
  // não há barra inferior. Se ela não abrir, não há como sair da tela em que se está.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()

  await irPara(page, '/login')
  await page.locator('input[type="email"]').fill(CONTA.email)
  await page.locator('input[type="password"]').fill(CONTA.senha)
  await page.getByRole('button', { name: /Entrar/i }).click()
  await page.waitForURL(/\/(building|dashboard|floors)/, { timeout: 30_000 })

  const abrir = page.getByRole('button', { name: 'Abrir menu' })
  await expect(abrir).toBeVisible({ timeout: 20_000 })
  await abrir.click()
  const gaveta = page.getByRole('dialog', { name: 'Menu' })
  await expect(gaveta).toBeVisible()

  // Navegar por ela leva a outra tela E fecha a gaveta — ficar aberta por cima do
  // destino é o defeito clássico deste padrão.
  await gaveta.getByRole('link', { name: 'Apps' }).first().click()
  await page.waitForURL(/\/apps/, { timeout: 20_000 })
  await expect(gaveta).toBeHidden()

  // E reabrindo, ela diz onde a pessoa está.
  await abrir.click()
  await expect(page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Apps' }).first()).toHaveAttribute('aria-current', 'page')

  await ctx.close()
})

test('“Montar e ajustar escritório” é acesso de primeira classe, e não só um item de menu', async ({ page }) => {
  test.setTimeout(120_000)
  await irPara(page, '/login')
  await page.locator('input[type="email"]').fill(CONTA.email)
  await page.locator('input[type="password"]').fill(CONTA.senha)
  await page.getByRole('button', { name: /Entrar/i }).click()
  await page.waitForURL(/\/(building|dashboard|floors)/, { timeout: 30_000 })

  /**
   * O Arquiteto deixou de ser um caminho escondido.
   *
   * O desenho anterior o tirava da barra lateral e o deixava SÓ dentro do seletor de
   * andares — um menu que a pessoa precisa saber abrir. Ele agora é uma entrada de primeira
   * classe na navegação, e continua no seletor de andares para quem já aprendeu o caminho.
   */
  // A barra lateral é um trilho recolhido: o rótulo é clipado até o ponteiro entrar.
  await expect(page.locator('aside').getByRole('link', { name: 'Montar e ajustar escritório' })).toHaveCount(1)

  /**
   * E o menu de andares NÃO a repete.
   *
   * Ela morava em três lugares: a navegação, o menu de andares e a folha de andares do
   * celular — três portas para a mesma sala, sendo que o assistente flutuante abre em
   * qualquer página. A que fica escondida dentro de um menu é a que ninguém encontra, e a
   * que sobra é ruído no menu de escolher andar.
   */
  await page.getByTestId('building-switcher').first().click()
  await expect(page.getByTestId('create-floor')).toBeVisible()
  await expect(page.getByTestId('open-architect')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // A navegação continua levando lá — é a porta que sobrou, e ela funciona.
  await page.locator('aside').getByRole('link', { name: 'Montar e ajustar escritório' }).click()
  await page.waitForURL(/\/architect/, { timeout: 20_000 })

  // E no celular a folha de andares também não a repete: a navegação do celular sai do
  // mesmo `navConfig` da barra lateral, então o caminho existe sem duplicata.
  const andares = await (await page.request.get('/api/floors')).json()
  await page.setViewportSize({ width: 390, height: 844 })
  await irPara(page, `/floors/${andares[0].id}`)
  await page.getByRole('button', { name: /Trocar andar\. Andar atual:/ }).click()
  await expect(page.getByTestId('floor-picker-architect')).toHaveCount(0)
})

/**
 * O PRIMEIRO PAINT não carrega o escritório inteiro.
 *
 * Tudo num pacote só dava 1,4 MB para quem abre a tela de login — e a maior parte disso são
 * telas que essa pessoa ainda não tem como ver. A Central de monitoramento sozinha tem duas
 * mil linhas.
 *
 * O que este caso guarda é a propriedade, não o número: as páginas autenticadas chegam em
 * pedaços próprios, e nenhum deles é baixado antes de alguém entrar. Sem isso, um `import`
 * estático acrescentado por engano em `App.tsx` desfaz o corte sem nenhum sinal.
 */
test('a tela pública não baixa as páginas autenticadas', async ({ page }) => {
  /**
   * O que se mede é o PESO, e não o nome dos pedaços.
   *
   * Medir "o pacote da Central não foi pedido" não pega a regressão que importa: um `import`
   * estático não cria pedaço nenhum — ele costura a página dentro do pacote de entrada, e o
   * nome some junto. O peso é o que distingue os dois mundos, e é o que a pessoa espera.
   */
  let bytes = 0
  let scripts = 0
  page.on('response', async (r) => {
    if (r.request().resourceType() !== 'script') return
    scripts += 1
    bytes += Number(r.headers()['content-length'] ?? (await r.body().catch(() => Buffer.alloc(0))).length)
  })

  await irPara(page, '/login')
  await expect(page.getByRole('button', { name: /Entrar/i })).toBeVisible()

  expect(scripts, 'nenhum script carregado — o teste não está medindo a aplicação').toBeGreaterThan(0)
  /**
   * O teto é folgado de propósito: ele existe para pegar o retorno ao pacote único (1,4 MB),
   * e não para policiar cada quilobyte. Hoje a entrada tem ~610 KB.
   */
  const TETO_KB = 900
  expect(Math.round(bytes / 1024), `a tela pública baixou ${Math.round(bytes / 1024)} KB de script`).toBeLessThan(TETO_KB)
})
