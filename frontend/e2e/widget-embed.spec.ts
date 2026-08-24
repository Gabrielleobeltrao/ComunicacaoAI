import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// O App Chat Web, de ponta a ponta.
//
// Dois defeitos moravam aqui e faziam o mesmo estrago — um chat instalado no site do
// cliente que não funciona sem dizer por quê:
//
//   * O loader buscava a configuração na origem do SCRIPT (o frontend), cujo nginx não
//     faz proxy de /api. Em produção ele recebia o index.html no lugar do JSON e o widget
//     nem aparecia.
//   * A conversa vivia num `useRef`, e o efeito do socket rodava antes de ela existir.
//     A sala nunca era entrada: as mensagens só chegavam pelo polling de 15 em 15
//     segundos, o que dá ao chat a cara de travado.
//
// E um terceiro, de configuração: dava para criar um widget SEM destino — uma caixa de
// texto que engole mensagem.

const NOW = new Date().toISOString()
const FLOOR = { _id: 'f1', name: 'Atendimento', buildingId: 'b1' }
const CHAVE = 'chave-publica-de-teste'

const AGENTE = { _id: 'a1', name: 'Atendente', floorId: 'f1', preset: 'operator', objective: 'atender' }
const SETOR_OK = {
  _id: 's1',
  name: 'Suporte',
  floorId: 'f1',
  mode: 'orchestrated',
  color: '#111',
  members: [{ agentId: 'a1' }, { agentId: 'a2' }],
  coordinatorAgentId: 'a1',
  stages: [],
}
const SETOR_SO_ORGANIZA = { ...SETOR_OK, _id: 's2', name: 'Grupo do mapa', mode: 'organization' }

const WIDGET = {
  _id: 'w1',
  name: 'Chat do site',
  publicKey: CHAVE,
  agentId: 'a1',
  sectorId: null,
  primaryColor: '#111827',
  position: 'right',
}

async function stub(page: Page, over: { widgets?: unknown[] } = {}) {
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  await page.route('**/api/agents**', (r) => r.fulfill({ json: [AGENTE] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [SETOR_OK, SETOR_SO_ORGANIZA] }))
  await page.route('**/api/apps**', (r) => r.fulfill({ json: [] }))
  // O App precisa estar ATIVO: a página é protegida, e sem isso o guard mostra a tela de
  // ativação em vez do gerenciador. Registrado DEPOIS do genérico de propósito — no
  // Playwright a última rota registrada é a que atende.
  await page.route('**/api/apps/*/surfaces/*/access', (r) => r.fulfill({ json: { ok: true } }))
  await page.route('**/api/widgets', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: over.widgets ?? [WIDGET] }) : r.fallback()))
}

// --- a lista ---------------------------------------------------------------------------------

test('a lista mostra destino com o andar, a chave mascarada e o trecho para colar', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/web-chat/widgets')

  await expect(page.getByTestId('widget-snippet')).toContainText('widget-loader.js')
  await expect(page.getByTestId('widget-snippet')).toContainText(CHAVE)
  // A chave inteira não precisa estar em texto solto: ela já vive no trecho de código.
  await expect(page.getByTestId('widget-key')).not.toContainText(CHAVE)
  await expect(page.getByText('Atendente · Atendimento')).toBeVisible()
})

test('há como copiar o código e abrir a prévia', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/web-chat/widgets')

  await expect(page.getByTestId('widget-copy')).toBeVisible()
  const previa = page.getByTestId('widget-preview')
  await expect(previa).toHaveAttribute('href', `/widget/${CHAVE}`)
  await expect(previa).toHaveAttribute('target', '_blank')
})

// --- o destino é obrigatório e único -----------------------------------------------------------

test('não existe "Sem atendimento", e o setor que só organiza não pode ser escolhido', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/web-chat/widgets')
  await page.getByRole('button', { name: 'Editar' }).first().click()

  const seletor = page.getByLabel('Atendido por')
  await expect(seletor).toBeVisible()
  await expect(seletor.getByRole('option', { name: 'Sem atendimento' })).toHaveCount(0)

  // O setor executável aparece com o andar; o que só organiza aparece e está bloqueado,
  // com o motivo escrito — esconder faria parecer que ele não existe.
  await expect(seletor.getByRole('option', { name: /Suporte · Atendimento/ })).toBeEnabled()
  const soOrganiza = seletor.getByRole('option', { name: /Grupo do mapa/ })
  await expect(soOrganiza).toBeDisabled()
  await expect(soOrganiza).toHaveText(/só organiza, não atende/)
})

