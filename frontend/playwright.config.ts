import { defineConfig, devices } from '@playwright/test'

// Minimal, isolated responsive E2E. Assumes the app is already running locally
// (root `npm run dev` → frontend :5173 + backend :4000). Override the base URL
// and the QA login with E2E_BASE_URL / E2E_EMAIL / E2E_PASSWORD if needed.
export default defineConfig({
  testDir: './e2e',
  // O smoke de MVP NÃO roda aqui. Ele exige a pilha que `npm run smoke` monta —
  // mongod limpo, backend com o adaptador falso de LLM, frontend compilado com as
  // flags de produção — e o orquestrador o chama pelo nome. Sem isto ele entraria
  // na varredura padrão e falharia por falta de ambiente, o que se lê como "o
  // produto quebrou" quando não é. Não é `skip`: o arquivo simplesmente não é
  // coletado por esta configuração.
  testIgnore: process.env.SMOKE ? [] : ['**/mvp-smoke.spec.ts'],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  retries: 0,
  /**
   * `list` para ler no terminal; `html` só no CI, e só para quando quebra.
   *
   * Um passo vermelho num repositório de outra pessoa é um passo que não dá para ler:
   * o log completo exige permissão de administrador. O relatório vira artefato e
   * responde qual teste caiu, em que asserção e com que captura.
   */
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || (process.env.E2E_PREVIEW ? 'http://localhost:4173' : 'http://localhost:5173'),
    trace: 'off',
    screenshot: 'off',
  },
  /**
   * Start the frontend automatically so the API-stubbed specs are hermetic — they must
   * never pass by accident because no server was up. Specs that need the real backend
   * keep their own env guard. Skipped when E2E_BASE_URL points somewhere else.
   *
   * `E2E_PREVIEW=1` troca o servidor de DESENVOLVIMENTO pelo app JÁ COMPILADO.
   *
   * É o que o CI usa, por dois motivos que só aparecem lá. O primeiro: o servidor de
   * dev transforma módulo sob demanda, então a primeira página pesada paga a
   * compilação inteira dentro do prazo de uma expectativa — na máquina de quem
   * desenvolve tudo já está quente, e o custo é invisível. O segundo: a porta é
   * estrita, e dois passos de E2E seguidos disputam a mesma enquanto o servidor
   * anterior ainda está morrendo.
   *
   * O `dist` já existe no CI (o passo de build vem antes), então servir o compilado
   * não custa nada e remove as duas coisas de uma vez.
   */
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : process.env.E2E_PREVIEW
      ? {
          command: 'npm run preview -- --port 4173 --strictPort',
          url: 'http://localhost:4173',
          reuseExistingServer: false,
          timeout: 60_000,
        }
      : {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 60_000,
        },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
