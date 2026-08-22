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
  await page.route(`**/api/public/widgets/${CHAVE}/messages**`, (r) =>
    r.request().method() === 'POST' ? r.fulfill({ status: 500, json: { error: 'boom' } }) : r.fulfill({ json: [] }),
  )

  await page.goto(`/widget/${CHAVE}`)
  await page.getByRole('textbox').fill('preciso de ajuda')
  await page.getByRole('button', { name: /enviar/i }).click()

  await expect(page.getByText(/não foi possível enviar/i)).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveValue('preciso de ajuda')
})