// --- o chat do visitante -------------------------------------------------------------------------

test('a mensagem do visitante aparece na hora, sem esperar socket nem polling', async ({ page }) => {
  const enviadas: string[] = []
  await page.route(`**/api/public/widgets/${CHAVE}`, (r) =>
    r.fulfill({ json: { name: 'Chat', primaryColor: '#111827', position: 'right', conversationPersistence: 'same_browser', firstMessage: null } }),
  )
  await page.route(`**/api/public/widgets/${CHAVE}/messages**`, (r) => {
    if (r.request().method() === 'POST') {
      const corpo = JSON.parse(r.request().postData() ?? '{}')
      enviadas.push(corpo.content)
      return r.fulfill({
        status: 201,
        json: [{ _id: 'm1', conversationId: corpo.conversationId, role: 'visitor', content: corpo.content, createdAt: NOW }],
      })
    }
    return r.fulfill({ json: [] })
  })

  await page.goto(`/widget/${CHAVE}`)
  await page.getByRole('textbox').fill('bom dia')
  await page.getByRole('button', { name: /enviar/i }).click()

  // Sem esperar quinze segundos: é o que separa um chat vivo de um travado.
  await expect(page.getByText('bom dia')).toBeVisible({ timeout: 3000 })
  expect(enviadas).toEqual(['bom dia'])
})

test('falha ao enviar devolve o texto ao campo, sem perder o que a pessoa escreveu', async ({ page }) => {
  await page.route(`**/api/public/widgets/${CHAVE}`, (r) =>
    r.fulfill({ json: { name: 'Chat', primaryColor: '#111827', position: 'right', conversationPersistence: 'same_browser', firstMessage: null } }),
  )
  // Um erro SEM mensagem do servidor: aí a frase genérica é a certa.
  await page.route(`**/api/public/widgets/${CHAVE}/messages**`, (r) =>
    r.request().method() === 'POST' ? r.fulfill({ status: 500, body: 'erro interno' }) : r.fulfill({ json: [] }),
  )

  await page.goto(`/widget/${CHAVE}`)
  await page.getByRole('textbox').fill('preciso de ajuda')
  await page.getByRole('button', { name: /enviar/i }).click()

  await expect(page.getByText(/não foi possível enviar/i)).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveValue('preciso de ajuda')
})

// --- o App desativado, e o destino que deixou de atender ---------------------------------------
//
// Os dois têm conserto do lado de quem administra, e nenhum deles é chave errada. Dizer
// "widget não encontrado" para os três casos manda procurar no lugar errado.

test('App revogado: o chat não monta e diz o motivo do servidor', async ({ page }) => {
  await page.route(`**/api/public/widgets/${CHAVE}`, (r) =>
    r.fulfill({ status: 410, json: { error: 'Este chat está indisponível no momento.', code: 'web_chat_inactive' } }),
  )
  await page.goto(`/widget/${CHAVE}`)

  await expect(page.getByText('Este chat está indisponível no momento.')).toBeVisible()
  // Sem campo de escrita: não há para onde a mensagem ir.
  await expect(page.getByRole('textbox')).toHaveCount(0)
})

test('destino que deixou de atender: a mensagem NÃO é aceita, e o texto não se perde', async ({ page }) => {
  await page.route(`**/api/public/widgets/${CHAVE}`, (r) =>
    r.fulfill({ json: { name: 'Chat', primaryColor: '#111827', position: 'right', conversationPersistence: 'same_browser', firstMessage: null } }),
  )
  await page.route(`**/api/public/widgets/${CHAVE}/messages**`, (r) =>
    r.request().method() === 'POST'
      ? r.fulfill({ status: 409, json: { error: 'Este agente não existe mais nesta conta.', code: 'widget_destination_invalid' } })
      : r.fulfill({ json: [] }),
  )

  await page.goto(`/widget/${CHAVE}`)
  await page.getByRole('textbox').fill('preciso de ajuda')
  await page.getByRole('button', { name: /enviar/i }).click()

  // A frase é a do SERVIDOR: "tente de novo" seria um conselho errado aqui.
  await expect(page.getByText('Este agente não existe mais nesta conta.')).toBeVisible()
  // O texto continua no CAMPO — é isso que prova que ele não foi consumido.
  await expect(page.getByRole('textbox')).toHaveValue('preciso de ajuda')
})

// --- os três pontinhos: a promessa de que a resposta está vindo ------------------------------
//
// O pedido some no instante em que é enviado: a mensagem do visitante aparece, e depois há
// silêncio até o agente responder. Esse silêncio dura o tempo de uma inferência — e às
// vezes de uma busca na web em cima dela. Sem nada na tela, a pessoa não sabe se o chat
// travou, se precisa reenviar, ou se ninguém vai responder.

