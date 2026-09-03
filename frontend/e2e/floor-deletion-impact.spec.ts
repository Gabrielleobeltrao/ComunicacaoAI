import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// EXCLUIR UM ANDAR — dizendo o que se perde, antes do clique.
//
// "Tem certeza?" não é uma pergunta: quem clicou já tinha certeza do que ACHAVA que ia
// acontecer. O que muda a decisão é saber que o Database da empresa fica, que os agentes são
// arquivados e podem voltar, e que um setor de outro andar está usando gente daqui.
const NOW = new Date(0).toISOString()
const FLOOR_ID = '000000000000000000000f11'

const IMPACTO = {
  floor: { id: FLOOR_ID, name: 'Atendimento', status: 'active' },
  entries: [
    { kind: 'agent', id: 'a1', name: 'Marina', disposition: 'archive', reason: 'mora neste andar; será arquivado junto e pode voltar' },
    { kind: 'sector', id: 's1', name: 'Recepção', disposition: 'archive', reason: 'pertence a este andar; será arquivado junto' },
    { kind: 'flow', id: 'fl1', name: 'Avisar o time', disposition: 'archive', reason: 'mora neste andar; sem ele o Flow não tem onde executar' },
    { kind: 'source', id: 'src1', name: 'Cotação do dólar', disposition: 'keep', reason: 'esta fonte é da conta, não deste andar: ela continua existindo' },
    { kind: 'database', id: 'db1', name: 'Históricos', disposition: 'keep', reason: 'é da empresa: continua existindo, e só o acesso deste andar sai' },
    { kind: 'databaseGrant', id: 'g1', name: 'acesso agent', disposition: 'unlink', reason: 'o acesso concedido a este andar (ou a um agente dele) é removido; o Database fica' },
    { kind: 'app', id: 'app1', name: 'WhatsApp da empresa', disposition: 'keep', reason: 'é da empresa: a instalação fica, e os acessos dos agentes removidos são revogados' },
  ],
  counts: { archive: 3, delete: 0, unlink: 1, keep: 3, blocks: 0 },
  byKind: { agent: 1, sector: 1, flow: 1, source: 1, database: 1, databaseGrant: 1, app: 1 },
  blockers: [],
  impactHash: 'abc123def456',
  at: NOW,
}

let purgado: unknown = null

async function stub(page: Page, opts: { impacto?: unknown; purgeErro?: { status: number; body: unknown } } = {}) {
  purgado = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) =>
    r.fulfill({ json: { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW } }),
  )
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/floors**', (r) =>
    r.fulfill({
      json: [
        { id: FLOOR_ID, name: 'Atendimento', status: 'active', buildingId: 'b1', workMode: 'organization', createdAt: NOW, updatedAt: NOW },
        { id: '000000000000000000000f22', name: 'Financeiro', status: 'active', buildingId: 'b1', workMode: 'organization', createdAt: NOW, updatedAt: NOW },
      ],
    }),
  )
  await page.route('**/api/floors/*/deletion-impact**', (r) => r.fulfill({ json: opts.impacto ?? IMPACTO }))
  await page.route('**/api/floors/*/purge', (r) => {
    purgado = r.request().postDataJSON()
    if (opts.purgeErro) return r.fulfill({ status: opts.purgeErro.status, json: opts.purgeErro.body })
    return r.fulfill({
      json: {
        ok: true,
        removed: [{ kind: 'agent', id: 'a1', name: 'Marina', disposition: 'archive', reason: 'x' }],
        unlinked: [{ kind: 'databaseGrant', id: 'g1', name: 'acesso agent', disposition: 'unlink', reason: 'y' }],
        kept: [{ kind: 'database', id: 'db1', name: 'Históricos', disposition: 'keep', reason: 'z' }],
      },
    })
  })
}

