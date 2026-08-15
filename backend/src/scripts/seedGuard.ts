// The guards around the destructive demo seed, kept pure so they can be tested
// without a database and without ever risking a real account.
//
// The default is ALWAYS a dry run. A real wipe needs three deliberate signals:
// the account (SEED_EMAIL), the intent (SEED_APPLY=1) and the phrase
// (SEED_CONFIRM=RESET_RESTAURANT_DEMO). Production is refused outright — no
// combination of variables unlocks it.

export const SEED_CONFIRM_PHRASE = 'RESET_RESTAURANT_DEMO'

export interface SeedEnv {
  SEED_EMAIL?: string
  SEED_APPLY?: string
  SEED_CONFIRM?: string
  NODE_ENV?: string
}

export type SeedPlan =
  // Refused before opening a connection: nothing is read, nothing is written.
  | { mode: 'blocked'; reason: string }
  // Reads and reports what WOULD change. Never writes.
  | { mode: 'dry-run'; email: string; reason: string }
  // The only mode allowed to delete and recreate.
  | { mode: 'apply'; email: string }

export function seedGuard(env: SeedEnv): SeedPlan {
  if ((env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    return { mode: 'blocked', reason: 'NODE_ENV=production — o seed de demonstração nunca roda em produção.' }
  }

  const email = (env.SEED_EMAIL ?? '').trim()
  if (!email) {
    return { mode: 'blocked', reason: 'SEED_EMAIL é obrigatório — o script não tem conta padrão.' }
  }

  if (env.SEED_APPLY !== '1') {
    return { mode: 'dry-run', email, reason: 'SEED_APPLY=1 não foi informado.' }
  }
  if (env.SEED_CONFIRM !== SEED_CONFIRM_PHRASE) {
    return { mode: 'dry-run', email, reason: `SEED_CONFIRM precisa ser exatamente ${SEED_CONFIRM_PHRASE}.` }
  }

  return { mode: 'apply', email }
}

// True only for the one plan allowed to touch data — used as the single check at
// every write site, so a new write can never forget the guard.
export const seedMayWrite = (plan: SeedPlan): plan is { mode: 'apply'; email: string } => plan.mode === 'apply'
