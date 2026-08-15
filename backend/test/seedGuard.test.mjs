// The demo seed is destructive. These lock its guards: dry-run by default, no
// account baked into the code, three explicit signals to write, and production
// refused outright. Pure — no database is involved.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { seedGuard, seedMayWrite, SEED_CONFIRM_PHRASE } = await import('../dist/scripts/seedGuard.js')

const APPLY = { SEED_EMAIL: 'qa@local.test', SEED_APPLY: '1', SEED_CONFIRM: SEED_CONFIRM_PHRASE }

test('the default is a dry run: no SEED_APPLY, no writes', () => {
  const plan = seedGuard({ SEED_EMAIL: 'qa@local.test' })
  assert.equal(plan.mode, 'dry-run')
  assert.equal(seedMayWrite(plan), false)
})

test('SEED_EMAIL is required — the script has no default account', () => {
  for (const env of [{}, { SEED_EMAIL: '' }, { SEED_EMAIL: '   ' }, { ...APPLY, SEED_EMAIL: '' }]) {
    const plan = seedGuard(env)
    assert.equal(plan.mode, 'blocked', `${JSON.stringify(env)} should be blocked`)
    assert.equal(seedMayWrite(plan), false)
  }
})

test('writing needs SEED_APPLY=1 AND the exact confirmation phrase', () => {
  assert.equal(seedGuard({ ...APPLY, SEED_APPLY: undefined }).mode, 'dry-run')
  assert.equal(seedGuard({ ...APPLY, SEED_APPLY: 'true' }).mode, 'dry-run')
  assert.equal(seedGuard({ ...APPLY, SEED_CONFIRM: undefined }).mode, 'dry-run')
  assert.equal(seedGuard({ ...APPLY, SEED_CONFIRM: 'reset_restaurant_demo' }).mode, 'dry-run')
  assert.equal(seedGuard({ ...APPLY, SEED_CONFIRM: `${SEED_CONFIRM_PHRASE} ` }).mode, 'dry-run')

  const ok = seedGuard(APPLY)
  assert.equal(ok.mode, 'apply')
  assert.equal(seedMayWrite(ok), true)
  assert.equal(ok.email, 'qa@local.test')
})

test('production is refused no matter which variables are set', () => {
  for (const value of ['production', 'PRODUCTION', ' production ']) {
    const plan = seedGuard({ ...APPLY, NODE_ENV: value })
    assert.equal(plan.mode, 'blocked')
    assert.match(plan.reason, /produção/)
    assert.equal(seedMayWrite(plan), false)
  }
})

test('no real e-mail is hardcoded in the seed script', () => {
  const source = readFileSync(new URL('../src/scripts/seedRestaurantDemo.ts', import.meta.url), 'utf8')
  const emails = source.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []
  // The only address allowed in the file is the placeholder in the usage comment.
  assert.deepEqual(
    emails.filter((e) => e !== 'alguem@exemplo.com'),
    [],
    `hardcoded address(es) in the seed: ${emails.join(', ')}`,
  )
  assert.ok(!/SEED_EMAIL\s*\?\?/.test(source), 'SEED_EMAIL must not have a fallback')
})

test('the seed writes only through the guard', () => {
  const source = readFileSync(new URL('../src/scripts/seedRestaurantDemo.ts', import.meta.url), 'utf8')
  assert.ok(source.includes('seedMayWrite(PLAN)'), 'the wipe must be gated by seedMayWrite')
  assert.ok(!source.includes('SEED_DRY_RUN'), 'the old opt-in dry-run flag must be gone')
})
