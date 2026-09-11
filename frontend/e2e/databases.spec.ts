import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// DATABASES na tela: criar, declarar um conjunto, consultar.
//
// O que estes casos protegem: a origem do dado é dita em voz alta (mercado não é memória
// nem conhecimento), "quantos vieram" nunca é apresentado como "quantos existem", e uma
// tabela larga rola dentro do próprio bloco em vez de empurrar a página.
const NOW = new Date(0).toISOString()
const DB_ID = '000000000000000000000db1'

const LISTA = {
  items: [
    { id: DB_ID, name: 'Operações', description: 'ordens do dia', adapterKind: 'data_history', status: 'active', retention: { mode: 'forever' }, owner: { ownerType: 'building', ownerId: 'b1' }, datasets: 1, updatedAt: NOW },
    { id: '000000000000000000000db2', name: 'Mercado', description: '', adapterKind: 'market_data', status: 'paused', retention: { mode: 'forever' }, owner: { ownerType: 'building', ownerId: 'b1' }, datasets: 1, updatedAt: NOW },
  ],
}

const DETALHE = {
  id: DB_ID,
  name: 'Operações',
  description: 'ordens do dia',
  adapterKind: 'data_history',
  status: 'active',
  retention: { mode: 'forever' },
  owner: { ownerType: 'building', ownerId: 'b1' },
  adapterConfig: { recorderId: 'r1' },
  updatedAt: NOW,
  datasets: [
    {
      key: 'ordens',
      name: 'ordens',
      mutability: 'mutable',
      fields: ['ticker', 'preco'],
      schema: { type: 'object', properties: { ticker: { type: 'string' }, preco: { type: 'number' } } },
      // De onde vem e com que regra — o que antes só existia na tela de Históricos.
      serie: {
        id: 'rec-1',
        nome: 'minimo e maximo a cada 5 min',
        modo: 'window_aggregate',
        intervalMs: 300000,
        contas: ['preco → min → minimo', 'preco → max → maximo'],
        ativa: true,
        registros: 288,
        fonte: 'Bitcoin',
      },
    },
    // Um conjunto que SÓ ACRESCENTA, para a tela ter de dizer por que ali não se corrige.
    { key: 'fechamentos', name: 'fechamentos', mutability: 'append_only', fields: ['ticker'], schema: { type: 'object', properties: { ticker: { type: 'string' } } } },
  ],
}

let consultas: { limit?: number; skip?: number }[] = []
let patchesEnviados: Record<string, unknown>[] = []
let apagados: string[] = []
let conjuntosApagados: string[] = []
let linhasApagadas: string[] = []
let criado: Record<string, unknown> | null = null
let colunaCriada: Record<string, unknown> | null = null
let colunasApagadas: string[] = []

/** O catálogo de funções — o MESMO que o agente lê. */
const CATALOGO = {
  functions: [
    {
      functionName: 'math.serie',
      version: '1.0.0',
      description: 'Lê uma série de números: variação do começo ao fim, tendência, mediana e percentil.',
      capabilities: ['calculo', 'dados'],
      inputSchema: { type: 'object', properties: { values: { type: 'array', items: { type: 'number' } }, percentil: { type: 'number' } }, required: ['values'] },
      outputSchema: { type: 'object', properties: { variacaoPercentual: {}, tendencia: { type: 'string' }, mediana: {} } },
    },
    {
      functionName: 'texto.normalizar',
      version: '1.0.0',
      description: 'Tira acento e espaço sobrando.',
      capabilities: ['texto'],
      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      outputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    },
  ],
  actions: [],
}
let grantSalvo: Record<string, unknown> | null = null

const GRANTS = {
  items: [
    { id: 'g1', subjectType: 'sector', subjectId: 's1', capabilities: ['discover', 'query'], effect: 'allow', datasetKeys: [], updatedAt: NOW },
  ],
}

const IMPACTO = {
  dataStoreId: DB_ID,
  name: 'Operações',
  datasets: [{ key: 'ordens', mutability: 'mutable' }, { key: 'fechamentos', mutability: 'append_only' }],
  grants: 1,
  accessibleBy: [{ agentId: 'a1', name: 'Marina', origin: 'sector' }],
  recommendation: 'prefer_archive',
}

