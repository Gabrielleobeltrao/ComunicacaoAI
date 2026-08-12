import { defineConfig, devices } from '@playwright/test'

// Minimal, isolated responsive E2E. Assumes the app is already running locally
// (root `npm run dev` → frontend :5173 + backend :4000). Override the base URL
// and the QA login with E2E_BASE_URL / E2E_EMAIL / E2E_PASSWORD if needed.
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