const abrirImpacto = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}`)
  await page.getByRole('button', { name: 'Configurações do andar' }).click()
  await page.getByTestId('floor-ver-impacto').click()
}

test('o diálogo diz O QUE SERÁ AFETADO, com a frase que o plano pede', async ({ page }) => {
  await stub(page)
  await abrirImpacto(page)

  const resumo = page.getByTestId('impacto-resumo')
  await expect(resumo).toContainText('Excluir “Atendimento” afetará')
  await expect(resumo).toContainText('1 agente')
  await expect(resumo).toContainText('1 Flow')
})

test('as cinco consequências aparecem SEPARADAS', async ({ page }) => {
  await stub(page)
  await abrirImpacto(page)

  await expect(page.getByTestId('impacto-grupo-Será arquivado')).toBeVisible()
  await expect(page.getByTestId('impacto-grupo-Será desvinculado')).toBeVisible()
  await expect(page.getByTestId('impacto-grupo-Continuará existindo')).toBeVisible()
})

test('o compartilhado aparece como PRESERVADO, com o motivo', async ({ page }) => {
  await stub(page)
  await abrirImpacto(page)

  const mantidos = page.getByTestId('impacto-grupo-Continuará existindo')
  await expect(mantidos).toContainText('Históricos')
  await expect(mantidos).toContainText('é da empresa')
  await expect(mantidos).toContainText('WhatsApp da empresa')
})

test('sem digitar o nome, o botão de excluir fica indisponível', async ({ page }) => {
  await stub(page)
  await abrirImpacto(page)

  await expect(page.getByTestId('purge-confirmar')).toBeDisabled()
  await page.getByTestId('purge-nome').fill('atendimento')
  await expect(page.getByTestId('purge-confirmar')).toBeDisabled()
  await page.getByTestId('purge-nome').fill('Atendimento')
  await expect(page.getByTestId('purge-confirmar')).toBeEnabled()
})

test('confirmar manda o HASH do retrato e as escolhas', async ({ page }) => {
  await stub(page)
  await abrirImpacto(page)

  await page.getByTestId('purge-excluir-exclusivos').check()
  await page.getByTestId('purge-nome').fill('Atendimento')
  await page.getByTestId('purge-confirmar').click()

  await expect.poll(() => purgado).not.toBeNull()
  expect(purgado).toMatchObject({
    impactHash: 'abc123def456',
    confirmationName: 'Atendimento',
    choices: { deleteExclusiveResources: true },
  })
})

test('o resultado diz o que foi removido, desvinculado e mantido', async ({ page }) => {
  await stub(page)
  await abrirImpacto(page)
  await page.getByTestId('purge-nome').fill('Atendimento')
  await page.getByTestId('purge-confirmar').click()

  const r = page.getByTestId('purge-resultado')
  await expect(r).toContainText('1 removido(s)')
  await expect(r).toContainText('1 desvinculado(s)')
  await expect(r).toContainText('1 mantido(s)')
  await expect(r).toContainText('Históricos')
})

test('um BLOQUEIO aparece e impede a confirmação', async ({ page }) => {
  await stub(page, {
    impacto: {
      ...IMPACTO,
      blockers: ['o setor "Comitê", de outro andar, usa agentes deste'],
      entries: [...IMPACTO.entries, { kind: 'sector', id: 's9', name: 'Comitê', disposition: 'blocks', reason: 'está em outro andar e usa agentes deste' }],
    },
  })
  await abrirImpacto(page)

  await expect(page.getByTestId('impacto-bloqueios')).toContainText('Comitê')
  await page.getByTestId('purge-nome').fill('Atendimento')
  await expect(page.getByTestId('purge-confirmar')).toBeDisabled()
})

test('um hash VELHO devolve conflito, e a tela recarrega o retrato em vez de insistir', async ({ page }) => {
  await stub(page, {
    purgeErro: { status: 409, body: { code: 'impact_changed', message: 'o escritório mudou desde a análise; revise o impacto antes de confirmar' } },
  })
  await abrirImpacto(page)
  await page.getByTestId('purge-nome').fill('Atendimento')
  await page.getByTestId('purge-confirmar').click()

  await expect(page.getByTestId('purge-erro')).toContainText('mudou desde a análise')
  // O diálogo continua aberto com o impacto recarregado: confirmar de novo sobre uma foto
  // velha é exatamente o que o hash existe para impedir.
  await expect(page.getByTestId('impacto-resumo')).toBeVisible()
})

test('em 320 px o diálogo cabe e não empurra a página', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 320, height: 720 })
  await abrirImpacto(page)
  await expect(page.getByTestId('impacto-resumo')).toBeVisible()
  const largura = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(largura).toBeLessThanOrEqual(321)
})