async function stub(page: Page, opts: { listStatus?: number; empty?: boolean } = {}) {
  criado = null
  colunaCriada = null
  colunasApagadas = []
  grantSalvo = null
  patchesEnviados = []
  apagados = []
  conjuntosApagados = []
  linhasApagadas = []
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  consultas = []
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW } }))
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route(`**/api/databases/${DB_ID}/datasets/ordens/query`, (r) => {
    // A consulta responde de acordo com o que foi PEDIDO: é assim que a paginação é
    // verificável de verdade, e não contra um corpo fixo que ignora `skip`.
    const pedido = (r.request().postDataJSON() ?? {}) as { limit?: number; skip?: number }
    consultas.push(pedido)
    const limite = Number(pedido.limit ?? 20)
    const pulo = Number(pedido.skip ?? 0)
    const linhas = Array.from({ length: Math.max(0, Math.min(limite, 137 - pulo)) }, (_, i) => ({
      // A identidade da linha, que é por onde a tela aponta qual corrigir ou apagar.
      rowId: `r${pulo + i + 1}`,
      ticker: `T${pulo + i}`,
      preco: 10 + pulo + i,
      occurredAt: NOW,
    }))
    return r.fulfill({ json: { rows: linhas, total: 137, returned: linhas.length, truncated: pulo + linhas.length < 137, freshness: NOW } })
  })
  await page.route(`**/api/databases/${DB_ID}/datasets/fechamentos/query`, (r) =>
    r.fulfill({ json: { rows: [{ rowId: 'f1', ticker: 'VALE3', occurredAt: NOW }], total: 1, returned: 1, truncated: false, freshness: NOW } }),
  )
  await page.route(`**/api/databases/${DB_ID}/datasets`, (r) => {
    criado = r.request().postDataJSON() as Record<string, unknown>
    return r.fulfill({ status: 201, json: { key: String(criado.key) } })
  })
  await page.route('**/api/executors/catalog', (r) => r.fulfill({ json: CATALOGO }))
  await page.route(`**/api/databases/${DB_ID}/datasets/ordens/columns/**`, (r) => {
    colunasApagadas.push(r.request().url().split('/').pop() ?? '')
    return r.fulfill({ status: 204, body: '' })
  })
  await page.route(`**/api/databases/${DB_ID}/datasets/ordens/columns`, (r) => {
    colunaCriada = r.request().postDataJSON()
    return r.fulfill({ status: 201, json: { name: 'variacao', functionName: 'math.serie', version: '1.0.0', outputField: 'variacaoPercentual' } })
  })
  await page.route('**/api/agents', (r) => r.fulfill({ json: [{ _id: 'a1', name: 'Marina' }] }))
  await page.route('**/api/sectors', (r) => r.fulfill({ json: [{ _id: 's1', name: 'Análise' }] }))
  await page.route(`**/api/databases/${DB_ID}/impact`, (r) => r.fulfill({ json: IMPACTO }))
  await page.route(`**/api/databases/${DB_ID}/grants/**`, (r) => r.fulfill({ status: 204, body: '' }))
  await page.route(`**/api/databases/${DB_ID}/grants`, (r) => {
    if (r.request().method() === 'PUT') {
      grantSalvo = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ json: { id: 'g2', ...grantSalvo } })
    }
    return r.fulfill({ json: GRANTS })
  })
  // A linha: apagar e corrigir, apontadas pelo `rowId`.
  await page.route(`**/api/databases/${DB_ID}/datasets/*/rows/*`, (r) => {
    const rowId = r.request().url().split('/').pop() ?? ''
    if (r.request().method() === 'DELETE') {
      linhasApagadas.push(rowId)
      return r.fulfill({ status: 204, body: '' })
    }
    patchesEnviados.push({ rowId, ...(r.request().postDataJSON() as Record<string, unknown>) })
    return r.fulfill({ json: { updated: 1 } })
  })

  // O conjunto: apagar e editar respondem no mesmo caminho, por método.
  await page.route(`**/api/databases/${DB_ID}/datasets/*`, (r) => {
    const chave = r.request().url().split('/').pop() ?? ''
    if (r.request().method() === 'DELETE') {
      conjuntosApagados.push(chave)
      return r.fulfill({ status: 204, body: '' })
    }
    if (r.request().method() === 'PATCH') {
      patchesEnviados.push({ dataset: chave, ...(r.request().postDataJSON() as Record<string, unknown>) })
      return r.fulfill({ json: { key: chave, name: chave, mutability: 'mutable' } })
    }
    return r.fulfill({ json: DETALHE.datasets })
  })
  await page.route(`**/api/databases/${DB_ID}`, (r) => {
    if (r.request().method() === 'DELETE') {
      apagados.push(DB_ID)
      return r.fulfill({ status: 204, body: '' })
    }
    if (r.request().method() === 'PATCH') {
      patchesEnviados.push({ id: DB_ID, ...(r.request().postDataJSON() as Record<string, unknown>) })
      return r.fulfill({ json: { id: DB_ID, name: 'ok', status: 'active' } })
    }
    return r.fulfill({ json: DETALHE })
  })
  await page.route('**/api/databases', (r) => {
    if (r.request().method() === 'POST') {
      criado = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ status: 201, json: { id: 'novo', name: String(criado.name) } })
    }
    if (opts.listStatus && opts.listStatus >= 400) return r.fulfill({ status: opts.listStatus, json: { message: 'não foi possível carregar' } })
    return r.fulfill({ json: opts.empty ? { items: [] } : LISTA })
  })
}

