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
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'off',
    screenshot: 'off',
  },
  // Start the frontend automatically so the API-stubbed specs (agent-metrics) are
  // hermetic — they must never pass by accident because no server was up. Specs that
  // need the real backend keep their own env guard. Skipped when E2E_BASE_URL points
  // somewhere else.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 60_000,
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