const stubChat = async (page: Page, respostaDoAgente?: { atrasoMs: number; texto: string }) => {
  await page.route(`**/api/public/widgets/${CHAVE}`, (r) =>
    r.fulfill({ json: { name: 'Chat', primaryColor: '#111827', position: 'right', conversationPersistence: 'same_browser', firstMessage: null } }),
  )
  // A página faz um GET ao abrir, ANTES de qualquer envio. Sem esta marca, era ele quem
  // consumia a resposta do agente — e o teste media o carregamento, não a espera.
  let jaEnviou = false
  await page.route(`**/api/public/widgets/${CHAVE}/messages**`, async (r) => {
    const corpo = r.request().method() === 'POST' ? JSON.parse(r.request().postData() ?? '{}') : null
    if (corpo) {
      jaEnviou = true
      return r.fulfill({
        status: 201,
        json: [{ _id: 'm1', conversationId: corpo.conversationId, role: 'visitor', content: corpo.content, createdAt: NOW }],
      })
    }
    // O GET é a rede de segurança de 15s. É por ele que a resposta chega neste teste,
    // porque o socket não sobe com a API dublada.
    if (respostaDoAgente && jaEnviou) {
      return r.fulfill({
        json: [
          { _id: 'm1', conversationId: 'c', role: 'visitor', content: 'bom dia', createdAt: NOW },
          { _id: 'm2', conversationId: 'c', role: 'agent', content: respostaDoAgente.texto, createdAt: NOW },
        ],
      })
    }
    return r.fulfill({ json: [] })
  })
}

test('enquanto o agente prepara a resposta, os três pontinhos aparecem', async ({ page }) => {
  await stubChat(page)
  await page.goto(`/widget/${CHAVE}`)
  await expect(page.getByTestId('typing-dots')).toHaveCount(0, { timeout: 2000 })

  await page.getByRole('textbox').fill('bom dia')
  await page.getByRole('button', { name: /enviar/i }).click()

  // Logo depois do envio — não depois de a resposta chegar, que é justamente o intervalo
  // que ficava mudo.
  await expect(page.getByTestId('typing-dots')).toBeVisible({ timeout: 3000 })
  // Quem usa leitor de tela também precisa saber: para ele o silêncio é ainda maior.
  await expect(page.getByTestId('typing-dots')).toHaveAttribute('aria-live', 'polite')
})

test('os pontinhos somem quando a resposta chega', async ({ page }) => {
  await stubChat(page, { atrasoMs: 0, texto: 'bom dia! como posso ajudar?' })
  await page.goto(`/widget/${CHAVE}`)
  await page.getByRole('textbox').fill('bom dia')
  await page.getByRole('button', { name: /enviar/i }).click()
  await expect(page.getByTestId('typing-dots')).toBeVisible({ timeout: 3000 })

  // A rede de segurança roda de 15 em 15 segundos; a resposta chega por ela.
  await expect(page.getByText('como posso ajudar')).toBeVisible({ timeout: 20_000 })
  // Deixar a animação girando sobre uma resposta já visível é pior do que nunca tê-la
  // mostrado: ela passaria a prometer uma segunda resposta que não vem.
  await expect(page.getByTestId('typing-dots')).toHaveCount(0)
})

test('uma falha no envio NÃO acende os pontinhos', async ({ page }) => {
  // Não há resposta a caminho: prometer uma seria mentir na tela, e a pessoa esperaria
  // em vez de reenviar.
  await page.route(`**/api/public/widgets/${CHAVE}`, (r) =>
    r.fulfill({ json: { name: 'Chat', primaryColor: '#111827', position: 'right', conversationPersistence: 'same_browser', firstMessage: null } }),
  )
  await page.route(`**/api/public/widgets/${CHAVE}/messages**`, (r) =>
    r.request().method() === 'POST' ? r.fulfill({ status: 500, json: { error: 'falhou' } }) : r.fulfill({ json: [] }),
  )
  await page.goto(`/widget/${CHAVE}`)
  await page.getByRole('textbox').fill('bom dia')
  await page.getByRole('button', { name: /enviar/i }).click()

  // A frase é a do SERVIDOR quando ele manda uma — ele sabe o motivo, e "tente de novo"
  // seria um conselho errado em metade dos casos.
  await expect(page.getByText('falhou')).toBeVisible({ timeout: 3000 })
  await expect(page.getByTestId('typing-dots')).toHaveCount(0)
})