test('a lista diz a ORIGEM de cada database, e o estado', async ({ page }) => {
  await stub(page)
  await page.goto('/databases')
  await expect(page.getByTestId('databases-list')).toBeVisible()
  // Mercado não é memória nem conhecimento — e a tela diz de onde vem.
  // A lista virou uma lista de PASTAS: o mesmo conteúdo, num lugar que se abre.
  await expect(page.getByTestId('pasta-000000000000000000000db2')).toContainText('Dados de mercado')
  await expect(page.getByTestId('pasta-000000000000000000000db2')).toContainText('pausado')
  await expect(page.getByTestId(`pasta-${DB_ID}`)).toContainText('Histórico interno')
})

test('abrir um database mostra os conjuntos e a consulta', async ({ page }) => {
  await stub(page)
  await page.goto('/databases')
  // A tela inteira continua existindo — abrir a pasta mostra o que tem dentro; o ícone de
  // abrir leva à tela com a consulta.
  await page.getByTestId(`pasta-${DB_ID}`).click()
  await expect(page.getByTestId('item-fechamentos')).toContainText('só acrescenta')
  await page.getByTestId(`pasta-abrir-${DB_ID}`).click()
  await expect(page.getByTestId('database-detail')).toBeVisible()
  // A tela do Database NÃO repete a lista de conjuntos: quem escolhe é a pasta.
  await expect(page.getByTestId('database-datasets')).toHaveCount(0)

  // "Quantos vieram" nunca é apresentado como "quantos existem".
  await expect(page.getByTestId('dataset-query-counts')).toContainText('20 de 137')
  await expect(page.getByTestId('dataset-query-table')).toContainText('T0')
})

test('criar um conjunto monta o schema a partir de campo:tipo', async ({ page }) => {
  await stub(page)
  // Criar um conjunto é mexer no que a pasta guarda — o botão fica DENTRO da pasta.
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()
  await page.getByTestId(`dataset-new-${DB_ID}`).click()
  await page.getByTestId(`dataset-new-key-${DB_ID}`).fill('clientes')
  await page.getByTestId(`dataset-new-fields-${DB_ID}`).fill('nome:string\nidade:number')
  await page.getByTestId(`dataset-new-save-${DB_ID}`).click()
  await expect.poll(() => (criado as { schema?: { properties?: Record<string, { type: string }> } } | null)?.schema?.properties?.idade?.type).toBe('number')
})

test('criar um database manda o adapter escolhido', async ({ page }) => {
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId('databases-new').click()
  await page.getByTestId('database-new-name').fill('Estoque')
  await page.getByTestId('database-new-adapter').selectOption('market_data')
  await page.getByTestId('database-new-save').click()
  await expect.poll(() => (criado as { adapterKind?: string } | null)?.adapterKind).toBe('market_data')
})

test('erro NÃO vira lista vazia', async ({ page }) => {
  await stub(page, { listStatus: 500 })
  await page.goto('/databases')
  await expect(page.getByTestId('databases-error')).toBeVisible()
  await expect(page.getByTestId('databases-empty')).toHaveCount(0)
})

