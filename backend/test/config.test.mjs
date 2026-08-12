// Deployment-readiness tests for the backend config module (src/config.ts →
// dist/config.js). Verifies the production fail-fast contract and dev defaults.
//
// Run:  npm run build && npm test        (uses Node's built-in test runner)
//
// Each case runs in a CLEAN child process because config.ts computes isProduction
// and builds `config` once at module load — env must be set before import. We
// point dotenv at a nonexistent path so a local .env never pollutes the run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const configUrl = 'file://' + resolve(here, '../dist/config.js')

// Import the built config in a child with a controlled env. Optionally call
// validateConfig() and print config.clientOrigins as JSON. Returns the child's
// stdout+stderr and whether it exited zero.
function run(caseVars, { validate = true } = {}) {
  const snippet = `
    const m = await import(${JSON.stringify(configUrl)})
    ${validate ? 'm.validateConfig()' : ''}
    process.stdout.write(JSON.stringify({ origins: m.config.clientOrigins, publicUrl: m.config.publicUrl, betterAuthUrl: m.config.betterAuthUrl }))
  `
  const env = {
    PATH: process.env.PATH,
    DOTENV_CONFIG_PATH: '/nonexistent-so-no-dotenv-loads',
    ...caseVars,
  }
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', snippet], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out }
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

// The definitive production origins (ASCII, no trailing slash).
const PROD_URLS = {
  NODE_ENV: 'production',
  CLIENT_URL: 'https://comunicacaoai.oneplataforma.com',
  BETTER_AUTH_URL: 'https://api.comunicacaoai.oneplataforma.com',
  PUBLIC_URL: 'https://api.comunicacaoai.oneplataforma.com',
}
const PROD_SECRETS = {
  MONGODB_URI: 'mongodb://localhost:27017/comunicacaoai_test',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  ENCRYPTION_KEY: 'y'.repeat(40),
}

test('production: missing MONGODB_URI fails fast and names the variable', () => {
  const { ok, out } = run({ ...PROD_URLS, BETTER_AUTH_SECRET: 'x'.repeat(40), ENCRYPTION_KEY: 'y'.repeat(40) })
  assert.equal(ok, false, 'should have thrown')
  assert.match(out, /MONGODB_URI/)
  assert.doesNotMatch(out, /x{40}|y{40}/, 'must not print secret values')
})

test('production: a required URL var missing fails fast at import', () => {
  const noPublic = { ...PROD_URLS, ...PROD_SECRETS }
  delete noPublic.PUBLIC_URL
  const { ok, out } = run(noPublic)
  assert.equal(ok, false)
  assert.match(out, /PUBLIC_URL/)
})

test('production: non-https URL is rejected', () => {
  const { ok, out } = run({ ...PROD_URLS, ...PROD_SECRETS, BETTER_AUTH_URL: 'http://api.comunicacaoai.oneplataforma.com' })
  assert.equal(ok, false)
  assert.match(out, /https/i)
})

test('production: valid config passes, strips trailing slash, splits CSV origins', () => {
  const { ok, out } = run({
    ...PROD_URLS,
    ...PROD_SECRETS,
    // prod origin + local dev origin, both with a stray trailing slash to strip.
    CLIENT_URL: 'https://comunicacaoai.oneplataforma.com/, http://localhost:5173/',
  })
  assert.equal(ok, true, out)
  const parsed = JSON.parse(out)
  assert.deepEqual(parsed.origins, ['https://comunicacaoai.oneplataforma.com', 'http://localhost:5173'])
  assert.equal(parsed.publicUrl, 'https://api.comunicacaoai.oneplataforma.com')
})

test('development: no env needed, falls back to localhost defaults', () => {
  const { ok, out } = run({}, { validate: true })
  assert.equal(ok, true, out)
  const parsed = JSON.parse(out)
  assert.deepEqual(parsed.origins, ['http://localhost:5173'])
  assert.match(parsed.betterAuthUrl, /^http:\/\/localhost:/)
})