test('vazio explica o que um database é', async ({ page }) => {
  await stub(page, { empty: true })
  await page.goto('/databases')
  await expect(page.getByTestId('databases-empty')).toContainText('sem misturá-los com conhecimento')
})

test('em 320 px a tabela rola dentro do bloco, e a página não', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await stub(page)
  await page.goto(`/databases?id=${DB_ID}`)
  await expect(page.getByTestId('dataset-query-table')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

// --- grants ------------------------------------------------------------------------------

test('conceder a um SETOR avisa que vale para quem entrar depois', async ({ page }) => {
  await stub(page)
  await page.goto(`/databases?id=${DB_ID}`)
  await page.getByTestId('grant-new').click()
  await page.getByTestId('grant-subject').selectOption('sector:s1')
  // O impacto ANTES de salvar: um setor é gente, e a decisão é tomada sobre pessoas.
  await expect(page.getByTestId('grant-impact')).toContainText('inclusive os que entrarem depois')
  await page.getByTestId('grant-save').click()
  await expect.poll(() => (grantSalvo as { subjectType?: string } | null)?.subjectType).toBe('sector')
})

test('negar é uma escolha explícita, e a tela diz que ela vence', async ({ page }) => {
  await stub(page)
  await page.goto(`/databases?id=${DB_ID}`)
  await page.getByTestId('grant-new').click()
  await page.getByTestId('grant-subject').selectOption('agent:a1')
  await page.getByTestId('grant-deny').check()
  await expect(page.getByTestId('grant-form')).toContainText('vence qualquer permissão herdada')
  await page.getByTestId('grant-save').click()
  await expect.poll(() => (grantSalvo as { effect?: string } | null)?.effect).toBe('deny')
})

test('a tela mostra quem consegue consultar HOJE, com a origem', async ({ page }) => {
  await stub(page)
  await page.goto(`/databases?id=${DB_ID}`)
  const efetivo = page.getByTestId('grants-effective')
  await expect(efetivo).toContainText('Marina')
  await expect(efetivo).toContainText('pelo setor')
})

test('sem grant nenhum, a tela diz o que isso significa', async ({ page }) => {
  await stub(page)
  await page.route(`**/api/databases/${DB_ID}/grants`, (r) => r.fulfill({ json: { items: [] } }))
  await page.goto(`/databases?id=${DB_ID}`)
  await expect(page.getByTestId('grants-empty')).toContainText('nenhum agente consulta')
})


// --- ver TODOS os registros, com paginação clara ---------------------------------------------

test('ACEITAÇÃO: dá para percorrer TODOS os registros, e a tela diz onde você está', async ({ page }) => {
  /**
   * A consulta trazia 20 e mostrava "20 de 137". Os outros 117 não tinham caminho: quem
   * precisava conferir um registro gravado ontem não tinha por onde chegar nele, e a tela
   * dizia quantos existiam sem oferecer nenhum modo de vê-los.
   */
  await stub(page)
  await page.goto(`/databases?id=${DB_ID}`)
  await expect(page.getByTestId('dataset-query-table')).toBeVisible()

  // Onde estou: a faixa mostrada e o total, não só "quantos vieram".
  await expect(page.getByTestId('dataset-pagina')).toContainText('1–20 de 137')

  await page.getByTestId('dataset-proxima').click()
  await expect(page.getByTestId('dataset-pagina')).toContainText('21–40 de 137')
  await expect(page.getByTestId('dataset-query-table')).toContainText('T20')

  await page.getByTestId('dataset-anterior').click()
  await expect(page.getByTestId('dataset-pagina')).toContainText('1–20 de 137')
  await expect(page.getByTestId('dataset-query-table')).toContainText('T0')
})

test('nas pontas, o botão que não leva a lugar nenhum fica DESLIGADO', async ({ page }) => {
  await stub(page)
  await page.goto(`/databases?id=${DB_ID}`)
  await expect(page.getByTestId('dataset-query-table')).toBeVisible()

  // Na primeira página não há anterior.
  await expect(page.getByTestId('dataset-anterior')).toBeDisabled()
  await expect(page.getByTestId('dataset-proxima')).toBeEnabled()
})

test('o tamanho da página é escolha de quem lê — e ela volta para a primeira', async ({ page }) => {
  await stub(page)
  await page.goto(`/databases?id=${DB_ID}`)
  await expect(page.getByTestId('dataset-query-table')).toBeVisible()

  await page.getByTestId('dataset-proxima').click()
  await expect(page.getByTestId('dataset-pagina')).toContainText('21–40')

  /**
   * Trocar o tamanho na página 2 e continuar "na página 2" mostraria uma faixa que a pessoa
   * não pediu. Voltar para a primeira é o que mantém a leitura previsível.
   */
  await page.getByTestId('dataset-tamanho').selectOption('100')
  await expect(page.getByTestId('dataset-pagina')).toContainText('1–100 de 137')
  expect(consultas.at(-1)).toEqual({ limit: 100, skip: 0 })
})

test('AMEAÇA: a última página não pede mais do que existe', async ({ page }) => {
  await stub(page)
  await page.goto(`/databases?id=${DB_ID}`)
  await expect(page.getByTestId('dataset-query-table')).toBeVisible()

  await page.getByTestId('dataset-tamanho').selectOption('100')
  await expect(page.getByTestId('dataset-pagina')).toContainText('1–100')
  await page.getByTestId('dataset-proxima').click()

  // 137 registros: a segunda página de 100 tem 37, e não há terceira.
  await expect(page.getByTestId('dataset-pagina')).toContainText('101–137 de 137')
  await expect(page.getByTestId('dataset-proxima')).toBeDisabled()
})

// --- CONTROLE: editar e apagar, no lugar onde a pessoa está ------------------------------
//
// DO RELATO: "os database não têm opção de editar as informações e também não tem como
// deletar. Quero ter todo o controle da database."
//
// O servidor já respondia a tudo — `PATCH /:id`, `DELETE /:id`, `PATCH /:id/datasets/:key`,
// `DELETE /:id/datasets/:key`. O cliente até tinha `patchDatabase` e `deleteDatabase`
// escritos. A tela é que nunca ofereceu: uma capacidade que existe e não aparece é uma
// capacidade que não existe.

test('ACEITAÇÃO: dá para RENOMEAR um database sem sair da lista', async ({ page }) => {
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()

  await page.getByTestId(`pasta-editar-${DB_ID}`).click()
  const campo = page.getByTestId('pasta-editar-nome')
  await expect(campo).toHaveValue('Operações')
  await campo.fill('Operações consolidadas')
  await page.getByTestId('pasta-editar-salvar').click()

  await expect.poll(() => patchesEnviados).toContainEqual({ id: DB_ID, name: 'Operações consolidadas' })
})

test('ACEITAÇÃO: apagar PEDE confirmação e diz o que vai junto', async ({ page }) => {
  /**
   * Apagar um Database leva os conjuntos e os registros. Um botão que apaga no primeiro
   * clique, sem dizer o que leva junto, é a diferença entre uma limpeza e um acidente.
   */
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()
  await page.getByTestId(`pasta-apagar-${DB_ID}`).click()

  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeVisible()
  await expect(dialogo).toContainText(/registro|conjunto/i)
  await expect.poll(() => apagados).toEqual([])

  await page.getByTestId('pasta-apagar-confirmar').click()
  await expect.poll(() => apagados).toContain(DB_ID)
})

test('ACEITAÇÃO: o conjunto dentro da pasta também se edita e se apaga', async ({ page }) => {
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()

  // Aberta, a pasta mostra o que tem dentro.
  await expect(page.getByTestId('item-ordens')).toBeVisible()
  await page.getByTestId('item-apagar-ordens').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByTestId('pasta-apagar-confirmar').click()
  await expect.poll(() => conjuntosApagados).toContain('ordens')
})

test('ACEITAÇÃO: o conjunto dentro da pasta também se RENOMEIA', async ({ page }) => {
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()
  await page.getByTestId('item-editar-ordens').click()
  await page.getByTestId('item-editar-nome').fill('Ordens do dia')
  await page.getByTestId('item-editar-salvar').click()
  await expect.poll(() => patchesEnviados).toContainEqual({ dataset: 'ordens', name: 'Ordens do dia' })
})

test('ACEITAÇÃO: na tabela de valores, cada linha se apaga', async ({ page }) => {
  /**
   * "Quero conseguir editar, deletar… e nos valores todos também." A consulta mostrava
   * números sem identidade: não havia como dizer QUAL linha corrigir. Agora ela devolve
   * `rowId`, e é por ele que a tela aponta.
   */
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`pasta-abrir-${DB_ID}`).click()
  await expect(page.getByTestId('dataset-query-counts')).toBeVisible()

  await page.getByTestId('linha-apagar-r1').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByTestId('linha-apagar-confirmar').click()
  await expect.poll(() => linhasApagadas).toContain('r1')
})

test('ACEITAÇÃO: na tabela de valores, uma linha se CORRIGE', async ({ page }) => {
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`pasta-abrir-${DB_ID}`).click()
  await expect(page.getByTestId('dataset-query-counts')).toBeVisible()

  await page.getByTestId('linha-editar-r1').click()
  await page.getByTestId('linha-campo-ticker').fill('PETR4')
  await page.getByTestId('linha-salvar').click()
  // Vai o registro inteiro, e não só o campo mexido: é assim que o servidor grava a linha.
  await expect.poll(() => patchesEnviados).toContainEqual({ rowId: 'r1', row: { ticker: 'PETR4', preco: 10 } })
})

test('AMEAÇA: onde só se acrescenta, não há botão de corrigir — há o motivo', async ({ page }) => {
  /**
   * O servidor recusa mexer numa série append_only. Um botão que sempre falha é pior que
   * botão nenhum: no lugar dele vai a razão, escrita.
   */
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()
  await page.getByTestId('item-abrir-fechamentos').click()
  await expect(page.getByTestId('linhas-travadas')).toContainText('só acrescenta')
  await expect(page.getByTestId('linha-apagar-f1')).toHaveCount(0)
})

test('ACEITAÇÃO: clicar num conjunto da pasta abre a consulta DELE, e não a do primeiro', async ({ page }) => {
  /**
   * A tela do Database repetia a lista de conjuntos que a pasta já mostra — duas listas da
   * mesma coisa, e a de dentro só confundia. Agora quem escolhe é a pasta, e o conjunto
   * escolhido é o que abre.
   */
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()
  await page.getByTestId('item-abrir-fechamentos').click()
  await expect(page.getByTestId('database-detail-sub')).toContainText('fechamentos')
  await expect(page.getByTestId('dataset-query')).toContainText('VALE3')
})

test('ACEITAÇÃO: o conjunto diz DE ONDE o dado vem e com que regra', async ({ page }) => {
  /**
   * "Não entendi o que tem na página de Históricos que não tem no Database." Tinha uma coisa
   * só: a procedência. Uma tabela sem ela responde "o que foi gravado" e deixa a pergunta
   * seguinte no ar — quem gravou, de onde, e de quanto em quanto tempo.
   */
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()
  await page.getByTestId('item-abrir-ordens').click()

  const origem = page.getByTestId('dataset-origem')
  await expect(origem).toBeVisible()
  await expect(origem).toContainText('Bitcoin')
  await expect(origem).toContainText('Resumo por período de 5 min em 5 min')
  await expect(origem).toContainText('288')
  await expect(origem).toContainText('coletando')
  await expect(origem).toContainText('preco → min → minimo')

  // E dá para mudar a regra de onde o dado aparece.
  await page.getByTestId('dataset-editar-regra').click()
  await expect(page).toHaveURL(/\/historicos\/rec-1\/editar/)
})

test('um conjunto criado à mão não inventa procedência', async ({ page }) => {
  // Sem série por trás, o bloco não aparece: silêncio é melhor que uma origem inventada.
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()
  await page.getByTestId('item-abrir-fechamentos').click()
  await expect(page.getByTestId('dataset-origem')).toHaveCount(0)
})

// --- a coluna calculada -----------------------------------------------------------------------
//
// "Não são essas funções? quero o mesmo no database." As trinta e poucas funções do registro
// só alcançavam a tela de contratar agente. O seletor é o mesmo componente nos dois lugares, e
// o card escolhido abre com os campos DENTRO dele — antes eles ficavam no fim do formulário,
// depois de vinte e sete cards, e quem clicava não via nada acontecer.

test('ACEITAÇÃO: escolher a função ABRE o card, e os campos aparecem ali dentro', async ({ page }) => {
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()
  await page.getByTestId('item-abrir-ordens').click()

  await page.getByTestId('coluna-nova').click()
  // Fechado, o card não mostra campo nenhum: vinte e sete formulários abertos não é uma lista.
  await expect(page.getByTestId('coluna-funcao-detail-math.serie')).toHaveCount(0)
  await expect(page.getByTestId('coluna-campo')).toHaveCount(0)

  await page.getByTestId('coluna-funcao-option-math.serie').click()
  const detalhe = page.getByTestId('coluna-funcao-detail-math.serie')
  await expect(detalhe).toBeVisible()
  // Os campos estão DENTRO do card escolhido, e não no fim da tela.
  await expect(detalhe.getByTestId('coluna-campo')).toBeVisible()
  await expect(detalhe.getByTestId('coluna-lookback')).toBeVisible()
  // E a outra função continua fechada.
  await expect(page.getByTestId('coluna-funcao-detail-texto.normalizar')).toHaveCount(0)
})

test('a coluna criada leva o campo, o argumento e a saída — derivados do schema', async ({ page }) => {
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()
  await page.getByTestId('item-abrir-ordens').click()
  await page.getByTestId('coluna-nova').click()
  await page.getByTestId('coluna-funcao-option-math.serie').click()

  await page.getByTestId('coluna-campo').selectOption('preco')
  await page.getByTestId('coluna-nome').fill('variacao')
  await page.getByTestId('coluna-criar').click()

  await expect.poll(() => colunaCriada).toBeTruthy()
  // `values` é o único argumento que é lista de números, e `variacaoPercentual` é o primeiro
  // número da saída: quem quer a variação do preço não deveria ter de ler um JSON Schema.
  expect(colunaCriada).toMatchObject({ name: 'variacao', functionName: 'math.serie', inputField: 'preco', inputArg: 'values', outputField: 'variacaoPercentual' })
})

test('a tela AVISA quantas linhas vão ficar vazias — vazio não é a conta dando zero', async ({ page }) => {
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()
  await page.getByTestId('item-abrir-ordens').click()
  await page.getByTestId('coluna-nova').click()
  await page.getByTestId('coluna-funcao-option-math.serie').click()

  await page.getByTestId('coluna-lookback').fill('5')
  await expect(page.getByTestId('coluna-funcao-detail-math.serie')).toContainText('4 linha(s) ficam vazias')
})

test('a recusa do servidor aparece na tela — e não some no console', async ({ page }) => {
  await stub(page)
  await page.route(`**/api/databases/${DB_ID}/datasets/ordens/columns`, (r) =>
    r.fulfill({ status: 400, json: { code: 'invalid', message: 'math.serie não devolve "desvio" — devolve: variacaoPercentual, tendencia, mediana.' } }),
  )
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()
  await page.getByTestId('item-abrir-ordens').click()
  await page.getByTestId('coluna-nova').click()
  await page.getByTestId('coluna-funcao-option-math.serie').click()
  await page.getByTestId('coluna-nome').fill('desvio')
  await page.getByTestId('coluna-criar').click()

  await expect(page.getByTestId('coluna-erro')).toContainText('não devolve')
})

test('as colunas que já existem aparecem, dizendo QUAL função as calcula', async ({ page }) => {
  await stub(page)
  await page.route(`**/api/databases/${DB_ID}`, (r) =>
    r.fulfill({
      json: {
        ...DETALHE,
        datasets: DETALHE.datasets.map((d) =>
          d.key === 'ordens' ? { ...d, computedColumns: [{ name: 'variacao', functionName: 'math.serie', version: '1.0.0', outputField: 'variacaoPercentual' }] } : d,
        ),
      },
    }),
  )
  await page.goto('/databases')
  await page.getByTestId(`pasta-${DB_ID}`).click()
  await page.getByTestId('item-abrir-ordens').click()

  // Sem isto, a variação apareceria ao lado do preço como se tivesse vindo da mesma origem —
  // e um erro de coleta e um erro de cálculo viram o mesmo sintoma.
  await expect(page.getByTestId('coluna-variacao')).toContainText('math.serie')
  await page.getByTestId('coluna-apagar-variacao').click()
  await expect.poll(() => colunasApagadas).toContain('variacao')
})
